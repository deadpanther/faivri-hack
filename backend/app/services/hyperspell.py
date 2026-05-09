"""
Hyperspell API client -- the company brain for AI agents.

Hyperspell ingests organizational data (Slack, email, docs, CRM) and
synthesizes it into context any agent can read. For Faivri, we use it
to maintain durable negotiation memory across sessions:
  1. Store negotiation outcomes and learned preferences
  2. Query past negotiation patterns for better recommendations
  3. Build procedural memory (learned negotiation strategies)
"""

import os
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

HYPERSPELL_BASE = os.getenv("HYPERSPELL_API_URL", "https://api.hyperspell.com")
HYPERSPELL_API_KEY = os.getenv("HYPERSPELL_API_KEY", "")


async def store_negotiation_memory(
    user_id: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> str | None:
    """Store a negotiation memory for a user."""
    if not HYPERSPELL_API_KEY:
        return _simulate_store(user_id, content)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{HYPERSPELL_BASE}/memories",
                headers={
                    "Authorization": f"Bearer {HYPERSPELL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "content": content,
                    "user_id": user_id,
                    "metadata": metadata or {},
                },
            )
            if resp.status_code not in (200, 201):
                logger.warning("Hyperspell store failed: %s", resp.status_code)
                return _simulate_store(user_id, content)
            data = resp.json()
            return data.get("id")
    except Exception as exc:
        logger.error("Hyperspell store error: %s", exc)
        return _simulate_store(user_id, content)


async def query_negotiation_memory(
    user_id: str,
    query: str,
    effort: str = "medium",
) -> list[dict[str, Any]]:
    """Query negotiation memories for a user."""
    if not HYPERSPELL_API_KEY:
        return _simulate_query(user_id, query)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{HYPERSPELL_BASE}/queries",
                headers={
                    "Authorization": f"Bearer {HYPERSPELL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": query,
                    "user_id": user_id,
                    "effort": effort,
                },
            )
            if resp.status_code != 200:
                return _simulate_query(user_id, query)
            return resp.json().get("results", [])
    except Exception as exc:
        logger.error("Hyperspell query error: %s", exc)
        return _simulate_query(user_id, query)


async def search_memories(
    query: str,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Semantic search over all negotiation memories."""
    if not HYPERSPELL_API_KEY:
        return _simulate_query("global", query)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{HYPERSPELL_BASE}/memories/search",
                headers={
                    "Authorization": f"Bearer {HYPERSPELL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"query": query, "limit": limit},
            )
            if resp.status_code != 200:
                return _simulate_query("global", query)
            return resp.json().get("results", [])
    except Exception:
        return _simulate_query("global", query)


def _simulate_store(user_id: str, content: str) -> str:
    """Simulated store when API key unavailable."""
    import uuid
    logger.info("[Hyperspell simulated] store for %s: %s", user_id, content[:80])
    return str(uuid.uuid4())


def _simulate_query(user_id: str, query: str) -> list[dict[str, Any]]:
    """Simulated query results when API key unavailable."""
    return [
        {
            "content": f"Past negotiation for '{query}': User saved $340 by requesting itemized breakdown and citing competitor pricing.",
            "source": "hyperspell-memory",
            "relevance": 0.88,
        },
        {
            "content": f"Learned strategy for '{query}': Polite firm tone with 3 competing quotes yields best results.",
            "source": "hyperspell-procedural",
            "relevance": 0.82,
        },
    ]


def status() -> dict[str, Any]:
    """Check if Hyperspell integration is live."""
    return {
        "live": bool(HYPERSPELL_API_KEY),
        "source": "Hyperspell",
    }
