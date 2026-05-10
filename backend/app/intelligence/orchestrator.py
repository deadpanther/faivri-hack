"""Evidence-first query pipeline — LIVE DATA ONLY, US market.

Pipeline:
    classify
      → cache baseline? → verdict math (fast path)
      → else live web search (Tavily)
        → extract structured prices (regex)
        → compute deterministic fair range + confidence
        → LLM narrates (explanation / red_flags / questions only — never prices)
        → verdict math (conservative + expected overpay)
        → cache the BASELINE (range + evidence summary, not narrative)
        → persist Query row

The LLM never decides the fair price. That is computed in Python from the
extracted evidence, so every verdict is traceable to the URLs cited in the
`sources_used` column. If evidence is too thin (<3 distinct trusted domains),
`compute_fair_range` raises and the caller returns HTTP 503 — no silent
fabrication.
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.market import (
    DEFAULT_COUNTRY,
    SUPPORTED_COUNTRIES,
    currency_for_country,
    normalize_country,
)

# Database enum allow-lists. When the classifier/LLM hallucinates a value
# outside these sets (e.g. domain="toys" or country="UK") persisting the
# row crashes the entire request with a Postgres enum violation. We clamp
# to defaults instead so a flaky LLM can't take down /analyze.
_VALID_DOMAINS = {"auto", "medical", "home", "legal", "retail"}
_DEFAULT_DOMAIN = "auto"
_VALID_VERDICTS = {"fair", "high", "overcharge"}


def _coerce_domain(raw: object) -> str:
    value = (str(raw).strip().lower() if raw else "")
    return value if value in _VALID_DOMAINS else _DEFAULT_DOMAIN


def _coerce_db_country(raw: object) -> str:
    value = normalize_country(str(raw) if raw else None)
    return value if value in SUPPORTED_COUNTRIES else DEFAULT_COUNTRY


def _coerce_verdict(raw: object) -> str | None:
    if not raw:
        return None
    value = str(raw).strip().lower()
    return value if value in _VALID_VERDICTS else None
from app.intelligence.cache import (
    compute_verdict_from_baseline,
    get_cached_baseline,
    set_cached_baseline,
)
from app.intelligence.classifier import classify
from app.intelligence.community import load_community_prices
from app.intelligence.evidence import (
    compute_fair_range,
    compute_verdict_math,
    extract_prices_from_results,
)
from app.intelligence.nia_agent import gather_evidence as nia_gather_evidence
from app.intelligence.synthesizer import narrate_verdict
from app.intelligence.web_search import detect_listing_platform, search_web
from app.models.db import Query

logger = logging.getLogger(__name__)


async def process_query(
    db: AsyncSession,
    query_text: str,
    city: str | None = None,
    country: str | None = None,
    domain: str | None = None,
    quoted_price: int | None = None,
    user_id: str | None = None,
    provider: str | None = None,
    s2_token: str | None = None,
) -> dict:
    """Run the full analysis pipeline — live web data only."""

    # Step 1: classify
    classification = await classify(query_text, city=city, country=country, provider=provider)
    # Only override the classifier when the caller passed a valid service-category
    # enum value. The AnalyzeRequest.domain field has historically been populated
    # with a website host ("facebook.com") by external API consumers — letting
    # that through poisons community_prices lookups (`domain_type` enum) and
    # aborts the SQL transaction, surfacing as a 500.
    if domain and domain in _VALID_DOMAINS:
        classification["domain"] = domain
    if quoted_price is not None:
        classification["quoted_price"] = quoted_price

    effective_price = quoted_price if quoted_price is not None else classification.get("quoted_price")
    detected_country = normalize_country(classification.get("country") or country)
    currency = currency_for_country(detected_country)
    target_city = classification.get("city") or city
    target_state = classification.get("state")
    domain_label = classification.get("domain") or "auto"

    # Step 2: cache hit → fast path (deterministic verdict math only)
    cached_baseline = await get_cached_baseline(classification)
    if cached_baseline:
        verdict = compute_verdict_from_baseline(cached_baseline, effective_price)
        _decorate_verdict_metadata(
            verdict=verdict,
            classification=classification,
            currency=currency,
            detected_country=detected_country,
            effective_price=effective_price,
            live=False,
            cached_at=cached_baseline.get("_cached_at"),
            web_results_count=cached_baseline.get("data_points_count", 0),
            evidence_sources=cached_baseline.get("sources") or [],
        )
        query_id = await _store_query(
            db, query_text, classification, verdict, user_id, currency,
            s2_token=s2_token, from_cache=True,
        )
        verdict["id"] = query_id
        return verdict

    # Step 3: live search — Tavily is the only source.
    # Domain + listing-platform aware: retail queries against eBay / Marketplace
    # listings target used-market comps, not pristine retail. The classifier
    # doesn't always surface `platform`, so we fall back to regex over the
    # query text for terms like "eBay listing" / "Facebook Marketplace".
    listing_platform = (
        classification.get("platform")
        or detect_listing_platform(query_text)
    )
    # Step 3a: NiaAgent fans out Tavily + Nia in parallel and merges
    # by URL. Nia contributes a synthesized `answer` that the synthesizer
    # can credit, plus extra trusted-domain coverage that lifts the
    # confidence_score on thin-evidence queries.
    nia_bundle = await nia_gather_evidence(
        service=classification.get("service") or query_text,
        city=target_city,
        country=detected_country,
        make=classification.get("make"),
        model=classification.get("model"),
        year=classification.get("year"),
        domain_label=domain_label,
        listing_platform=listing_platform,
        raw_query=query_text,
    )
    web_results = nia_bundle["web_results"]
    nia_metadata = nia_bundle["metadata"]

    # Step 4: deterministic extraction + range (raises ValueError on thin evidence)
    web_prices = extract_prices_from_results(
        web_results,
        target_city=target_city,
        target_state=target_state,
        domain_label=domain_label,
        listing_platform=listing_platform,
    )
    community_prices = await load_community_prices(
        db,
        domain=domain_label,
        target_city=target_city,
        target_state=target_state,
        service_query=classification.get("service") or query_text,
        country=detected_country,
    )
    prices = web_prices + community_prices
    fair_range = compute_fair_range(prices)
    fair_range_dict = fair_range.to_dict()

    # Step 5: verdict math from range + user's quoted price
    verdict_math = compute_verdict_math(fair_range, effective_price)

    # Step 6: LLM narrates — never modifies prices
    try:
        narrative = await narrate_verdict(
            query=query_text,
            classification=classification,
            fair_range=fair_range_dict,
            verdict_math=verdict_math,
            evidence_sources=fair_range.sources,
            provider=provider,
        )
    except Exception:
        logger.exception("Narrative LLM call failed — falling back to deterministic copy")
        narrative = {
            "explanation": _deterministic_explanation(verdict_math, fair_range_dict),
            "red_flags": [],
            "questions_to_ask": [],
        }

    # Step 7: assemble verdict
    verdict = {
        **verdict_math,
        "fair_price_low": fair_range.fair_price_low,
        "fair_price_mid": fair_range.fair_price_mid,
        "fair_price_high": fair_range.fair_price_high,
        "confidence_score": fair_range.confidence_score,
        "data_points_count": fair_range.data_points_count,
        "explanation": narrative.get("explanation", ""),
        "red_flags": narrative.get("red_flags", []),
        "questions_to_ask": narrative.get("questions_to_ask", []),
        "evidence": {
            "trusted_count": fair_range.trusted_count,
            "local_count": fair_range.local_count,
            "distinct_trusted_domains": fair_range.distinct_trusted_domains,
            "std_dev_cents": fair_range.std_dev_cents,
            "sources": fair_range.sources,
        },
    }

    _decorate_verdict_metadata(
        verdict=verdict,
        classification=classification,
        currency=currency,
        detected_country=detected_country,
        effective_price=effective_price,
        live=True,
        cached_at=None,
        web_results_count=len(web_results),
        evidence_sources=fair_range.sources,
    )
    verdict["sources"]["nia"] = {
        "live": nia_metadata.get("nia_live", False),
        "results_count": nia_metadata.get("nia_results_count", 0),
        "answer_present": nia_metadata.get("nia_answer_present", False),
        "answer": nia_metadata.get("nia_answer", ""),
        "query_time_ms": nia_metadata.get("nia_query_time_ms", 0),
        "sources_searched": nia_metadata.get("nia_sources_searched", 0),
        "retrieval_log_id": nia_metadata.get("nia_retrieval_log_id"),
    }
    verdict["sources"]["tavily"] = {
        "results_count": nia_metadata.get("tavily_results_count", 0),
    }

    # Step 8: cache the baseline — range + evidence summary only, NO narrative
    baseline = {
        "fair_price_low": fair_range.fair_price_low,
        "fair_price_mid": fair_range.fair_price_mid,
        "fair_price_high": fair_range.fair_price_high,
        "confidence_score": fair_range.confidence_score,
        "data_points_count": fair_range.data_points_count,
        "trusted_count": fair_range.trusted_count,
        "local_count": fair_range.local_count,
        "distinct_trusted_domains": fair_range.distinct_trusted_domains,
        "std_dev_cents": fair_range.std_dev_cents,
        "sources": fair_range.sources,
        "_cached_at": datetime.utcnow().isoformat(),
    }
    await set_cached_baseline(classification, baseline)

    # Step 9: persist
    query_id = await _store_query(
        db, query_text, classification, verdict, user_id, currency, s2_token=s2_token,
    )
    verdict["id"] = query_id
    return verdict


def _decorate_verdict_metadata(
    *,
    verdict: dict,
    classification: dict,
    currency: str,
    detected_country: str,
    effective_price: int | None,
    live: bool,
    cached_at: str | None,
    web_results_count: int,
    evidence_sources: list[dict],
) -> None:
    """Attach response metadata the frontend needs."""
    verdict["currency"] = currency
    verdict["domain"] = classification.get("domain") or "auto"
    verdict["location_city"] = classification.get("city") or "Unknown"
    verdict["location_country"] = detected_country
    verdict["quoted_price"] = effective_price
    verdict["sources"] = {
        "web_search": web_results_count,
        "live": live,
        "cached": not live,
        "evidence_count": len(evidence_sources),
    }
    verdict["freshness"] = {
        "source": "live" if live else "cached_baseline",
        "live_search": live,
        "web_results_count": web_results_count,
        "fetched_at": datetime.utcnow().isoformat() if live else None,
        "cached_at": cached_at,
    }


async def refresh_query_baseline(
    db: AsyncSession,
    query: Query,
) -> dict:
    """Re-run the evidence pipeline for a stored query (LIVE-P1-07).

    The negotiate endpoint calls this when the verdict is older than the
    staleness threshold so the scripts anchor on prices that match today's
    market, not yesterday's snapshot. We re-run the live search + fair-range
    computation only — no new Query row, no new narrative — and mutate the
    existing row in place so the caller keeps a stable `query_id`.

    Raises the same exceptions as the full pipeline (ValueError on thin
    evidence) so the negotiate router can fall back to the stale numbers
    rather than 5xx the user out of a working coach.
    """
    service_query = query.input_text or ""
    target_city = query.location_city
    target_state = None
    domain_label = query.domain or "auto"
    detected_country = normalize_country(query.location_country)
    listing_platform = detect_listing_platform(service_query)

    web_results = await search_web(
        service=service_query,
        city=target_city,
        country=detected_country,
        domain_label=domain_label,
        listing_platform=listing_platform,
    )
    web_prices = extract_prices_from_results(
        web_results,
        target_city=target_city,
        target_state=target_state,
        domain_label=domain_label,
        listing_platform=listing_platform,
    )
    community_prices_list = await load_community_prices(
        db,
        domain=domain_label,
        target_city=target_city,
        target_state=target_state,
        service_query=service_query,
        country=detected_country,
    )
    prices = web_prices + community_prices_list
    fair_range = compute_fair_range(prices)
    verdict_math = compute_verdict_math(fair_range, query.quoted_price)

    # Update the row in-place. Leave narrative fields untouched — they belong
    # to the original verdict's moment in time; the frontend shows the
    # `freshness` marker to signal that the numbers were refreshed.
    query.fair_price_low = fair_range.fair_price_low
    query.fair_price_high = fair_range.fair_price_high
    query.confidence_score = fair_range.confidence_score
    query.data_points_count = fair_range.data_points_count
    query.verdict = verdict_math.get("verdict")
    query.overcharge_multiplier = verdict_math.get("overcharge_multiplier")
    query.sources_used = {
        "trusted_count": fair_range.trusted_count,
        "local_count": fair_range.local_count,
        "distinct_trusted_domains": fair_range.distinct_trusted_domains,
        "std_dev_cents": fair_range.std_dev_cents,
        "sources": fair_range.sources,
    }
    query.created_at = datetime.utcnow()
    await db.commit()

    return {
        "fair_price_low": fair_range.fair_price_low,
        "fair_price_high": fair_range.fair_price_high,
        "fair_price_mid": fair_range.fair_price_mid,
        "confidence_score": fair_range.confidence_score,
        "data_points_count": fair_range.data_points_count,
        "refreshed_at": datetime.utcnow().isoformat(),
        "web_results_count": len(web_results),
    }


def _deterministic_explanation(verdict_math: dict, fair_range: dict) -> str:
    fair_low = fair_range.get("fair_price_low", 0) / 100
    fair_high = fair_range.get("fair_price_high", 0) / 100
    conservative = verdict_math.get("conservative_overpay", 0) / 100
    label = verdict_math.get("verdict", "fair")
    if label == "fair":
        return f"Your quote falls within the fair range of ${fair_low:,.0f}–${fair_high:,.0f}."
    return (
        f"Your quote is above the fair range of ${fair_low:,.0f}–${fair_high:,.0f}. "
        f"Conservative overpay: ${conservative:,.0f}."
    )


async def _store_query(
    db: AsyncSession,
    query_text: str,
    classification: dict,
    verdict: dict,
    user_id: str | None,
    currency: str,
    s2_token: str | None = None,
    from_cache: bool = False,
) -> str:
    """Persist the query and verdict."""

    query_id = str(uuid.uuid4())

    db_query = Query(
        id=query_id,
        user_id=user_id,
        domain=_coerce_domain(classification.get("domain")),
        input_text=query_text,
        location_city=classification.get("city") or "Unknown",
        location_country=_coerce_db_country(classification.get("country")),
        currency=currency,
        quoted_price=verdict.get("quoted_price"),
        fair_price_low=verdict.get("fair_price_low"),
        fair_price_high=verdict.get("fair_price_high"),
        verdict=_coerce_verdict(verdict.get("verdict")),
        overcharge_multiplier=verdict.get("overcharge_multiplier"),
        confidence_score=verdict.get("confidence_score"),
        data_points_count=verdict.get("data_points_count"),
        explanation=verdict.get("explanation"),
        red_flags=verdict.get("red_flags"),
        questions_to_ask=verdict.get("questions_to_ask"),
        sources_used=verdict.get("evidence") or verdict.get("sources"),
        llm_model_used="cache" if from_cache else settings.default_provider,
        cost_cents=0 if from_cache else 15,
        s2_token=s2_token,
        created_at=datetime.utcnow(),
    )

    db.add(db_query)
    await db.commit()

    return query_id
