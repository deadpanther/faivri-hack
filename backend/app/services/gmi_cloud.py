"""GMI Cloud — Real-time GPU inference fleet adapter.

Faivri routes every model call through this thin abstraction so we can:

  1. Burst onto GMI Cloud's GPU pool when latency matters (sub-10s end-to-end),
  2. Fall back to managed providers (Anthropic, OpenAI) when GMI Cloud is not
     configured or its breaker is tripped,
  3. Tag every inference with the partner that served it for the
     "Powered by" telemetry surfaced in the verdict UI.

The adapter is intentionally minimal — it does *not* re-implement the full
LLM client surface. Instead, it wraps `app.services.llm` (which already
handles per-provider routing, vision, transcription, and circuit-breaking)
and adds GMI Cloud as a preferred-but-optional first hop.

Set `GMI_CLOUD_API_KEY` to enable; without it, behaviour is identical to
calling `app.services.llm` directly. The wrapper records which backend
served the request via the returned `InferenceResult.served_by` field so
downstream code can render an honest "Powered by GMI Cloud" badge only when
that's actually true.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

from app import services as _services_pkg  # noqa: F401  (ensure package init runs)
from app.config import settings
from app.services import llm as managed_llm

logger = logging.getLogger(__name__)


# ─── Configuration ──────────────────────────────────────────────────────────

# GMI Cloud is opt-in. When the key is unset, every call transparently
# routes through `app.services.llm` and `served_by` reports the underlying
# managed provider so UI badges stay truthful.
GMI_CLOUD_API_KEY = os.environ.get("GMI_CLOUD_API_KEY", "")
GMI_CLOUD_BASE_URL = os.environ.get(
    "GMI_CLOUD_BASE_URL",
    "https://api.gmicloud.ai/v1",
)
# Conservative default — sub-10s end-to-end is the brand promise. Anything
# slower than this on the GPU fleet should fall back to the managed provider
# rather than blow the SLA.
GMI_CLOUD_TIMEOUT_SECONDS = float(os.environ.get("GMI_CLOUD_TIMEOUT", "8.0"))


def is_configured() -> bool:
    """True when an API key is present. Callers can short-circuit fallbacks
    with this rather than catching exceptions."""
    return bool(GMI_CLOUD_API_KEY)


# ─── Result shape ───────────────────────────────────────────────────────────

@dataclass
class InferenceResult:
    """Wrapper around any model output so callers know who actually served it.

    `served_by` is one of: "gmi_cloud", "anthropic", "openai". The verdict
    page surfaces this in the freshness badge so users see honest provenance
    rather than a marketing promise.
    """

    payload: Any
    served_by: str
    latency_ms: int


# ─── Public API ─────────────────────────────────────────────────────────────

async def fast_completion(
    *,
    system: str,
    user: str,
    requested_provider: str = "anthropic",
    max_tokens: int = 1024,
) -> InferenceResult:
    """Run a fast classification/extraction call.

    Tries GMI Cloud's GPU fleet first when configured; falls back to the
    managed LLM (`app.services.llm._chat` with `model_tier="fast"`) on
    timeout, breaker trip, or absence of a key. Always returns a populated
    `InferenceResult` — never raises for fallback alone.
    """
    return await _route(
        system=system,
        user=user,
        gmi_model="gmi-fast-v1",
        managed_tier="fast",
        requested_provider=requested_provider,
        max_tokens=max_tokens,
        timeout_s=GMI_CLOUD_TIMEOUT_SECONDS,
    )


async def strong_synthesis(
    *,
    requested_provider: str,
    system: str,
    user: str,
    max_tokens: int = 4096,
) -> InferenceResult:
    """Run a strong synthesis/negotiation call.

    Same routing pattern as `fast_completion` but reserved for the heavy
    Sonnet/GPT-4o tier on the managed fallback.
    """
    return await _route(
        system=system,
        user=user,
        gmi_model="gmi-strong-v1",
        managed_tier="strong",
        requested_provider=requested_provider,
        max_tokens=max_tokens,
        timeout_s=GMI_CLOUD_TIMEOUT_SECONDS * 2,
    )


async def _route(
    *,
    system: str,
    user: str,
    gmi_model: str,
    managed_tier: str,
    requested_provider: str,
    max_tokens: int,
    timeout_s: float,
) -> InferenceResult:
    started = time.monotonic()

    if is_configured():
        try:
            payload = await _gmi_inference(
                system + "\n\n" + user,
                model=gmi_model,
                max_tokens=max_tokens,
                timeout_s=timeout_s,
            )
            return InferenceResult(
                payload=payload,
                served_by="gmi_cloud",
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        except _GmiCloudUnavailable as exc:
            logger.info(
                "gmi_cloud fallback tier=%s requested=%s reason=%s",
                managed_tier, requested_provider, exc.reason,
            )

    payload = await managed_llm._chat(  # type: ignore[attr-defined]
        messages=[{"role": "user", "content": user}],
        system=system,
        provider=requested_provider,
        max_tokens=max_tokens,
        model_tier=managed_tier,
    )
    return InferenceResult(
        payload=payload,
        served_by=managed_llm._pick_healthy_provider(requested_provider),  # type: ignore[attr-defined]
        latency_ms=int((time.monotonic() - started) * 1000),
    )


# ─── GMI Cloud HTTP client ──────────────────────────────────────────────────

class _GmiCloudUnavailable(Exception):
    """Raised when GMI Cloud is configured but the call could not complete
    within the SLA. The caller is expected to fall back to a managed
    provider rather than surface this to the user."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


async def _gmi_inference(
    prompt: str,
    *,
    model: str,
    max_tokens: int,
    timeout_s: float,
) -> str:
    """Call GMI Cloud's OpenAI-compatible inference endpoint.

    Implementation detail: GMI Cloud exposes an OpenAI-compatible chat
    completions API on their hosted GPU fleet. We use httpx directly here
    rather than the OpenAI SDK to keep the dependency footprint minimal and
    so a hung GMI Cloud instance can't share a connection pool with
    OpenAI's managed API.
    """
    import httpx

    if not GMI_CLOUD_API_KEY:
        raise _GmiCloudUnavailable("not_configured")

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            res = await client.post(
                f"{GMI_CLOUD_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {GMI_CLOUD_API_KEY}",
                    "Content-Type": "application/json",
                    "X-Faivri-Source": "negotiation-agent",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except httpx.TimeoutException as exc:
        raise _GmiCloudUnavailable(f"timeout:{exc.__class__.__name__}") from exc
    except httpx.HTTPError as exc:
        raise _GmiCloudUnavailable(f"http_error:{exc.__class__.__name__}") from exc

    if res.status_code >= 500:
        raise _GmiCloudUnavailable(f"upstream_5xx:{res.status_code}")
    if res.status_code == 429:
        raise _GmiCloudUnavailable("rate_limited")
    if res.status_code >= 400:
        # 4xx from GMI Cloud is almost always a configuration mistake (bad
        # model id / wrong region). Surfacing it to the caller would give
        # the user a useless error; treating it as a fallback condition
        # keeps the request alive.
        raise _GmiCloudUnavailable(f"client_error:{res.status_code}")

    body = res.json()
    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise _GmiCloudUnavailable(f"malformed_response:{exc.__class__.__name__}") from exc


# Convenience health summary used by `/health/deep` and the about page.
def status() -> dict[str, Any]:
    return {
        "configured": is_configured(),
        "base_url": GMI_CLOUD_BASE_URL if is_configured() else None,
        "default_timeout_s": GMI_CLOUD_TIMEOUT_SECONDS,
    }
