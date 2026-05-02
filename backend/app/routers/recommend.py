"""GET /api/v1/recommend/{query_id} — Personalized next-step recommendations."""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.models.db import Query as QueryModel
from app.services.auth import get_optional_user_id
from app.services.database import get_db
from app.services.limiter import limiter, RATE_LIMIT_RECOMMEND
from app.intelligence.recommender import get_recommendations

router = APIRouter()


def _authorize_query_access(query: QueryModel, user_id: Optional[str]) -> None:
    """Mirror the ownership rule used in negotiate.py:108.

    - Row with an owner: only that owner can read it. Mismatches return
      404 (same shape as "not found") so we don't leak which UUIDs exist.
    - Row without an owner: anonymous shared handle (same capability
      model as /analyze/purchase/{id}) — any caller may read it.

    Both IDs normalized to str because auth returns str and SQLAlchemy
    hands back a uuid.UUID from the column.
    """
    if query.user_id is None:
        return
    if not user_id or str(user_id) != str(query.user_id):
        raise HTTPException(status_code=404, detail="Query not found")


@router.get("/recommend/{query_id}")
@limiter.limit(RATE_LIMIT_RECOMMEND)
async def recommend(
    request: Request,
    query_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(get_optional_user_id),
):
    """Get personalized recommendations based on a completed analysis."""
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == query_id)
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    # IDOR fix: `/recommend/{id}` previously returned the owner's
    # input_text, explanation, red_flags to any caller who held the UUID.
    # Match the ownership model used by /negotiate, /feedback, /history.
    _authorize_query_access(query, user_id)

    try:
        recommendations = await get_recommendations(
            query_text=query.input_text,
            domain=query.domain or "auto",
            verdict=query.verdict or "high",
            multiplier=float(query.overcharge_multiplier or 1.0),
            fair_low=query.fair_price_low or 0,
            fair_high=query.fair_price_high or 0,
            quoted_price=query.quoted_price,
            explanation=query.explanation or "",
            red_flags=query.red_flags or [],
        )
        return recommendations
    except Exception:
        logger.exception("Recommendations failed for query %s", query_id)
        raise HTTPException(status_code=500, detail="Recommendations failed. Please try again.")
