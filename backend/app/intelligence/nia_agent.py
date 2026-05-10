"""NiaAgent — fans out Tavily + Nia in parallel and merges the evidence.

Why this exists:
    Tavily is fast and broad but returns raw web text; Nia returns curated
    pricing context plus a synthesized answer over its own indexed sources.
    Running them together gives the fair-range pipeline more distinct trusted
    domains (which directly lifts `confidence_score`) and surfaces a
    Nia-authored summary the frontend can credit as "Powered by Nia".

Contract (compat with `intelligence.web_search.search_web`):
    Returns a list[dict] of merged results in {url, title, content, score,
    query_used, fetched_at, provider} shape — drops in unchanged to
    `extract_prices_from_results`. The `metadata` companion call exposes
    Nia-only stats so the orchestrator can decorate the verdict.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from app.intelligence.web_search import search_web
from app.services import nia as nia_service

logger = logging.getLogger(__name__)


class NiaAgentResult(dict):
    """Just a typed-feeling dict so callers can `result["web_results"]` etc.
    Kept lightweight — no pydantic — because this rides the hot /analyze path."""


async def gather_evidence(
    *,
    service: str,
    city: str | None = None,
    country: str | None = None,
    make: str | None = None,
    model: str | None = None,
    year: str | None = None,
    domain_label: str | None = None,
    listing_platform: str | None = None,
    raw_query: str | None = None,
) -> NiaAgentResult:
    """Run Tavily + Nia concurrently. Tavily failure raises (it's the
    primary source); Nia failure degrades silently to an empty contribution."""

    nia_query = raw_query or service
    location_hint = ", ".join(p for p in (city, country) if p)

    async def _tavily() -> list[dict]:
        return await search_web(
            service=service,
            city=city,
            country=country,
            make=make,
            model=model,
            year=year,
            domain_label=domain_label,
            listing_platform=listing_platform,
        )

    async def _nia() -> dict:
        try:
            return await nia_service.search_pricing_context(
                nia_query, location=location_hint or None,
            )
        except Exception as exc:
            logger.warning("NiaAgent: Nia call failed: %s", exc)
            return {
                "results": [], "answer": "", "query_time_ms": 0,
                "sources_searched": 0, "retrieval_log_id": None, "live": False,
            }

    tavily_results, nia_payload = await asyncio.gather(_tavily(), _nia())

    merged = _merge_results(tavily_results, nia_payload)
    metadata = {
        "tavily_results_count": len(tavily_results),
        "nia_results_count": len(nia_payload.get("results") or []),
        "nia_answer_present": bool((nia_payload.get("answer") or "").strip()),
        "nia_answer": (nia_payload.get("answer") or "")[:600],
        "nia_query_time_ms": nia_payload.get("query_time_ms") or 0,
        "nia_sources_searched": nia_payload.get("sources_searched") or 0,
        "nia_retrieval_log_id": nia_payload.get("retrieval_log_id"),
        "nia_live": bool(nia_payload.get("live")),
    }

    logger.info(
        "NiaAgent merge — tavily=%d nia=%d nia_live=%s nia_ms=%d",
        metadata["tavily_results_count"],
        metadata["nia_results_count"],
        metadata["nia_live"],
        metadata["nia_query_time_ms"],
    )

    return NiaAgentResult(
        web_results=merged,
        metadata=metadata,
    )


def _merge_results(
    tavily_results: list[dict],
    nia_payload: dict[str, Any],
) -> list[dict]:
    """Dedupe by URL, preserve Tavily's score-sorted order, then append Nia
    hits whose URLs aren't already present. Nia rows get a `provider` tag so
    the synthesizer can credit them."""
    seen: set[str] = set()
    merged: list[dict] = []

    fetched_at = datetime.utcnow().isoformat()

    for r in tavily_results:
        url = (r.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        merged.append({**r, "provider": r.get("provider") or "tavily"})

    for r in nia_payload.get("results") or []:
        url = (r.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        merged.append({
            "url": url,
            "title": r.get("title") or "",
            "content": r.get("content") or "",
            "score": r.get("score") or 0.0,
            "query_used": "nia:/v2/query",
            "fetched_at": fetched_at,
            "provider": "nia",
        })

    return merged
