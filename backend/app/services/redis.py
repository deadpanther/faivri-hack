import json
import logging
from typing import Optional

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)

_client: Optional[redis.Redis] = None


async def get_redis() -> Optional[redis.Redis]:
    global _client
    if not settings.upstash_redis_url:
        return None
    if _client is None:
        _client = redis.from_url(settings.upstash_redis_url, decode_responses=True)
    return _client


async def cache_get(key: str) -> Optional[dict]:
    r = await get_redis()
    if r is None:
        return None
    try:
        val = await r.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.warning("Redis cache_get failed for key %s: %s", key[:60], str(e))
        return None


async def cache_set(key: str, value: dict, ttl: int = 14400) -> None:
    r = await get_redis()
    if r is None:
        return
    try:
        await r.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception as e:
        logger.warning("Redis cache_set failed for key %s: %s", key[:60], str(e))


async def cache_flush_all() -> int:
    """Flush all FairCheck cache keys (fc:* prefix). Returns count deleted."""
    r = await get_redis()
    if r is None:
        return 0
    try:
        keys = []
        async for key in r.scan_iter(match="fc:*", count=500):
            keys.append(key)
        if keys:
            await r.delete(*keys)
        return len(keys)
    except Exception as e:
        logger.warning("Redis cache_flush_all failed: %s", str(e))
        return 0
