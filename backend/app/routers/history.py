"""GET /api/v1/history — User query history and savings."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select, func, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.schemas import (
    HistoryItem, SavingsProfile, SavingsSummary, VerdictResponse,
)
from app.models.db import Query as QueryModel, CommunityPrice, PurchaseAnalysis
from app.services.database import get_db
from app.services.auth import get_optional_user_id, require_user_id, require_admin
from app.services.limiter import limiter, RATE_LIMIT_ADMIN_WRITE
from app.services.market import DEFAULT_CURRENCY
from app.services.savings import (
    compute_lifetime_saved,
    compute_monthly_dodged,
    compute_overcharges_found,
    compute_potential_saved,
    compute_total_queries,
    level_for_saved,
    next_level_for_saved,
    progress_to_next,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/history", response_model=list[HistoryItem])
async def get_history(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    user_id: str | None = Depends(get_optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated query history for the authenticated user."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required to view history")

    offset = (page - 1) * limit
    result = await db.execute(
        select(QueryModel)
        .where(QueryModel.user_id == user_id)
        .order_by(desc(QueryModel.created_at))
        .offset(offset)
        .limit(limit)
    )
    queries = result.scalars().all()

    return [
        HistoryItem(
            id=str(q.id),
            domain=q.domain,
            input_text=q.input_text,
            location_city=q.location_city,
            location_country=q.location_country,
            currency=q.currency,
            verdict=q.verdict,
            overcharge_multiplier=float(q.overcharge_multiplier) if q.overcharge_multiplier else None,
            fair_price_low=q.fair_price_low,
            fair_price_high=q.fair_price_high,
            quoted_price=q.quoted_price,
            feedback_final_price=q.feedback_final_price,
            created_at=q.created_at,
        )
        for q in queries
    ]


@router.get("/history/purchases")
async def get_purchase_history(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    user_id: str | None = Depends(get_optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Paginated used-car purchase analyses for the authenticated user.

    Mirrors `/history` but for the `purchase_analyses` table. Each row is a
    re-openable car check the buyer can come back to from the vault.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required to view purchases")

    try:
        user_uuid = UUID(user_id)
    except (ValueError, TypeError):
        # Auth dep already resolves Clerk subs to profile UUIDs, so anything
        # else is malformed — return empty rather than 500.
        return []

    offset = (page - 1) * limit
    result = await db.execute(
        select(PurchaseAnalysis)
        .where(PurchaseAnalysis.user_id == user_uuid)
        .order_by(desc(PurchaseAnalysis.created_at))
        .offset(offset)
        .limit(limit)
    )
    rows = result.scalars().all()

    out = []
    for row in rows:
        payload = row.payload or {}
        adjusted = payload.get("adjusted_pricing") or {}
        verdict = payload.get("asking_price_verdict")
        out.append({
            "id": str(row.id),
            "make": row.make,
            "model": row.model,
            "year": row.year,
            "mileage_km": row.mileage_km,
            "mileage_miles": int(row.mileage_km / 1.609) if row.mileage_km else None,
            "asking_price": row.asking_price,
            "vin": row.vin,
            "city": row.city,
            "country": row.country,
            "currency": payload.get("currency") or "USD",
            "asking_price_verdict": verdict,
            "overcharge_multiplier": payload.get("overcharge_multiplier"),
            "target_offer": adjusted.get("target_offer"),
            "adjusted_low": adjusted.get("adjusted_low"),
            "adjusted_high": adjusted.get("adjusted_high"),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })
    return out


@router.get("/history/{query_id}", response_model=VerdictResponse)
async def get_query_detail(
    query_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Get full verdict details for a query owned by the current user."""
    result = await db.execute(
        select(QueryModel).where(
            QueryModel.id == query_id,
            QueryModel.user_id == user_id,
        )
    )
    q = result.scalar_one_or_none()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")

    return VerdictResponse(
        id=str(q.id),
        verdict=q.verdict or "unknown",
        overcharge_multiplier=float(q.overcharge_multiplier) if q.overcharge_multiplier else 1.0,
        fair_price_low=q.fair_price_low or 0,
        fair_price_high=q.fair_price_high or 0,
        currency=q.currency,
        confidence_score=q.confidence_score or 0,
        data_points_count=q.data_points_count or 0,
        explanation=q.explanation or "",
        red_flags=q.red_flags or [],
        questions_to_ask=q.questions_to_ask or [],
        sources=q.sources_used or {},
        domain=q.domain,
        location_city=q.location_city,
        location_country=q.location_country,
        quoted_price=q.quoted_price,
        created_at=q.created_at,
    )


