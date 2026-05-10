"""Community-price evidence loader.

Reads recent `community_prices` rows that match the user's service + geography
and converts them into `ExtractedPrice` records so they merge with Tavily
evidence in the same `compute_fair_range` call. Paid-price reports are
higher-signal than listing prices but also unverified — we treat the community
as a single trusted "domain" so a flood of reports can't fake diversity.

Matching strategy (LIVE-P1-10):
    1. If the user's query produces a non-empty canonical fingerprint AND the
       row has `service_fingerprint` set → exact fingerprint match.
    2. Otherwise fall back to the legacy token-overlap heuristic so rows
       inserted before the canonicalization migration still cluster.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.canonicalize import service_fingerprint
from app.intelligence.evidence import ExtractedPrice, PriceType
from app.models.db import CommunityPrice

logger = logging.getLogger(__name__)

COMMUNITY_WINDOW_DAYS = 90

# Paid-price reports from actual users are high-signal evidence, but they are
# unverified and pre-canonicalization. 0.80 lets them count as trusted-tier
# (>= TRUST_TRUSTED=0.6) without outweighing curated domains like RepairPal
# that carry weight 1.0.
COMMUNITY_TRUST_WEIGHT = 0.80

# All community rows share this synthetic domain so they count as exactly ONE
# "distinct trusted domain" in compute_fair_range's diversity check. Without
# this, a poisoning attack could fake domain diversity by submitting many rows.
COMMUNITY_DOMAIN_LABEL = "community.faivri"

# Cap per call so a hot city doesn't explode evidence size.
COMMUNITY_MAX_RECORDS = 25

# Token length floor for the fuzzy service matcher — dropping "a", "the",
# "for", etc. prevents false positives on short filler words.
_MIN_TOKEN_LEN = 4


def _extract_tokens(text: str) -> set[str]:
    """Lowercase alpha tokens of length >= _MIN_TOKEN_LEN."""
    if not text:
        return set()
    return {
        tok.lower()
        for tok in re.findall(r"[a-zA-Z]+", text)
        if len(tok) >= _MIN_TOKEN_LEN
    }


async def load_community_prices(
    db: AsyncSession,
    *,
    domain: str,
    target_city: Optional[str],
    target_state: Optional[str],
    service_query: str,
    country: str = "US",
) -> list[ExtractedPrice]:
    """Fetch community-reported prices that plausibly match the user's query.

    Returns ExtractedPrice records ready to merge with Tavily evidence. Failure
    (DB error, malformed rows) returns `[]` — community is additive and must
    never block a live verdict from producing.
    """
    try:
        cutoff = datetime.utcnow() - timedelta(days=COMMUNITY_WINDOW_DAYS)
        # Explicit column list: the ORM default `select(CommunityPrice)` expands
        # to every mapped column, which fails on deploys where the prod schema
        # is behind the model (e.g. `query_id` not yet migrated). Community
        # evidence is additive — we don't need `query_id` here, so omit it.
        stmt = (
            select(
                CommunityPrice.id,
                CommunityPrice.domain,
                CommunityPrice.service_type,
                CommunityPrice.price_paid,
                CommunityPrice.city,
                CommunityPrice.country,
                CommunityPrice.created_at,
            )
            .where(
                CommunityPrice.domain == domain,
                CommunityPrice.country == country,
                CommunityPrice.created_at >= cutoff,
                CommunityPrice.price_paid > 0,
            )
            .order_by(CommunityPrice.created_at.desc())
            .limit(COMMUNITY_MAX_RECORDS)
        )
        if target_city:
            stmt = stmt.where(CommunityPrice.city.ilike(f"%{target_city}%"))

        result = await db.execute(stmt)
        rows = list(result.all())
    except Exception as exc:
        # Graceful degrade: community is additive. Log one line, no traceback —
        # the most common failure is a schema drift on prod that ops should
        # notice via the warning count, not a 60-line stack on every request.
        logger.warning(
            "Community price lookup failed (%s): %s — degrading to no community evidence",
            type(exc).__name__, str(exc)[:160],
        )
        return []

    query_fingerprint = service_fingerprint(service_query)
    query_tokens = _extract_tokens(service_query)
    records: list[ExtractedPrice] = []
    for row in rows:
        # Prefer exact fingerprint match when both sides have one. Fall back
        # to token overlap for legacy rows that predate the canonicalization
        # migration (and for queries that canonicalize to "unknown").
        # `getattr` with a default makes us tolerant of test fixtures and of
        # any pre-migration row that might lack the column.
        row_fingerprint = getattr(row, "service_fingerprint", None)
        if query_fingerprint and row_fingerprint:
            if row_fingerprint != query_fingerprint:
                continue
        else:
            service_tokens = _extract_tokens(row.service_type or "")
            if query_tokens and service_tokens and query_tokens.isdisjoint(service_tokens):
                continue

        city = row.city or ""
        is_local = bool(target_city and target_city.lower() in city.lower())

        snippet = (
            f"Community report: user paid ${row.price_paid / 100:,.0f} in {city} "
            f"for {row.service_type or 'this service'}."
        )[:280]

        records.append(
            ExtractedPrice(
                url=f"community://faivri/{row.id}",
                domain_root=COMMUNITY_DOMAIN_LABEL,
                title=f"Community report — {city}"[:280],
                price_cents=int(row.price_paid),
                price_type=PriceType.TOTAL,
                raw_snippet=snippet,
                trust_weight=COMMUNITY_TRUST_WEIGHT,
                is_local=is_local,
                city_hint=target_city,
                state_hint=target_state,
            )
        )

    return records
