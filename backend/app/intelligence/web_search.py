"""
LIVE web search via Tavily — the only data source for pricing.
No year filtering. Tavily returns the freshest results by default.
US market only.

Domain-aware query construction. For repair/service domains (auto, home,
medical, legal) we target trusted citation domains. For retail — especially
second-hand listings on eBay / Facebook Marketplace / Craigslist — we
explicitly look for *used* comps: eBay sold listings (real completed sales),
Marketplace pricing, and recent secondhand asks. Quoting a pristine retail
price against a used listing was a demo bug (a $70 Marketplace handbag was
getting compared against a $10 parts-catalog hit); the retail-specific
queries below are the fix for that class of issue.
"""

import asyncio
import logging
from datetime import datetime
from typing import Iterable

from app.services.tavily import search as tavily_search

logger = logging.getLogger(__name__)

# Hard cap — enough for evidence diversity without blowing up the LLM prompt
# downstream. Was 8, which was too tight for MIN_TRUSTED_DOMAINS.
_MAX_UNIQUE_RESULTS = 24


def _build_retail_queries(
    *,
    service: str,
    city_str: str,
    listing_platform: str | None,
) -> list[str]:
    """Retail query set, biased to used-market comps when a marketplace is
    involved. Keeps one pristine-retail query in the mix so new-in-box items
    still get proper anchors."""
    platform = (listing_platform or "").lower()
    is_used_market = any(
        p in platform
        for p in ("ebay", "facebook", "marketplace", "craigslist", "mercari", "offerup", "poshmark")
    )

    queries: list[str] = []
    if is_used_market:
        # Used-first: three of four queries target secondhand comps.
        queries.extend([
            f'"{service}" ebay sold listings completed price',
            f'"{service}" facebook marketplace used price',
            f'"{service}" used resale value {city_str}'.strip(),
            f"{service} retail price amazon walmart best buy",
        ])
    else:
        # New-goods retail: retail anchors first, used as sanity check.
        queries.extend([
            f"{service} price amazon walmart best buy newegg target",
            f"{service} current retail price USA {city_str}".strip(),
            f"{service} ebay sold listings price",
            f"{service} price review comparison",
        ])
    return queries


def _build_service_queries(
    *,
    service: str,
    city_str: str,
    vehicle: str,
) -> list[str]:
    """Service / repair / professional query set — three queries tuned for
    citation-grade domains (RepairPal, KBB, Jiffy Lube, HomeAdvisor, etc.)."""
    return [
        f"{service} cost price {vehicle} {city_str} USA".strip(),
        f"{service} average cost United States repair estimate",
        f"{service} price repairpal kbb homewyse angi homeadvisor jiffy lube",
    ]


async def search_web(
    service: str,
    city: str | None = None,
    country: str | None = None,
    make: str | None = None,
    model: str | None = None,
    year: str | None = None,
    *,
    domain_label: str | None = None,
    listing_platform: str | None = None,
) -> list[dict]:
    """Search the web for LIVE pricing information (US market).

    - For retail domain: queries target used-market comps (eBay sold,
      Marketplace) when `listing_platform` hints at a secondhand platform,
      otherwise target big-box new-goods retail.
    - For service domains (auto/home/medical/legal): queries target
      citation-grade reference domains.

    Raises ValueError if Tavily returns zero results across all queries
    (no silent fallbacks).
    """
    vehicle = ""
    if make:
        vehicle = make
        if model:
            vehicle += f" {model}"
        if year:
            vehicle += f" {year}"

    city_str = city or ""
    if (domain_label or "").lower() == "retail":
        queries = _build_retail_queries(
            service=service, city_str=city_str, listing_platform=listing_platform,
        )
    else:
        queries = _build_service_queries(
            service=service, city_str=city_str, vehicle=vehicle,
        )

    async def _safe(q: str) -> tuple[str, list[dict]]:
        try:
            return q, await tavily_search(q, max_results=10)
        except Exception as exc:
            logger.warning("Tavily search failed for query %r: %s", q[:80], exc)
            return q, []

    search_results = await asyncio.gather(*(_safe(q) for q in queries))

    all_results: list[dict] = []
    seen_urls: set[str] = set()

    for query, results in search_results:
        for r in results:
            url = r.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_results.append({
                    "title": r.get("title", ""),
                    "content": r.get("content", ""),
                    "url": url,
                    "score": r.get("score", 0),
                    "query_used": query,
                    "fetched_at": datetime.now().isoformat(),
                })

    if not all_results:
        raise ValueError(
            f"No live pricing data found for '{service}' in {city_str or 'the US'}. "
            "Cannot produce an accurate verdict without real market data."
        )

    all_results.sort(key=lambda x: x.get("score", 0), reverse=True)
    trimmed = all_results[:_MAX_UNIQUE_RESULTS]
    logger.info(
        "Tavily returned %d unique results across %d queries for "
        "service=%r city=%r domain=%r platform=%r",
        len(trimmed), len(queries), service[:40], city_str,
        domain_label, listing_platform,
    )
    return trimmed


def detect_listing_platform(query_text: str) -> str | None:
    """Lightweight heuristic to extract a secondhand-platform hint from free
    text so callers that don't receive a structured `platform` field still
    trigger used-market search queries."""
    if not query_text:
        return None
    lowered = query_text.lower()
    platform_terms: Iterable[tuple[str, str]] = (
        ("ebay", "eBay"),
        ("facebook marketplace", "Facebook Marketplace"),
        ("marketplace listing", "Facebook Marketplace"),
        ("craigslist", "Craigslist"),
        ("mercari", "Mercari"),
        ("offerup", "OfferUp"),
        ("poshmark", "Poshmark"),
        ("depop", "Depop"),
    )
    for needle, canonical in platform_terms:
        if needle in lowered:
            return canonical
    return None
