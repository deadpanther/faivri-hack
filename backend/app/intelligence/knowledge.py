"""
Step 3a: Query the pricing_knowledge table for relevant pricing data.
Uses keyword matching on domain + city + country + category/item_name.
"""

from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import PricingKnowledge


async def search_knowledge(
    db: AsyncSession,
    domain: str,
    country: str,
    city: str,
    service: str,
    make: str | None = None,
    model: str | None = None,
) -> list[dict]:
    """Search pricing knowledge base for matching items."""

    # Build search terms from the service description
    search_terms = service.lower().replace(",", " ").split()
    search_terms = [t for t in search_terms if len(t) > 2]

    # Base query: match domain + country + (city or national)
    stmt = (
        select(PricingKnowledge)
        .where(PricingKnowledge.domain == domain)
        .where(PricingKnowledge.country == country)
        .where(
            or_(
                func.lower(PricingKnowledge.city) == city.lower(),
                PricingKnowledge.city.is_(None),  # national average
            )
        )
    )

    # Filter by search terms matching category or item_name
    if search_terms:
        term_filters = []
        for term in search_terms:
            pattern = f"%{term}%"
            term_filters.append(func.lower(PricingKnowledge.category).like(pattern))
            term_filters.append(func.lower(PricingKnowledge.item_name).like(pattern))
            term_filters.append(func.lower(PricingKnowledge.item_description).like(pattern))
        stmt = stmt.where(or_(*term_filters))

    # If make/model provided, also try make-specific results
    if make:
        make_pattern = f"%{make.lower()}%"
        stmt_make = (
            select(PricingKnowledge)
            .where(PricingKnowledge.domain == domain)
            .where(PricingKnowledge.country == country)
            .where(
                or_(
                    func.lower(PricingKnowledge.city) == city.lower(),
                    PricingKnowledge.city.is_(None),
                )
            )
            .where(func.lower(PricingKnowledge.item_name).like(make_pattern))
        )
        make_results = await db.execute(stmt_make)
        make_items = make_results.scalars().all()
    else:
        make_items = []

    result = await db.execute(stmt.limit(15))
    items = result.scalars().all()

    # Combine and deduplicate
    seen_ids = set()
    combined = []
    for item in list(make_items) + list(items):
        if item.id not in seen_ids:
            seen_ids.add(item.id)
            combined.append(_to_dict(item))

    return combined[:15]


def _to_dict(item: PricingKnowledge) -> dict:
    return {
        "id": str(item.id),
        "domain": item.domain,
        "category": item.category,
        "item_name": item.item_name,
        "item_description": item.item_description,
        "price_low": item.price_low,
        "price_high": item.price_high,
        "currency": item.currency,
        "city": item.city,
        "country": item.country,
        "source": item.source,
        "confidence": item.confidence,
        "metadata": item.extra_metadata or {},
    }
