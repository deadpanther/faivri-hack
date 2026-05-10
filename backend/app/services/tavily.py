"""
Tavily web search — the ONLY pricing data source.
No silent failures. If Tavily can't deliver, the pipeline must know.

Includes a global monthly spend cap so a single abuser can't burn through
the dev-tier 1000-call budget. The counter is Redis-backed (works across
replicas) with an in-memory fallback when Redis is unreachable.
"""

import logging
import time
from datetime import datetime, timezone
from threading import Lock

import httpx

from app.config import settings
from app.services.redis import get_redis

logger = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"

# Monthly counter key + TTL. 35 days lets the key naturally expire one cycle
# after its month rolls over, instead of relying on a cron to GC it.
_MONTH_KEY_TTL_SECONDS = 35 * 24 * 60 * 60

# In-memory fallback. (count, expiry_ts) keyed by `tavily:YYYY-MM`. Bounded
# by month length, so no unbounded growth concern here.
_FALLBACK_LOCK = Lock()
_fallback_counts: dict[str, tuple[int, float]] = {}


class TavilyMonthlyCapExceeded(RuntimeError):
    """Raised when the global Tavily monthly search budget is exhausted.

    Caller (intelligence pipeline) sees this as a RuntimeError and turns it
    into a 503 — same shape as a Tavily outage, since from the user's POV
    "we can't search" is the relevant fact regardless of whether the search
    provider or our budget is the bottleneck.
    """


def _month_key() -> str:
    now = datetime.now(timezone.utc)
    return f"tavily:{now.strftime('%Y-%m')}"


def _fallback_incr(key: str) -> int:
    now = time.time()
    with _FALLBACK_LOCK:
        # Drop expired keys opportunistically.
        for k in [k for k, (_, exp) in _fallback_counts.items() if exp <= now]:
            _fallback_counts.pop(k, None)
        count, _ = _fallback_counts.get(key, (0, 0.0))
        count += 1
        _fallback_counts[key] = (count, now + _MONTH_KEY_TTL_SECONDS)
        return count


async def _incr_monthly() -> int:
    key = _month_key()
    redis = await get_redis()
    if redis is None:
        return _fallback_incr(key)
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _MONTH_KEY_TTL_SECONDS)
        return count
    except Exception:
        logger.warning(
            "tavily monthly cap redis incr failed for %s — using in-memory fallback",
            key,
        )
        return _fallback_incr(key)


async def _enforce_monthly_cap() -> None:
    cap = settings.tavily_monthly_search_cap
    if cap <= 0:
        return
    count = await _incr_monthly()
    if count > cap:
        # Log loud — operators need to see this fire so they can either
        # raise the cap, upgrade the Tavily plan, or block whatever's
        # driving the spike before it turns into a real bill.
        logger.error(
            "tavily monthly cap exceeded: count=%d cap=%d", count, cap
        )
        raise TavilyMonthlyCapExceeded(
            "Live web search budget for this month is exhausted. "
            "Try again after the 1st, or contact support if this is urgent."
        )


async def search(query: str, max_results: int = 10) -> list[dict]:
    """Search the web using Tavily API.

    Raises RuntimeError if Tavily is not configured or fails.
    We do NOT silently return [] — the caller must handle the error explicitly.

    max_results was 5; bumped to 10 because the evidence pipeline needs
    diversity to hit MIN_TRUSTED_DOMAINS. search_depth was "basic"; using
    "advanced" so we get richer content for price extraction. Costs 2
    credits per search instead of 1, acceptable for verdict quality.
    """
    if not settings.tavily_api_key:
        raise RuntimeError(
            "Tavily API key not configured. Live web search is required — "
            "set TAVILY_API_KEY in your environment."
        )

    # Tick the global monthly counter BEFORE the network call. Two reasons:
    # 1. It bounds spend even if Tavily is slow/timing-out (each timeout
    #    still costs us a credit on their side).
    # 2. The counter doubles as a useful spend telemetry signal even when
    #    individual calls fail.
    await _enforce_monthly_cap()

    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            response = await client.post(
                TAVILY_URL,
                json={
                    "api_key": settings.tavily_api_key,
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "advanced",
                    "include_answer": False,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("results", [])
        except httpx.TimeoutException:
            # Log query length only — the raw text can contain PII (user
            # context, medical details, etc.) and logs are retained 30d.
            logger.error("Tavily search timed out (query_len=%d)", len(query))
            raise RuntimeError(
                "Live web search timed out. "
                "Cannot produce accurate pricing without real-time data."
            )
        except httpx.HTTPStatusError as e:
            logger.error(
                "Tavily API error status=%s query_len=%d",
                e.response.status_code, len(query),
            )
            raise RuntimeError(
                f"Tavily API returned error {e.response.status_code}. "
                "Live pricing data unavailable."
            )
        except RuntimeError:
            raise
        except Exception as e:
            logger.exception("Tavily search failed")
            raise RuntimeError("Live web search failed. Please retry shortly.") from e
