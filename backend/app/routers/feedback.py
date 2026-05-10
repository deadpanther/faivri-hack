"""POST /api/v1/feedback — Report final price paid + feed community data.

Idempotent on `query_id`: a second call for the same query updates the existing
community row in place (DATA-P1-01) so a double-click or retry storm can't
inflate the Price Memory Network. Returns the full streak block so the frontend
celebration can render even without a second round-trip (API-P1-02).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.canonicalize import (
    canonical_service_key, service_fingerprint,
)
from app.models.db import CommunityPrice, Query as QueryModel
from app.models.schemas import FeedbackRequest, FeedbackResponse, StreakBlock
from app.services.auth import get_optional_user_id
from app.services.database import get_db
from app.services.limiter import RATE_LIMIT_FEEDBACK, limiter
from app.services.savings import (
    compute_lifetime_saved,
    compute_monthly_dodged,
    crossed_threshold,
    level_for_saved,
)

router = APIRouter()


@router.post("/feedback", response_model=FeedbackResponse)
@limiter.limit(RATE_LIMIT_FEEDBACK)
async def submit_feedback(
    request: Request,
    req: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Record the final price and feed community data — idempotently."""
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(req.query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    # Ownership gate: feedback requires a signed-in owner.
    #
    # Anonymous queries (query.user_id is None) are dead handles for follow-up
    # routes — the caller already got the verdict inline from /analyze, and we
    # don't let a leaked query_id be used by any later caller to file community
    # feedback against someone else's quote. Rows with an owner are only
    # reachable by that owner. Both IDs normalized to str because the auth dep
    # returns str while the column hands back uuid.UUID.
    if query.user_id is None or not user_id or str(user_id) != str(query.user_id):
        raise HTTPException(status_code=404, detail="Query not found")

    # Sanity: reject logically inconsistent outcomes before they poison the
    # community price memory network. "negotiated_down" with paid > quoted is
    # nonsense; "walked_away" with a paid price > 0 is also incoherent.
    if query.quoted_price and req.outcome == "negotiated_down" and req.final_price > query.quoted_price:
        raise HTTPException(
            status_code=422,
            detail="negotiated_down requires final_price <= quoted_price",
        )
    if req.outcome == "walked_away" and req.final_price > 0:
        raise HTTPException(
            status_code=422,
            detail="walked_away requires final_price = 0",
        )

    lifetime_before = (
        await compute_lifetime_saved(db, query.user_id) if query.user_id else 0
    )

    # Update the query row first. Keeping this in the same transaction as the
    # community upsert so a crash mid-write can't leave the two out of sync.
    query.feedback_final_price = req.final_price

    # Idempotent upsert on community_prices keyed by query_id.
    existing_result = await db.execute(
        select(CommunityPrice).where(CommunityPrice.query_id == str(req.query_id))
    )
    existing = existing_result.scalar_one_or_none()

    description = (
        f"Outcome: {req.outcome}. Originally quoted: {query.quoted_price}, "
        f"paid: {req.final_price}"
    )

    service_type = (query.input_text or "")[:200]
    canonical = canonical_service_key(service_type)
    fingerprint = service_fingerprint(service_type)

    if existing is None:
        db.add(CommunityPrice(
            user_id=query.user_id,
            query_id=query.id,
            domain=query.domain,
            service_type=service_type,
            canonical_service=canonical,
            service_fingerprint=fingerprint,
            description=description,
            price_paid=req.final_price,
            currency=query.currency,
            city=query.location_city,
            country=query.location_country,
            vendor_name=req.vendor_name,
            s2_token=query.s2_token,
            created_at=datetime.utcnow(),
        ))
    else:
        existing.price_paid = req.final_price
        existing.description = description
        existing.vendor_name = req.vendor_name
        # Re-canonicalize in case the query text changed since the original
        # insert (rare, but feedback re-submits can happen after an admin
        # corrects a query).
        existing.canonical_service = canonical
        existing.service_fingerprint = fingerprint

    await db.commit()

    # Compute post-commit savings so the streak reflects THIS feedback.
    savings = 0
    if query.quoted_price and req.final_price < query.quoted_price:
        savings = query.quoted_price - req.final_price

    streak = await _build_streak(db, query.user_id, lifetime_before)

    return FeedbackResponse(
        status="ok",
        message="Feedback recorded and added to community data",
        savings=savings,
        currency=query.currency,
        streak=streak,
    )


async def _build_streak(
    db: AsyncSession,
    user_id: str | None,
    lifetime_before: int,
) -> StreakBlock | None:
    """Return the streak block for signed-in users; anonymous → None."""
    if not user_id:
        return None

    lifetime_saved = await compute_lifetime_saved(db, user_id)
    monthly_dodged = await compute_monthly_dodged(db, user_id)
    tier = level_for_saved(lifetime_saved)
    unlocked = crossed_threshold(lifetime_before, lifetime_saved)

    return StreakBlock(
        monthly_dodged=monthly_dodged,
        lifetime_saved=lifetime_saved,
        level=tier.key,
        milestone_unlocked=unlocked.key if unlocked else None,
    )
