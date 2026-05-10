"""GET /api/v1/memory — HydraDB negotiation memory dashboard.

Surfaces the consolidated memory snapshot HydraDB maintains per
negotiation: walk-away ceiling, target offer, seller tone, price-point
timeline, and recent message history. The frontend's /memory page reads
the list endpoint and drills into individual sessions on click.

Auth: required. We don't expose negotiation memory anonymously — by the
time you have a stored walk-away ceiling, you're a signed-in user and
HydraDB needs the user_id to scope the query.
"""

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.auth import require_user_id
from app.services.database import get_db
from app.services.hydradb import list_active_sessions, read_session

logger = logging.getLogger(__name__)

router = APIRouter()


def _serialize(memory) -> dict[str, Any]:
    return {
        "query_id": str(memory.query_id),
        "quoted_price_cents": memory.quoted_price_cents,
        "fair_low_cents": memory.fair_low_cents,
        "fair_high_cents": memory.fair_high_cents,
        "walk_away_cents": memory.walk_away_cents,
        "target_offer_cents": memory.target_offer_cents,
        "counter_offer_history": memory.counter_offer_history,
        "conversation_messages": memory.conversation_messages,
        "seller_tone": memory.seller_tone,
        "last_seen_at": memory.last_seen_at.isoformat() if memory.last_seen_at else None,
    }


@router.get("/memory/sessions")
async def list_memory_sessions(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """List the user's recent negotiations with summary memory."""
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        # Clerk-id case — until the sub→UUID mapping ships, return an empty
        # list rather than 500. The user just won't see anything until the
        # next analysis associates a UUID profile.
        return {"sessions": []}

    sessions = await list_active_sessions(db, uid, limit=25)
    return {"sessions": [_serialize(s) for s in sessions]}


@router.get("/memory/sessions/{query_id}")
async def get_memory_session(
    query_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Return the full memory snapshot for one negotiation."""
    memory = await read_session(db, query_id)
    if memory is None:
        raise HTTPException(status_code=404, detail="No memory for that query.")
    return _serialize(memory)
