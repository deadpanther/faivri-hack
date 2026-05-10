"""Enforce a max-active-sessions cap per profile.

Called from the auth dependency after a JWT has been verified and the
profile has been resolved. Upserts a row keyed by the Clerk `sid` claim
so every authed request touches `last_seen_at`. When a *new* sid arrives
for a user who already has `MAX_ACTIVE_SESSIONS` live sessions, we pick
the oldest (by `last_seen_at`) and revoke it via Clerk's Backend API.

Design:
  * Evict oldest, not reject newest. Users want the device they *just
    logged into* to work. Surprising them with "Can't sign in here,
    you're already on 2 devices" is worse than quietly booting the laptop
    they haven't touched in a week.
  * Anonymous traffic has no sid → function is a no-op.
  * If the *current* sid was previously revoked by the cap, we raise
    SessionRevokedByCap so the auth layer can return a discriminated 401.
    Clerk's frontend SDK takes up to ~60s to notice a revoke (JWT TTL),
    and during that window we still see the old token. We must NOT silently
    un-revoke the row — that would defeat the cap.
  * Any other error is swallowed. The cap is a UX polish, not a security
    boundary — if the bookkeeping misfires once on a DB hiccup, the user
    just stays logged in on 3 devices for an hour. The real security
    boundary is Clerk's JWT.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import ProfileSession
from app.services.clerk_admin import revoke_session


logger = logging.getLogger(__name__)


class SessionRevokedByCap(Exception):
    """Current sid was already revoked by a newer login on another device.

    Raised by `touch_and_enforce` when the request comes in on a JWT whose
    Clerk session id maps to a `ProfileSession` row with `revoked_at` set.
    The auth layer translates this into a 401 carrying a header the frontend
    uses to show the "signed out on another device" toast.
    """


async def touch_and_enforce(
    db: AsyncSession,
    user_id: str,
    clerk_session_id: str,
    user_agent: Optional[str] = None,
) -> None:
    """Upsert the session row, and if the user is over the cap, revoke
    their oldest still-active session.

    Raises SessionRevokedByCap when the request comes in on an already-
    revoked sid (so the caller can 401 with a discriminator).
    """
    if not user_id or not clerk_session_id:
        return

    try:
        # Touch (or insert) the row for *this* session first. We do this
        # unconditionally so the cap check below correctly counts a brand
        # new session against the cap.
        now = datetime.utcnow()
        # Only touch rows that aren't revoked. If the row exists but IS
        # revoked, the UPDATE returns nothing — we then check the row
        # explicitly and raise SessionRevokedByCap rather than silently
        # un-revoking it (which would let device 1 keep using its still-
        # valid JWT after device 3 already kicked it).
        result = await db.execute(
            update(ProfileSession)
            .where(
                ProfileSession.clerk_session_id == clerk_session_id,
                ProfileSession.revoked_at.is_(None),
            )
            .values(last_seen_at=now)
            .returning(ProfileSession.id)
        )
        touched = result.scalar_one_or_none()
        if touched is None:
            # Either no row at all (first request on this sid) or the row
            # exists but is revoked. Disambiguate with a SELECT.
            existing = await db.execute(
                select(ProfileSession.id, ProfileSession.revoked_at)
                .where(ProfileSession.clerk_session_id == clerk_session_id)
            )
            row = existing.first()
            if row is not None and row.revoked_at is not None:
                # Don't commit anything — leave the row as revoked.
                await db.rollback()
                raise SessionRevokedByCap()

            session = ProfileSession(
                id=str(uuid.uuid4()),
                user_id=user_id,
                clerk_session_id=clerk_session_id,
                user_agent=(user_agent or "")[:500] or None,
                first_seen_at=now,
                last_seen_at=now,
            )
            db.add(session)
            try:
                await db.flush()
            except IntegrityError:
                # Race: two concurrent first-requests for the same new sid.
                # Roll back this unit of work, then retry as an UPDATE so we
                # still touch `last_seen_at` (still respecting the revoked
                # filter — if it was revoked between then and now, we just
                # skip the touch and let the next branch handle it).
                await db.rollback()
                await db.execute(
                    update(ProfileSession)
                    .where(
                        ProfileSession.clerk_session_id == clerk_session_id,
                        ProfileSession.revoked_at.is_(None),
                    )
                    .values(last_seen_at=now)
                )

        # Count active (non-revoked) sessions for this user AFTER the upsert.
        active = await db.execute(
            select(ProfileSession.id, ProfileSession.clerk_session_id, ProfileSession.last_seen_at)
            .where(
                ProfileSession.user_id == user_id,
                ProfileSession.revoked_at.is_(None),
            )
            .order_by(ProfileSession.last_seen_at.asc())
        )
        rows = list(active.all())
        excess = len(rows) - settings.max_active_sessions
        if excess <= 0:
            await db.commit()
            return

        # Revoke the oldest `excess` sessions, but never the session that
        # just made this request (that's the one the user expects to work).
        victims = [r for r in rows if r.clerk_session_id != clerk_session_id][:excess]
        for victim in victims:
            await revoke_session(victim.clerk_session_id)
            await db.execute(
                update(ProfileSession)
                .where(ProfileSession.id == victim.id)
                .values(revoked_at=now)
            )
            logger.info(
                "session cap evict user=%s revoked_session=%s",
                user_id, victim.clerk_session_id,
            )
        await db.commit()
    except SessionRevokedByCap:
        # Surface this — the caller turns it into a 401 with a discriminator.
        raise
    except Exception:
        logger.exception("session_cap touch_and_enforce failed user=%s", user_id)
        try:
            await db.rollback()
        except Exception:
            pass
