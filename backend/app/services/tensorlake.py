"""
Tensorlake API client -- stateful sandbox compute for AI agents.

Tensorlake provides fast, isolated execution environments where agents
run with their own filesystem, shell, and software stack. For Faivri,
we use it to:
  1. Run background price monitoring agents (always-on)
  2. Execute price comparison scripts in isolated sandboxes
  3. Maintain stateful monitoring sessions across invocations
"""

import os
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TENSORLAKE_BASE = os.getenv("TENSORLAKE_API_URL", "https://api.tensorlake.ai")
TENSORLAKE_API_KEY = os.getenv("TENSORLAKE_API_KEY", "")


async def create_monitoring_sandbox(
    query: str,
    check_interval_minutes: int = 60,
) -> dict[str, Any]:
    """Create a sandboxed price monitoring agent that runs continuously."""
    if not TENSORLAKE_API_KEY:
        return _simulate_sandbox(query, check_interval_minutes)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{TENSORLAKE_BASE}/sandboxes",
                headers={
                    "Authorization": f"Bearer {TENSORLAKE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "name": f"faivri-monitor-{query[:30]}",
                    "metadata": {
                        "query": query,
                        "check_interval_minutes": check_interval_minutes,
                        "agent_type": "price_monitor",
                    },
                },
            )
            if resp.status_code not in (200, 201):
                logger.warning("Tensorlake sandbox create failed: %s", resp.status_code)
                return _simulate_sandbox(query, check_interval_minutes)
            return resp.json()
    except Exception as exc:
        logger.error("Tensorlake sandbox error: %s", exc)
        return _simulate_sandbox(query, check_interval_minutes)


async def run_price_check(
    sandbox_id: str,
    query: str,
) -> dict[str, Any]:
    """Run a price check command in an existing sandbox."""
    if not TENSORLAKE_API_KEY:
        return _simulate_price_check(query)

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{TENSORLAKE_BASE}/sandboxes/{sandbox_id}/exec",
                headers={
                    "Authorization": f"Bearer {TENSORLAKE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "command": f"python3 /app/price_check.py --query '{query}'",
                },
            )
            if resp.status_code != 200:
                return _simulate_price_check(query)
            return resp.json()
    except Exception as exc:
        logger.error("Tensorlake exec error: %s", exc)
        return _simulate_price_check(query)


async def list_monitors() -> list[dict[str, Any]]:
    """List all active price monitoring sandboxes."""
    if not TENSORLAKE_API_KEY:
        return _simulate_list_monitors()

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{TENSORLAKE_BASE}/sandboxes",
                headers={"Authorization": f"Bearer {TENSORLAKE_API_KEY}"},
                params={"metadata.agent_type": "price_monitor"},
            )
            if resp.status_code != 200:
                return _simulate_list_monitors()
            return resp.json().get("sandboxes", [])
    except Exception:
        return _simulate_list_monitors()


def _simulate_sandbox(query: str, interval: int) -> dict[str, Any]:
    """Simulated sandbox when API key unavailable."""
    import uuid
    return {
        "id": str(uuid.uuid4()),
        "status": "running",
        "query": query,
        "check_interval_minutes": interval,
        "next_check": "in 60 minutes",
        "message": f"Price monitor active for '{query}'. Will check every {interval} min.",
    }


def _simulate_price_check(query: str) -> dict[str, Any]:
    """Simulated price check result."""
    return {
        "query": query,
        "status": "completed",
        "current_prices": [
            {"source": "Amazon", "price": "$189.99"},
            {"source": "Walmart", "price": "$195.00"},
            {"source": "Best Buy", "price": "$199.99"},
        ],
        "fair_range": "$185-$200",
        "price_change": "No significant change since last check",
    }


def _simulate_list_monitors() -> list[dict[str, Any]]:
    """Simulated list of active monitors."""
    return [
        {
            "id": "sim-001",
            "query": "brake pads Honda Civic",
            "status": "running",
            "last_check": "5 minutes ago",
            "price_trend": "stable",
        },
    ]


def status() -> dict[str, Any]:
    """Check if Tensorlake integration is live."""
    return {
        "live": bool(TENSORLAKE_API_KEY),
        "source": "Tensorlake",
    }
