"""
Firecrawl — secondary data source for Extension Pro (Seller Risk Score +
Stale-Listing watch).

Tavily stays primary for price comps. Firecrawl is used when we need
structured extraction from a specific URL the user is currently viewing
(e.g. the seller profile page, or the listing itself to check if it is
still active and at what price).

This service is *optional*. If the Firecrawl key is not set, callers
receive `None` and must degrade gracefully — the Pro features are gated
behind plan entitlement at the router level, so Basic users never hit
this path.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

FIRECRAWL_BASE = "https://api.firecrawl.dev/v1"
SCRAPE_TIMEOUT = 25.0
EXTRACT_TIMEOUT = 40.0


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.firecrawl_api_key}",
        "Content-Type": "application/json",
    }


def is_configured() -> bool:
    return bool(settings.firecrawl_api_key)


async def scrape(
    url: str,
    formats: Optional[list[str]] = None,
    only_main_content: bool = True,
) -> Optional[dict[str, Any]]:
    """Scrape a single URL and return Firecrawl's `data` payload.

    Returns None on any failure — callers decide whether that degrades the
    feature (e.g. Seller Risk Score falls back to Tavily search) or hard-fails.
    """
    if not is_configured():
        logger.info("Firecrawl not configured — skipping scrape for %s", url[:80])
        return None

    payload: dict[str, Any] = {
        "url": url,
        "formats": formats or ["markdown"],
        "onlyMainContent": only_main_content,
    }

    async with httpx.AsyncClient(timeout=SCRAPE_TIMEOUT) as client:
        try:
            response = await client.post(
                f"{FIRECRAWL_BASE}/scrape",
                json=payload,
                headers=_headers(),
            )
            response.raise_for_status()
            body = response.json()
            if not body.get("success"):
                logger.warning(
                    "Firecrawl scrape returned success=false for %s: %s",
                    url[:80],
                    body.get("error"),
                )
                return None
            return body.get("data")
        except httpx.TimeoutException:
            logger.warning("Firecrawl scrape timed out for %s", url[:80])
            return None
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Firecrawl scrape HTTP %s for %s", e.response.status_code, url[:80]
            )
            return None
        except Exception:
            logger.exception("Firecrawl scrape failed for %s", url[:80])
            return None


async def extract(
    url: str,
    schema: dict[str, Any],
    prompt: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Structured extraction — Firecrawl runs an LLM over the page to pull
    fields matching `schema` (JSON-schema-ish dict).

    Used for seller-profile extraction where we want typed fields (account
    age, listing count, feedback score) instead of raw markdown.
    """
    if not is_configured():
        return None

    payload: dict[str, Any] = {
        "urls": [url],
        "schema": schema,
    }
    if prompt:
        payload["prompt"] = prompt

    async with httpx.AsyncClient(timeout=EXTRACT_TIMEOUT) as client:
        try:
            response = await client.post(
                f"{FIRECRAWL_BASE}/extract",
                json=payload,
                headers=_headers(),
            )
            response.raise_for_status()
            body = response.json()
            if not body.get("success"):
                logger.warning(
                    "Firecrawl extract returned success=false for %s: %s",
                    url[:80],
                    body.get("error"),
                )
                return None
            data = body.get("data")
            # /extract returns { data: { ...fields } } when synchronous, or a
            # job id when async. We request sync by default (single URL).
            return data if isinstance(data, dict) else None
        except httpx.TimeoutException:
            logger.warning("Firecrawl extract timed out for %s", url[:80])
            return None
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Firecrawl extract HTTP %s for %s", e.response.status_code, url[:80]
            )
            return None
        except Exception:
            logger.exception("Firecrawl extract failed for %s", url[:80])
            return None
