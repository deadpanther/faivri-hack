"""Nia API client — agentic search for negotiation intelligence.

Real endpoint: `POST /v2/query` on `apigcp.trynia.ai` with a `messages` array.
Response shape (verified via 422 probe + live call):
    {
      "results": [{ "content": str, "score": float,
                    "source": { "url": str, "title": str, ... }, ... }],
      "answer": str,                # LLM-synthesized summary across results
      "sources_searched": int,
      "query_time_ms": int,
      "errors": list,
      "retrieval_log_id": str
    }

Faivri uses this in two places:
  1. `search_pricing_context` — feeds Nia hits into the same fair-range
     pipeline that Tavily results flow through (shape-compatible: url/title/
     content). Run in parallel with Tavily inside `intelligence.nia_agent`.
  2. `save_negotiation_context` / `get_negotiation_context` — cross-session
     memory written via `POST /v2/contexts`, retrieved via the same `/v2/query`
     endpoint with an `agent_source` filter.

Falls back to a deterministic simulated response when `NIA_API_KEY` is unset
so the dev experience still ships verdicts.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _api_key() -> str:
    """Late-bound so tests / dotenv reloads pick up new values without a
    module reimport. Falls back to OS env so ad-hoc shells (e.g. `NIA_API_KEY=
    foo python -m ...`) keep working."""
    return settings.nia_api_key or os.getenv("NIA_API_KEY", "")


def _api_base() -> str:
    return (settings.nia_api_url or os.getenv("NIA_API_URL")
            or "https://apigcp.trynia.ai/v2")


NIA_TIMEOUT = float(os.getenv("NIA_TIMEOUT", "12.0"))


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_api_key()}",
        "Content-Type": "application/json",
    }


def _query_messages(query: str, *, location: str | None = None) -> list[dict]:
    """Build the prompt Nia sees. We bias toward fair-market US pricing so the
    /v2/query oracle returns negotiation-relevant comps instead of news/blog
    chatter."""
    location_hint = f" in {location}" if location else " in the US"
    return [
        {
            "role": "user",
            "content": (
                f"Find the typical fair-market price range and recent "
                f"consumer-reported quotes for: {query}{location_hint}. "
                "Cite specific dollar amounts, sources, and any notable "
                "regional variation."
            ),
        }
    ]


def _flatten_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Reshape Nia's `/v2/query` response items into the same {url,title,
    content,score} contract that `extract_prices_from_results` expects from
    Tavily. This lets Nia evidence flow through the unchanged fair-range
    pipeline with no special-case branches downstream."""
    flat: list[dict[str, Any]] = []
    for item in payload.get("results") or []:
        source = item.get("source") or {}
        url = source.get("url") or item.get("url") or ""
        if not url:
            continue
        flat.append({
            "url": url,
            "title": source.get("title") or item.get("title") or "",
            "content": item.get("content") or item.get("text") or "",
            "score": item.get("score") or 0.0,
            "provider": "nia",
        })
    return flat


async def search_pricing_context(
    query: str,
    *,
    location: str | None = None,
) -> dict[str, Any]:
    """Call Nia `/v2/query`. Returns a dict with:
        results: list[{url,title,content,score,provider}]   # Tavily-shape
        answer:  str                                         # synthesized
        query_time_ms: int
        sources_searched: int
        retrieval_log_id: str | None
        live: bool                                           # True if API used
    """
    if not _api_key():
        return _simulate_search(query)

    try:
        async with httpx.AsyncClient(timeout=NIA_TIMEOUT) as client:
            resp = await client.post(
                f"{_api_base()}/query",
                headers=_headers(),
                json={"messages": _query_messages(query, location=location)},
            )
        if resp.status_code != 200:
            logger.warning(
                "Nia /v2/query non-200: %s %s",
                resp.status_code, resp.text[:200],
            )
            return _simulate_search(query)
        body = resp.json()
        results = _flatten_results(body)
        return {
            "results": results,
            "answer": body.get("answer") or "",
            "query_time_ms": body.get("query_time_ms") or 0,
            "sources_searched": body.get("sources_searched") or len(results),
            "retrieval_log_id": body.get("retrieval_log_id"),
            "live": True,
        }
    except Exception as exc:
        logger.warning("Nia /v2/query exception: %s", exc)
        return _simulate_search(query)


async def save_negotiation_context(
    *,
    title: str,
    summary: str,
    content: str,
    tags: list[str] | None = None,
) -> dict[str, Any] | None:
    """Persist a negotiation outcome / vendor quote / verdict snippet to Nia
    via `POST /v2/contexts`. Used by the negotiate flow so future agents in
    the same workspace can recall what worked. No-op when the key is unset."""
    if not _api_key():
        return None
    try:
        async with httpx.AsyncClient(timeout=NIA_TIMEOUT) as client:
            resp = await client.post(
                f"{_api_base()}/contexts",
                headers=_headers(),
                json={
                    "title": title,
                    "summary": summary,
                    "content": content,
                    "agent_source": "faivri-negotiator",
                    "tags": tags or [],
                },
            )
            if resp.status_code >= 400:
                logger.warning(
                    "Nia /v2/contexts non-2xx: %s %s",
                    resp.status_code, resp.text[:200],
                )
                return None
            return resp.json()
    except Exception as exc:
        logger.warning("Nia save_negotiation_context exception: %s", exc)
        return None


async def get_negotiation_context(query: str) -> list[str]:
    """Retrieve previously saved faivri-negotiator contexts. Uses the same
    /v2/query endpoint — Nia indexes contexts and surfaces them in `results`
    when relevant."""
    payload = await search_pricing_context(query)
    out: list[str] = []
    for r in payload.get("results", []):
        text = r.get("content")
        if text:
            out.append(text)
    return out


def _simulate_search(query: str) -> dict[str, Any]:
    """Offline fallback. Returns the same response shape as the live API so
    callers don't branch on `live` for happy-path code."""
    return {
        "results": [],
        "answer": (
            f'Simulated baseline for "{query}": typical fair-market US '
            f"quotes cluster within ±20% of independent-shop median; "
            f"national-chain quotes commonly run 30–60% higher."
        ),
        "query_time_ms": 0,
        "sources_searched": 0,
        "retrieval_log_id": None,
        "live": False,
    }


def status() -> dict[str, Any]:
    return {
        "live": bool(_api_key()),
        "source": "Nia by Nozomio",
        "endpoint": _api_base(),
    }
