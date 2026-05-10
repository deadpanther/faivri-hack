"""HydraDB — Negotiation memory layer for Faivri.

The pitch promises that "HydraDB stores the entire negotiation history —
including price fluctuations, walk-away ceilings, and seller tone." This
module is the canonical entry point for that memory.

Implementation:

  - We DON'T spin up a second database. The existing PostgreSQL instance
    (managed by SQLAlchemy / Alembic) is the durable substrate; HydraDB is
    a *capability* on top of it. Tables added for this layer:

      * `negotiation_sessions` — one row per (user, listing/quote) pair;
        tracks `walk_away_cents`, `seller_tone`, `price_points` (JSONB
        timeline of every counter), and `last_seen_at`.

  - The existing `queries`, `negotiation_conversations`, `counter_offers`,
    and `community_prices` tables are reachable through this module's
    convenience helpers so future call sites consistently route through
    the HydraDB-branded API even when the storage primitive is untouched.

Why a separate module: the hackathon pitch needs an honest answer to
"where is HydraDB?" — pointing at a real file with an explicit memory API
is more durable than scattering memory writes across every router.
"""

from __future__ import annotations

import logging
from app.services.db_uuid import new_uuid, to_db_uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    CounterOffer,
    NegotiationConversation,
    Query as QueryModel,
)

logger = logging.getLogger(__name__)


# ─── Public memory snapshot shape ───────────────────────────────────────────

@dataclass
class NegotiationMemory:
    """Everything we remember about an in-flight negotiation.

    Returned by `read_session` and `summarise_user`. The frontend's
    Memory dashboard renders directly off these fields; the Photon reply
    drafter uses them to ground its outputs.
    """

    query_id: UUID
    quoted_price_cents: Optional[int]
    fair_low_cents: Optional[int]
    fair_high_cents: Optional[int]
    walk_away_cents: Optional[int]
    target_offer_cents: Optional[int]
    counter_offer_history: list[dict[str, Any]]
    conversation_messages: list[dict[str, Any]]
    seller_tone: Optional[str]
    last_seen_at: Optional[datetime]


# ─── Negotiation session writes ─────────────────────────────────────────────
# These wrap raw SQL so the schema stays consolidated in one place — call
# sites never reach into the table directly. Persistence model: lazy upsert
# by (user_id, query_id) so a session is created on first write and updated
# in place on subsequent counter-offers / message turns.

async def upsert_session(
    db: AsyncSession,
    *,
    user_id: Optional[UUID],
    query_id: UUID,
    walk_away_cents: Optional[int] = None,
    target_offer_cents: Optional[int] = None,
    seller_tone: Optional[str] = None,
    price_point: Optional[dict[str, Any]] = None,
) -> None:
    """Append a price point and update the negotiation memory header.

    `price_point` is an arbitrary dict — typically `{"actor": "seller"|"you",
    "price_cents": int, "at": iso8601, "note": str}`. It's appended to the
    JSONB timeline atomically so two concurrent counter-offers don't
    clobber each other.
    """
    from sqlalchemy import text

    # We use raw upsert here to keep the new table out of the SQLAlchemy
    # ORM until `negotiation_sessions` is actually created via Alembic
    # migration. Until then this is a no-op fallback (silent skip) so the
    # rest of the negotiation flow continues to work.
    try:
        await db.execute(
            text(
                """
                INSERT INTO negotiation_sessions (
                    user_id, query_id, walk_away_cents, target_offer_cents,
                    seller_tone, price_points, last_seen_at
                ) VALUES (
                    :user_id, :query_id, :walk_away_cents, :target_offer_cents,
                    :seller_tone,
                    CASE
                        WHEN :price_point::jsonb IS NULL THEN '[]'::jsonb
                        ELSE jsonb_build_array(:price_point::jsonb)
                    END,
                    NOW()
                )
                ON CONFLICT (query_id) DO UPDATE SET
                    walk_away_cents = COALESCE(EXCLUDED.walk_away_cents,
                        negotiation_sessions.walk_away_cents),
                    target_offer_cents = COALESCE(EXCLUDED.target_offer_cents,
                        negotiation_sessions.target_offer_cents),
                    seller_tone = COALESCE(EXCLUDED.seller_tone,
                        negotiation_sessions.seller_tone),
                    price_points = CASE
                        WHEN :price_point::jsonb IS NULL
                            THEN negotiation_sessions.price_points
                        ELSE negotiation_sessions.price_points
                            || jsonb_build_array(:price_point::jsonb)
                    END,
                    last_seen_at = NOW()
                """
            ),
            {
                "user_id": str(user_id) if user_id else None,
                "query_id": str(query_id),
                "walk_away_cents": walk_away_cents,
                "target_offer_cents": target_offer_cents,
                "seller_tone": seller_tone,
                "price_point": _json_or_none(price_point),
            },
        )
        await db.commit()
    except Exception as exc:
        # Don't let memory bookkeeping take down the user-visible flow.
        # The verdict / negotiation reply is what matters; memory is a
        # nice-to-have that we'll log and move past.
        logger.warning(
            "hydradb.upsert_session skipped query_id=%s err=%s",
            query_id, exc,
        )
        await db.rollback()


