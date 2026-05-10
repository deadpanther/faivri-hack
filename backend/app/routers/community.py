"""Community prices — browse and submit crowdsourced pricing data.

Supports S2 proximity-based lookups: pass lat/lng to find prices
in the same ~10km cell and its neighbors, not just exact city match.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import CommunityPrice
from app.services.database import get_db
from app.services.limiter import limiter, RATE_LIMIT_COMMUNITY_READ

router = APIRouter()


@router.get("/community/prices")
@limiter.limit(RATE_LIMIT_COMMUNITY_READ)
async def browse_community_prices(
    request: Request,
    domain: str = Query(None),
    city: str = Query(None),
    country: str = Query(None),
    lat: Optional[float] = Query(None, ge=-90.0, le=90.0),
    lng: Optional[float] = Query(None, ge=-180.0, le=180.0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Browse crowdsourced community prices.

    If lat/lng provided, uses S2 proximity (cell + neighbors) instead of exact city match.
    """
    stmt = select(CommunityPrice).order_by(desc(CommunityPrice.created_at))

    if domain:
        stmt = stmt.where(CommunityPrice.domain == domain)

    # S2 proximity search takes priority over city string match
    if lat is not None and lng is not None:
        from app.services.geo import s2_tokens_nearby
        nearby_tokens = s2_tokens_nearby(lat, lng)
        stmt = stmt.where(CommunityPrice.s2_token.in_(nearby_tokens))
    elif city:
        stmt = stmt.where(CommunityPrice.city == city)

    if country:
        stmt = stmt.where(CommunityPrice.country == country)

    result = await db.execute(stmt.limit(limit))
    items = result.scalars().all()

    return [
        {
            "id": str(p.id),
            "domain": p.domain,
            "service_type": p.service_type,
            "description": p.description,
            "price_paid": p.price_paid,
            "currency": p.currency,
            "city": p.city,
            "country": p.country,
            "vendor_name": p.vendor_name,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in items
    ]


@router.get("/community/vendors")
@limiter.limit(RATE_LIMIT_COMMUNITY_READ)
async def get_vendor_scores(
    request: Request,
    city: str = Query(None),
    country: str = Query(None),
    domain: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get vendor transparency scores aggregated from community data."""
    stmt = (
        select(
            CommunityPrice.vendor_name,
            CommunityPrice.city,
            CommunityPrice.country,
            CommunityPrice.domain,
            func.count(CommunityPrice.id).label("report_count"),
            func.avg(CommunityPrice.price_paid).label("avg_price"),
            func.min(CommunityPrice.price_paid).label("min_price"),
            func.max(CommunityPrice.price_paid).label("max_price"),
        )
        .where(CommunityPrice.vendor_name.isnot(None))
        .group_by(
            CommunityPrice.vendor_name,
            CommunityPrice.city,
            CommunityPrice.country,
            CommunityPrice.domain,
        )
        .having(func.count(CommunityPrice.id) >= 3)
        .order_by(desc("report_count"))
    )

    if city:
        stmt = stmt.where(CommunityPrice.city == city)
    if country:
        stmt = stmt.where(CommunityPrice.country == country)
    if domain:
        stmt = stmt.where(CommunityPrice.domain == domain)

    result = await db.execute(stmt.limit(50))
    rows = result.all()

    return [
        {
            "vendor_name": row.vendor_name,
            "city": row.city,
            "country": row.country,
            "domain": row.domain,
            "report_count": row.report_count,
            "avg_price": int(row.avg_price) if row.avg_price else 0,
            "min_price": row.min_price,
            "max_price": row.max_price,
        }
        for row in rows
    ]


@router.get("/community/trends")
@limiter.limit(RATE_LIMIT_COMMUNITY_READ)
async def get_price_trends(
    request: Request,
    domain: str = Query("auto"),
    country: str = Query("US"),
    city: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Get price trends from query history — what services are being checked and at what prices."""
    from app.models.db import Query as QueryModel

    # Pin the truncated-day expression once so SELECT, GROUP BY, and ORDER BY
    # all reference the same object. Using desc("date") (a string label)
    # made Postgres resolve "date" to the raw `queries.created_at` column
    # rather than the aliased expression, triggering a GroupingError.
    day_bucket = func.date_trunc('day', QueryModel.created_at)
    stmt = (
        select(
            day_bucket.label("date"),
            func.count(QueryModel.id).label("query_count"),
            func.avg(QueryModel.overcharge_multiplier).label("avg_multiplier"),
            func.avg(QueryModel.fair_price_low).label("avg_fair_low"),
            func.avg(QueryModel.fair_price_high).label("avg_fair_high"),
        )
        .where(QueryModel.domain == domain)
        .where(QueryModel.location_country == country)
        .group_by(day_bucket)
        .order_by(day_bucket.desc())
        .limit(30)
    )

    if city:
        stmt = stmt.where(QueryModel.location_city == city)

    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "date": row.date.isoformat() if row.date else None,
            "query_count": row.query_count,
            "avg_multiplier": round(float(row.avg_multiplier), 2) if row.avg_multiplier else None,
            "avg_fair_low": int(row.avg_fair_low) if row.avg_fair_low else None,
            "avg_fair_high": int(row.avg_fair_high) if row.avg_fair_high else None,
        }
        for row in rows
    ]