@router.get("/savings/summary", response_model=SavingsSummary)
async def get_savings(
    user_id: str | None = Depends(get_optional_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Calculate total savings for the authenticated user.

    Savings = sum of (quoted_price - feedback_final_price) where user negotiated down.
    Also counts potential savings from overcharge verdicts where user hasn't given feedback yet,
    using (quoted_price - fair_price_high) as estimated savings.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required to view savings")

    user_filter = QueryModel.user_id == user_id

    # Count total queries for this user
    total_result = await db.execute(
        select(func.count(QueryModel.id)).where(user_filter)
    )
    total_queries = total_result.scalar() or 0

    # Count overcharges found for this user
    overcharge_result = await db.execute(
        select(func.count(QueryModel.id)).where(
            user_filter,
            QueryModel.verdict.in_(["overcharge", "high"]),
        )
    )
    overcharges = overcharge_result.scalar() or 0

    # Actual savings: where user gave feedback and paid less than quoted
    actual_savings_result = await db.execute(
        select(
            func.sum(QueryModel.quoted_price - QueryModel.feedback_final_price)
        ).where(
            user_filter,
            QueryModel.quoted_price.isnot(None),
            QueryModel.feedback_final_price.isnot(None),
            QueryModel.quoted_price > 0,
            QueryModel.feedback_final_price < QueryModel.quoted_price,
        )
    )
    actual_saved = actual_savings_result.scalar() or 0

    # Potential savings: overcharge verdicts without feedback (quoted - fair_high)
    potential_result = await db.execute(
        select(
            func.sum(QueryModel.quoted_price - QueryModel.fair_price_high)
        ).where(
            user_filter,
            QueryModel.verdict.in_(["overcharge", "high"]),
            QueryModel.feedback_final_price.is_(None),
            QueryModel.quoted_price.isnot(None),
            QueryModel.fair_price_high.isnot(None),
            QueryModel.quoted_price > QueryModel.fair_price_high,
        )
    )
    potential_saved = potential_result.scalar() or 0

    # Total = actual + potential
    total_saved = actual_saved + potential_saved

    return SavingsSummary(
        total_saved=total_saved,
        total_queries=total_queries,
        overcharges_found=overcharges,
        currency=DEFAULT_CURRENCY,
    )


@router.get("/savings/profile", response_model=SavingsProfile)
async def get_savings_profile(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate savings + level info for the vault/profile page (API-P1-01).

    Shape matches `SavingsProfileData` in the frontend client — the vault page
    was calling this endpoint against a 404 before this landed.
    """
    lifetime_saved = await compute_lifetime_saved(db, user_id)
    potential_saved = await compute_potential_saved(db, user_id)
    total_queries = await compute_total_queries(db, user_id)
    overcharges_found = await compute_overcharges_found(db, user_id)
    monthly_streak = await compute_monthly_dodged(db, user_id)

    current = level_for_saved(lifetime_saved)
    nxt = next_level_for_saved(lifetime_saved)

    return SavingsProfile(
        lifetime_saved=lifetime_saved,
        potential_saved=potential_saved,
        monthly_streak=monthly_streak,
        total_queries=total_queries,
        overcharges_found=overcharges_found,
        level=current.key,
        level_label=current.label,
        next_level=nxt.key if nxt else None,
        next_level_label=nxt.label if nxt else None,
        next_level_threshold=nxt.threshold_cents if nxt else current.threshold_cents,
        progress_to_next=progress_to_next(lifetime_saved),
        currency=DEFAULT_CURRENCY,
    )


@router.delete("/history/purge")
@limiter.limit(RATE_LIMIT_ADMIN_WRITE)
async def purge_stale_history(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _admin: None = Depends(require_admin),
):
    """ADMIN-ONLY: delete ALL query history, community prices, and cached baselines.

    Requires the `X-Admin-Api-Key` header matching the server's `ADMIN_API_KEY`
    env var. If that env var is unset, this endpoint is effectively disabled
    (always 403). Flushes Redis cache so stale baselines don't persist.

    Rate-limited (`RATE_LIMIT_ADMIN_WRITE`) so a leaked admin key can't be
    replayed to nuke prod in a loop — 5 requests/minute gives a human enough
    time to notice + rotate.
    """
    from app.services.redis import cache_flush_all

    # Delete community prices first (clean slate)
    community_result = await db.execute(delete(CommunityPrice))
    community_count = community_result.rowcount

    # Delete all queries
    queries_result = await db.execute(delete(QueryModel))
    queries_count = queries_result.rowcount

    await db.commit()

    # Flush Redis cached baselines
    cache_keys_flushed = await cache_flush_all()

    logger.info(
        "Purged %d queries, %d community prices, %d cache keys",
        queries_count, community_count, cache_keys_flushed,
    )

    return {
        "status": "ok",
        "purged_queries": queries_count,
        "purged_community_prices": community_count,
        "purged_cache_keys": cache_keys_flushed,
    }
