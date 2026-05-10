"""Daily ceiling for anonymous /analyze traffic.

The slowapi per-minute limit (10/min) handles sustained abuse within a
minute; this module adds a *daily* cap so a single IP can't quietly grind
out thousands of calls over the course of a day (each call costs Tavily +
LLM tokens, so unlimited anonymous traffic is a cost bomb).

We key on *both* IP and a request fingerprint (UA + Accept-Language +
Accept-Encoding hash). Exceeding either cap blocks the request, so
VPN/Tor IP rotation is caught by the fingerprint counter while NAT
collisions behind a shared IP don't unfairly starve distinct users
(they'll each hit their own fingerprint bucket first).

Implemented on Upstash Redis as a counter keyed by
`anon_analyze:{ip|fp}:{YYYY-MM-DD}` with a 36-hour TTL so stale keys
evaporate.

Redis unreachable fallback: we used to fail open (return 0, do nothing)
which turned every Redis blip into an uncapped cost window. Now we keep
a per-process in-memory counter and enforce against it — still imperfect
under horizontal scale, but a single replica can't be abused unboundedly
and the risk shrinks to `replicas × fallback_cap` instead of ∞.
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import OrderedDict
from datetime import datetime, timezone
from threading import Lock

from app.config import settings
from app.services.redis import get_redis


logger = logging.getLogger(__name__)

# Seconds before an IP's daily bucket is garbage-collected. 36h buys enough
# slack that a request arriving at 23:59 UTC still shares a TTL with one
# arriving at 00:01 the next day.
_KEY_TTL_SECONDS = 36 * 60 * 60

# In-memory fallback state. Keys: "{ip}:{YYYY-MM-DD}" → (count, expiry_ts).
# We cap the dict to 10k entries (LRU) so a flood of unique IPs during a
# Redis outage can't balloon process memory.
_FALLBACK_LOCK = Lock()
_FALLBACK_LIMIT = 10_000
_fallback_counts: "OrderedDict[str, tuple[int, float]]" = OrderedDict()


def _today_key(identifier: str) -> str:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"anon_analyze:{identifier}:{today}"


def fingerprint(
    user_agent: str | None,
    accept_language: str | None,
    accept_encoding: str | None,
) -> str:
    """Short stable hash of request headers used as a device signal.

    Not a cryptographic fingerprint — just enough entropy to distinguish
    a handful of users on the same NAT, and to pin an abuser to a single
    bucket across IP rotation.
    """
    raw = "|".join(
        (user_agent or "", accept_language or "", accept_encoding or "")
    ).encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:16]


def _fallback_incr(key: str) -> int:
    now = time.time()
    with _FALLBACK_LOCK:
        # Drop expired entries opportunistically; cheaper than a background GC.
        expired = [k for k, (_, exp) in _fallback_counts.items() if exp <= now]
        for k in expired:
            _fallback_counts.pop(k, None)

        count, _ = _fallback_counts.get(key, (0, 0.0))
        count += 1
        _fallback_counts[key] = (count, now + _KEY_TTL_SECONDS)
        _fallback_counts.move_to_end(key)
        while len(_fallback_counts) > _FALLBACK_LIMIT:
            _fallback_counts.popitem(last=False)
        return count


class AnonymousCapExceeded(Exception):
    def __init__(self, ip: str, cap: int, reason: str = "ip"):
        self.ip = ip
        self.cap = cap
        self.reason = reason
        super().__init__(
            f"Anonymous daily cap ({cap}) reached for {ip} (reason={reason})"
        )


async def _incr(key: str) -> int:
    redis = await get_redis()
    if redis is None:
        return _fallback_incr(key)
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _KEY_TTL_SECONDS)
        return count
    except Exception:
        logger.warning(
            "anonymous cap redis incr failed for %s — using in-memory fallback",
            key,
        )
        return _fallback_incr(key)


async def enforce(ip: str, fp: str | None = None) -> int:
    """Tick IP and fingerprint counters; raise if either exceeds the daily cap.

    Returns the higher of the two post-increment counts so callers can
    log / inject into response headers.
    """
    cap = settings.anonymous_analyze_daily_cap

    ip_count = await _incr(_today_key(ip))
    fp_count = 0
    if fp:
        fp_count = await _incr(_today_key(f"fp:{fp}"))

    if cap:
        if ip_count > cap:
            raise AnonymousCapExceeded(ip=ip, cap=cap, reason="ip")
        if fp and fp_count > cap:
            raise AnonymousCapExceeded(ip=ip, cap=cap, reason="fingerprint")

    return max(ip_count, fp_count)