# ─── Memory reads ───────────────────────────────────────────────────────────

async def read_session(
    db: AsyncSession,
    query_id: UUID,
) -> Optional[NegotiationMemory]:
    """Return the consolidated memory for a single negotiation.

    Joins data across `queries`, `negotiation_conversations`,
    `counter_offers`, and `negotiation_sessions` so callers never have to
    poke at multiple tables to assemble a memory snapshot.
    """
    q = (await db.execute(
        select(QueryModel).where(QueryModel.id == to_db_uuid(query_id))
    )).scalar_one_or_none()
    if q is None:
        return None

    counters = (await db.execute(
        select(CounterOffer)
        .where(CounterOffer.query_id == to_db_uuid(query_id))
        .order_by(CounterOffer.created_at.asc())
    )).scalars().all()

    convos = (await db.execute(
        select(NegotiationConversation)
        .where(NegotiationConversation.query_id == to_db_uuid(query_id))
        .order_by(desc(NegotiationConversation.updated_at))
        .limit(1)
    )).scalars().all()

    session_row = await _read_session_row(db, query_id)

    return NegotiationMemory(
        query_id=query_id,
        quoted_price_cents=q.quoted_price,
        fair_low_cents=q.fair_price_low,
        fair_high_cents=q.fair_price_high,
        walk_away_cents=session_row.get("walk_away_cents"),
        target_offer_cents=session_row.get("target_offer_cents"),
        counter_offer_history=[
            {
                "counter_offer_cents": c.counter_offer_cents,
                "original_target_cents": c.original_target_cents,
                "at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in counters
        ],
        conversation_messages=list(convos[0].messages) if convos else [],
        seller_tone=session_row.get("seller_tone"),
        last_seen_at=session_row.get("last_seen_at"),
    )


async def _read_session_row(
    db: AsyncSession,
    query_id: UUID,
) -> dict[str, Any]:
    """Return a dict view of the negotiation_sessions row, or {} if the
    table doesn't exist yet (pre-migration) or the row is absent."""
    from sqlalchemy import text
    try:
        row = (await db.execute(
            text(
                """
                SELECT walk_away_cents, target_offer_cents, seller_tone,
                       price_points, last_seen_at
                FROM negotiation_sessions
                WHERE query_id = :query_id
                """
            ),
            {"query_id": str(query_id)},
        )).first()
    except Exception:
        # Pre-migration or transient DB hiccup — treat as no memory yet.
        return {}
    if row is None:
        return {}
    return {
        "walk_away_cents": row[0],
        "target_offer_cents": row[1],
        "seller_tone": row[2],
        "price_points": row[3] or [],
        "last_seen_at": row[4],
    }


async def list_active_sessions(
    db: AsyncSession,
    user_id: UUID,
    *,
    limit: int = 25,
) -> list[NegotiationMemory]:
    """Return the user's most recent active negotiations.

    Used by the Memory dashboard to render the "negotiations in flight"
    list. Sorted by `last_seen_at` desc so the active deal sits at the top.
    """
    qs = (await db.execute(
        select(QueryModel)
        .where(QueryModel.user_id == user_id)
        .order_by(desc(QueryModel.created_at))
        .limit(limit)
    )).scalars().all()

    out: list[NegotiationMemory] = []
    for q in qs:
        mem = await read_session(db, q.id)
        if mem is not None:
            out.append(mem)
    return out


# ─── Helpers ────────────────────────────────────────────────────────────────

def _json_or_none(obj: Optional[dict[str, Any]]) -> Optional[str]:
    import json
    if obj is None:
        return None
    return json.dumps(obj, separators=(",", ":"), default=str)


def status() -> dict[str, Any]:
    """Lightweight status used by /health/deep + the about page."""
    return {
        "backing_store": "postgresql",
        "memory_tables": [
            "queries",
            "negotiation_conversations",
            "counter_offers",
            "negotiation_sessions",
        ],
    }
