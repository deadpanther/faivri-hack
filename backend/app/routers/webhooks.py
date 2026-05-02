"""POST /api/v1/webhooks/lemonsqueezy — subscription state ingress.

Lemon Squeezy calls this URL when a user subscribes, upgrades, cancels, or
fails payment. We verify the HMAC signature on the raw body, look up the
profile by Clerk user id (sent in the `custom_data` the checkout was
launched with), and flip their `plan` column.

Signature scheme: `X-Signature: <hex>` over the raw body using
`LEMONSQUEEZY_SIGNING_SECRET` with SHA-256. If verification fails or the
secret is unset we return 401 so LS retries — never trust the payload.

Variant → plan mapping is config-driven (env vars) so the same code ships
to test mode with sandbox variant IDs.

**Idempotency** — every delivery is logged in `webhook_events` keyed by
`(provider, event_id)` with a unique constraint. A retry after a 5xx hits
that constraint and we short-circuit with 204 without re-applying the
plan transition. Required for Stripe launch (Stripe retries aggressively
on any non-2xx).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import Profile, WebhookEvent, WebhookFailure
from app.services.auth import require_admin
from app.services.database import get_db


logger = logging.getLogger(__name__)

router = APIRouter()


def _variant_to_plan(variant_id: str) -> Optional[str]:
    """Map a Lemon Squeezy variant id to our internal plan key."""
    if not variant_id:
        return None
    variant_str = str(variant_id)
    if variant_str in (
        settings.lemonsqueezy_variant_command,
        settings.lemonsqueezy_variant_command_scholar,
    ):
        return "command"
    if variant_str in (
        settings.lemonsqueezy_variant_signal,
        settings.lemonsqueezy_variant_signal_scholar,
    ):
        return "signal"
    return None


def _is_boost_variant(variant_id: str) -> bool:
    boost = settings.lemonsqueezy_variant_boost
    return bool(boost) and str(variant_id) == boost


def _extract_boost_variant_ids(payload: dict) -> list[str]:
    """Pull every variant_id out of an order_created payload.

    LS order payloads carry line items under `data.attributes.first_order_item`
    (single) and/or `included[*].attributes` (nested relationships). We walk
    both so a bundled Boost Pack + something else order still credits boosts.
    """
    ids: list[str] = []
    attrs = (payload.get("data") or {}).get("attributes") or {}
    first_item = attrs.get("first_order_item") or {}
    variant = first_item.get("variant_id")
    if variant is not None:
        ids.append(str(variant))

    for item in payload.get("included") or []:
        if item.get("type") != "order-items":
            continue
        variant = (item.get("attributes") or {}).get("variant_id")
        if variant is not None:
            ids.append(str(variant))
    return ids


def _verify_signature(raw_body: bytes, signature: str) -> bool:
    secret = settings.lemonsqueezy_signing_secret
    if not secret or not signature:
        return False
    expected = hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    # constant-time compare so timing attacks can't probe the secret byte by byte
    return hmac.compare_digest(expected, signature)


async def _find_profile_by_clerk_id(db: AsyncSession, clerk_user_id: str) -> Optional[Profile]:
    result = await db.execute(
        select(Profile).where(Profile.clerk_user_id == clerk_user_id)
    )
    return result.scalar_one_or_none()


async def _find_profile_by_subscription(db: AsyncSession, subscription_id: str) -> Optional[Profile]:
    result = await db.execute(
        select(Profile).where(Profile.lemonsqueezy_subscription_id == subscription_id)
    )
    return result.scalar_one_or_none()


async def _record_event(
    db: AsyncSession,
    provider: str,
    event_id: str,
    event_name: str,
    payload: dict,
) -> bool:
    """Insert the event row; return True if it's new, False if duplicate.

    Caller must `await db.commit()` or `await db.rollback()` as part of
    the enclosing transaction — we only flush here so the unique
    constraint fires.
    """
    entry = WebhookEvent(
        provider=provider,
        event_id=event_id,
        event_name=event_name,
        payload=payload,
    )
    db.add(entry)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def _record_failure(
    db: AsyncSession,
    *,
    provider: str,
    event_id: Optional[str],
    event_name: Optional[str],
    payload: dict,
    error: str,
) -> None:
    """Best-effort DLQ write. Runs in its own transaction so a poisoned
    main transaction (already rolled back) can still land the failure row."""
    try:
        await db.rollback()
        failure = WebhookFailure(
            provider=provider,
            event_id=event_id,
            event_name=event_name,
            payload=payload,
            error=error[:4000],
        )
        db.add(failure)
        await db.commit()
    except Exception:
        logger.exception(
            "webhook DLQ write failed provider=%s event_id=%s", provider, event_id
        )


@router.post("/webhooks/lemonsqueezy", status_code=204)
async def lemonsqueezy_webhook(
    request: Request,
    x_signature: Optional[str] = Header(None),
    x_event_name: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    raw_body = await request.body()
    if not _verify_signature(raw_body, x_signature or ""):
        raise HTTPException(status_code=401, detail="invalid signature")

    try:
        payload = await request.json()
    except (ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="invalid json")

    # Prefer event_name from the signed payload over the header — headers are
    # not covered by the HMAC, so a reverse-proxy header injection could lie.
    event = (payload.get("meta", {}).get("event_name") or x_event_name or "").strip()
    data = payload.get("data", {}) or {}
    attrs = data.get("attributes", {}) or {}
    custom = payload.get("meta", {}).get("custom_data", {}) or {}
    subscription_id = str(data.get("id") or "")
    clerk_user_id = str(custom.get("clerk_user_id") or "")

    # Lemon Squeezy embeds a unique event id at meta.webhook_id. We require
    # it — a body-hash fallback lets an attacker replay a whitespace-mutated
    # body past idempotency, re-triggering the plan transition.
    event_id = str(payload.get("meta", {}).get("webhook_id") or "")
    if not event_id:
        logger.warning("lemonsqueezy webhook missing meta.webhook_id — rejecting")
        raise HTTPException(status_code=400, detail="missing meta.webhook_id")

    # Freshness check: bound the replay window even if webhook_events ever
    # gets cleared. 15-minute window covers LS's own retry cadence.
    created_iso = str(attrs.get("created_at") or attrs.get("updated_at") or "").strip()
    if created_iso:
        try:
            created_at = datetime.fromisoformat(created_iso.replace("Z", "+00:00"))
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            age = datetime.now(timezone.utc) - created_at
            if age > timedelta(minutes=settings.webhook_max_age_minutes):
                logger.warning(
                    "lemonsqueezy webhook stale event_id=%s age=%s — rejecting",
                    event_id, age,
                )
                raise HTTPException(status_code=400, detail="stale event")
        except (ValueError, TypeError) as exc:
            # Malformed timestamp shouldn't bring down webhook processing —
            # idempotency layer below still protects against body replay.
            logger.warning(
                "lemonsqueezy webhook created_at parse error event_id=%s: %s",
                event_id, exc,
            )

    is_new = await _record_event(
        db, provider="lemonsqueezy", event_id=event_id,
        event_name=event, payload=payload,
    )
    if not is_new:
        logger.info(
            "lemonsqueezy webhook duplicate event_id=%s event=%s — skipping",
            event_id, event,
        )
        return

    profile = None
    if clerk_user_id:
        profile = await _find_profile_by_clerk_id(db, clerk_user_id)
    if profile is None and subscription_id:
        profile = await _find_profile_by_subscription(db, subscription_id)

    if profile is None:
        # Don't surface a 404 to LS or it will keep retrying; log and accept.
        # This normally means the checkout was run without `custom_data`.
        logger.warning(
            "lemonsqueezy webhook '%s' sub=%s clerk=%s — no profile match",
            event, subscription_id, clerk_user_id,
        )
        await db.commit()
        return

    try:
        await _apply_lemonsqueezy_event(
            db=db,
            profile=profile,
            event=event,
            event_id=event_id,
            attrs=attrs,
            payload=payload,
            subscription_id=subscription_id,
        )
        await db.commit()
        return
    except HTTPException:
        raise
    except Exception as exc:
        # Park the raw payload in the DLQ so ops can replay. Rollback
        # restores a clean session for the DLQ insert; idempotency log
        # goes with it, so LS's next retry gets a fresh shot at the event.
        logger.exception(
            "lemonsqueezy webhook apply failed event=%s event_id=%s", event, event_id,
        )
        await _record_failure(
            db, provider="lemonsqueezy", event_id=event_id,
            event_name=event, payload=payload, error=str(exc),
        )
        # Return 500 so LS retries — the DLQ row is for *us*, not a
        # substitute for retries.
        raise HTTPException(status_code=500, detail="webhook apply failed")


async def _apply_lemonsqueezy_event(
    *,
    db: AsyncSession,
    profile: Profile,
    event: str,
    event_id: str,
    attrs: dict,
    payload: dict,
    subscription_id: str,
) -> None:
    """Apply a validated LS event to the profile and mark the event row
    processed. Caller commits / rolls back."""
    if event in {"subscription_created", "subscription_updated", "subscription_resumed"}:
        variant_id = str(attrs.get("variant_id") or "")
        new_plan = _variant_to_plan(variant_id)
        if new_plan:
            profile.plan = new_plan
            profile.lemonsqueezy_subscription_id = subscription_id
            logger.info(
                "lemonsqueezy: profile=%s plan→%s via variant=%s sub=%s",
                profile.id, new_plan, variant_id, subscription_id,
            )
        else:
            logger.warning(
                "lemonsqueezy: unknown variant=%s on event=%s profile=%s",
                variant_id, event, profile.id,
            )

    elif event in {"subscription_cancelled", "subscription_expired", "subscription_paused"}:
        profile.plan = "scout"
        logger.info(
            "lemonsqueezy: profile=%s plan→scout (event=%s sub=%s)",
            profile.id, event, subscription_id,
        )

    elif event == "subscription_payment_failed":
        logger.info(
            "lemonsqueezy: payment_failed profile=%s sub=%s (plan unchanged)",
            profile.id, subscription_id,
        )

    elif event == "order_created":
        boost_hits = [v for v in _extract_boost_variant_ids(payload) if _is_boost_variant(v)]
        if boost_hits:
            credited = settings.boost_pack_credits * len(boost_hits)
            profile.boost_credits = (profile.boost_credits or 0) + credited
            logger.info(
                "lemonsqueezy: profile=%s boost+=%d (total=%d) via order=%s",
                profile.id, credited, profile.boost_credits, subscription_id,
            )

    event_row = await db.execute(
        select(WebhookEvent).where(
            WebhookEvent.provider == "lemonsqueezy",
            WebhookEvent.event_id == event_id,
        )
    )
    row = event_row.scalar_one_or_none()
    if row is not None:
        row.processed_at = datetime.utcnow()


# ─── Admin DLQ endpoints ──────────────────────────────────────────────────
#
# Gated on X-Admin-Api-Key. List unresolved failures; replay one by rerunning
# the apply pipeline on the stored payload; mark-resolved when a row is
# stale (LS already retried and succeeded) or applied out-of-band.


class DLQItem(BaseModel):
    id: str
    provider: str
    event_id: Optional[str]
    event_name: Optional[str]
    error: str
    received_at: datetime
    resolved_at: Optional[datetime]


class DLQListResponse(BaseModel):
    items: list[DLQItem]
    total_unresolved: int


class DLQReplayResponse(BaseModel):
    id: str
    status: str
    detail: Optional[str] = None


@router.get("/webhooks/dlq", response_model=DLQListResponse)
async def list_dlq(
    include_resolved: bool = False,
    limit: int = 50,
    _admin: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    limit = max(1, min(limit, 200))
    stmt = select(WebhookFailure).order_by(WebhookFailure.received_at.desc()).limit(limit)
    if not include_resolved:
        stmt = stmt.where(WebhookFailure.resolved_at.is_(None))
    rows = (await db.execute(stmt)).scalars().all()

    count_stmt = select(WebhookFailure).where(WebhookFailure.resolved_at.is_(None))
    unresolved = len((await db.execute(count_stmt)).scalars().all())

    return DLQListResponse(
        items=[
            DLQItem(
                id=str(r.id),
                provider=r.provider,
                event_id=r.event_id,
                event_name=r.event_name,
                error=r.error,
                received_at=r.received_at,
                resolved_at=r.resolved_at,
            )
            for r in rows
        ],
        total_unresolved=unresolved,
    )


@router.post("/webhooks/dlq/{failure_id}/replay", response_model=DLQReplayResponse)
async def replay_dlq(
    failure_id: str,
    _admin: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Re-apply a dead-letter row. Only Lemon Squeezy payloads supported.

    The stored payload already passed signature verification on first
    delivery — we trust it for replay. If the apply succeeds we mark the
    failure row resolved; otherwise we update the `error` in place so
    ops can see the latest failure reason without accumulating rows.
    """
    try:
        import uuid as _uuid
        failure_uuid = _uuid.UUID(failure_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="invalid failure_id")

    row = (
        await db.execute(
            select(WebhookFailure).where(WebhookFailure.id == failure_uuid)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="DLQ row not found")
    if row.resolved_at is not None:
        return DLQReplayResponse(id=str(row.id), status="already_resolved")
    if row.provider != "lemonsqueezy":
        raise HTTPException(
            status_code=400, detail=f"unsupported provider '{row.provider}'"
        )

    payload = row.payload or {}
    meta = payload.get("meta") or {}
    data = payload.get("data") or {}
    attrs = data.get("attributes") or {}
    custom = meta.get("custom_data") or {}
    event = (meta.get("event_name") or row.event_name or "").strip()
    event_id = str(meta.get("webhook_id") or row.event_id or "")
    subscription_id = str(data.get("id") or "")
    clerk_user_id = str(custom.get("clerk_user_id") or "")

    profile = None
    if clerk_user_id:
        profile = await _find_profile_by_clerk_id(db, clerk_user_id)
    if profile is None and subscription_id:
        profile = await _find_profile_by_subscription(db, subscription_id)
    if profile is None:
        return DLQReplayResponse(
            id=str(row.id), status="no_profile_match",
            detail="no profile matches clerk_user_id or subscription_id",
        )

    try:
        await _apply_lemonsqueezy_event(
            db=db,
            profile=profile,
            event=event,
            event_id=event_id,
            attrs=attrs,
            payload=payload,
            subscription_id=subscription_id,
        )
        row.resolved_at = datetime.utcnow()
        await db.commit()
        return DLQReplayResponse(id=str(row.id), status="replayed")
    except Exception as exc:
        await db.rollback()
        # Refetch and update the failure row with the latest error.
        fresh = (
            await db.execute(
                select(WebhookFailure).where(WebhookFailure.id == failure_uuid)
            )
        ).scalar_one_or_none()
        if fresh is not None:
            fresh.error = f"replay failed: {str(exc)}"[:4000]
            await db.commit()
        logger.exception(
            "DLQ replay failed id=%s event=%s event_id=%s", failure_id, event, event_id,
        )
        raise HTTPException(status_code=500, detail=f"replay failed: {str(exc)}")


@router.post("/webhooks/dlq/{failure_id}/resolve", response_model=DLQReplayResponse)
async def resolve_dlq(
    failure_id: str,
    _admin: None = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Mark a DLQ row resolved without replaying. Use when the event was
    superseded (e.g. LS retried successfully) or applied out-of-band."""
    try:
        import uuid as _uuid
        failure_uuid = _uuid.UUID(failure_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="invalid failure_id")

    row = (
        await db.execute(
            select(WebhookFailure).where(WebhookFailure.id == failure_uuid)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="DLQ row not found")
    if row.resolved_at is not None:
        return DLQReplayResponse(id=str(row.id), status="already_resolved")
    row.resolved_at = datetime.utcnow()
    await db.commit()
    return DLQReplayResponse(id=str(row.id), status="resolved")
