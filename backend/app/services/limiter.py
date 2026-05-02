"""Rate limiting (slowapi).

Uses Redis as the shared counter when `UPSTASH_REDIS_URL` is configured (works
across horizontally-scaled replicas), otherwise falls back to in-memory counters
for local development.

Client IP derivation delegates to `services.net.client_ip` so rate limit,
anonymous quota, and abuse logs always bucket on the same key — and the
X-Forwarded-For spoofing defense lives in one place.

Per-route limits are defined here as constants so they can be tuned in one
place rather than scattered across routers.
"""

from slowapi import Limiter

from app.config import settings
from app.services.net import client_ip

RATE_LIMIT_ANALYZE = "10/minute"
RATE_LIMIT_NEGOTIATE = "20/minute"
RATE_LIMIT_FEEDBACK = "30/minute"
RATE_LIMIT_RECOMMEND = "30/minute"
RATE_LIMIT_VEHICLES_WRITE = "30/minute"
RATE_LIMIT_HISTORY_READ = "60/minute"
RATE_LIMIT_COMMUNITY_READ = "60/minute"
RATE_LIMIT_ADMIN_WRITE = "5/minute"
RATE_LIMIT_DEFAULT = "120/minute"


_storage_uri = settings.upstash_redis_url or "memory://"

limiter = Limiter(
    key_func=client_ip,
    storage_uri=_storage_uri,
    default_limits=[RATE_LIMIT_DEFAULT],
    strategy="fixed-window",
    # Production should degrade gracefully if Redis is temporarily unavailable:
    # keep rate limiting in-process rather than 500'ing every protected route.
    in_memory_fallback=[RATE_LIMIT_DEFAULT],
    in_memory_fallback_enabled=True,
    swallow_errors=True,
)
