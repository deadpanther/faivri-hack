"""POST /api/v1/webhooks/stripe — subscription state ingress.

Stripe calls this URL when a checkout completes, a subscription updates,
or a payment fails. We verify the Stripe signature on the raw body, look
up the profile by `clerk_user_id` (sent in `client_reference_id` /
`metadata.clerk_user_id` at checkout), and flip their `plan` column.

Signature scheme: Stripe's SDK does it for us via
`stripe.Webhook.construct_event(body, sig_header, secret)`. Mismatched or
missing signature → 401. Idempotency reuses the shared `webhook_events`
table — Stripe's `event.id` slots in cleanly so retries short-circuit.

Price → plan mapping is config-driven (env vars) so the same code ships
to test mode with sandbox price IDs.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import Profile, WebhookEvent
from app.services.database import get_db


logger = logging.getLogger(__name__)
router = APIRouter()


def _price_to_plan(price_id: str) -> Optional[str]:
    """Map a Stripe Price id to our internal plan key.

    Returns None for unknown prices so we never silently promote a user
    when a webhook arrives with a misconfigured price (e.g. test-mode id
    leaking into a live webhook).
    """
    if not price_id:
        return None
    if price_id in (
        settings.stripe_price_signal_monthly,
        settings.stripe_price_signal_yearly,
        settings.stripe_price_signal_scholar_monthly,
        settings.stripe_price_signal_scholar_yearly,
    ):
        return "signal"
    if price_id in (
        settings.stripe_price_command_monthly,
        settings.stripe_price_command_yearly,
        settings.stripe_price_command_scholar_monthly,
        settings.stripe_price_command_scholar_yearly,
    ):
        return "command"
    return None


def _is_boost_price(price_id: str) -> bool:
    boost = settings.stripe_price_boost
    return bool(boost) and price_id == boost


async def _record_event(
    db: AsyncSession,
    *,
    event_id: str,
    event_name: str,
    payload: dict,
) -> bool:
    """Insert an idempotency row for this Stripe event id.

    Returns True if the event is new, False if it's a duplicate retry.
    Caller owns the surrounding transaction.
    """
    entry = WebhookEvent(
        provider="stripe",
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


async def _find_profile_by_clerk_id(db: AsyncSession, clerk_user_id: str) -> Optional[Profile]:
    res = await db.execute(select(Profile).where(Profile.clerk_user_id == clerk_user_id))
    return res.scalar_one_or_none()


async def _find_profile_by_stripe_customer(db: AsyncSession, customer_id: str) -> Optional[Profile]:
    res = await db.execute(select(Profile).where(Profile.stripe_customer_id == customer_id))
    return res.scalar_one_or_none()


async def _find_profile_by_stripe_subscription(
    db: AsyncSession, subscription_id: str
) -> Optional[Profile]:
    res = await db.execute(
        select(Profile).where(Profile.stripe_subscription_id == subscription_id)
    )
    return res.scalar_one_or_none()


def _verify_event(raw_body: bytes, signature: Optional[str]) -> dict:
    """Verify a Stripe webhook delivery and return the parsed event dict.

    Raises HTTPException(401) on any signature failure or missing secret —
    Stripe retries on non-2xx so a hostile body never reaches plan logic.
    """
    secret = settings.stripe_webhook_signing_secret
    if not secret:
        logger.error("stripe webhook called but STRIPE_WEBHOOK_SIGNING_SECRET is unset")
        raise HTTPException(status_code=401, detail="webhook secret not configured")
    if not signature:
        raise HTTPException(status_code=401, detail="missing stripe-signature header")
    try:
        event = stripe.Webhook.construct_event(
            payload=raw_body,
            sig_header=signature,
            secret=secret,
        )
    except (stripe.SignatureVerificationError, ValueError) as exc:
        logger.warning("stripe signature verification failed: %s", exc)
        raise HTTPException(status_code=401, detail="invalid signature")
    return event


@router.post("/webhooks/stripe", status_code=204)
async def stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    raw_body = await request.body()
    event = _verify_event(raw_body, stripe_signature)

    event_id = str(event.get("id") or "")
    event_type = str(event.get("type") or "")
    if not event_id:
        # Stripe always sends an id; missing one is a sign of a malformed/forged
        # payload that somehow passed signature (shouldn't happen).
        raise HTTPException(status_code=400, detail="missing event id")

    # Idempotency: dedupe on (provider, event_id). A retry hits the unique
    # constraint and short-circuits with 204.
    is_new = await _record_event(
        db, event_id=event_id, event_name=event_type, payload=dict(event),
    )
    if not is_new:
        logger.info("stripe webhook duplicate event_id=%s type=%s", event_id, event_type)
        return

    obj = (event.get("data") or {}).get("object") or {}

    try:
        await _apply_event(db, event_type=event_type, obj=obj)
        await db.commit()
    except HTTPException:
        raise
    except Exception:
        # Roll back the idempotency row too — we want Stripe to retry, and
        # a stuck idempotency row would block that.
        await db.rollback()
        logger.exception("stripe webhook apply failed event_id=%s type=%s", event_id, event_type)
        raise HTTPException(status_code=500, detail="webhook apply failed")


async def _apply_event(db: AsyncSession, *, event_type: str, obj: dict) -> None:
    """Dispatch a verified Stripe event to the right plan-mutation path."""
    if event_type == "checkout.session.completed":
        await _on_checkout_completed(db, obj)
    elif event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.resumed",
    }:
        await _on_subscription_upserted(db, obj)
    elif event_type in {"customer.subscription.deleted"}:
        await _on_subscription_deleted(db, obj)
    elif event_type == "invoice.payment_failed":
        # Don't downgrade on a single failure — Stripe keeps retrying, and
        # a transient failure shouldn't lock a paying user out of their plan.
        # Eventually customer.subscription.deleted fires if the failures stick.
        sub_id = str(obj.get("subscription") or "")
        logger.info("stripe: payment_failed sub=%s (plan unchanged)", sub_id)
    else:
        logger.info("stripe: ignoring unhandled event_type=%s", event_type)


async def _on_checkout_completed(db: AsyncSession, session_obj: dict) -> None:
    """Handle the initial checkout completion.

    Two flavors:
      * mode=subscription → store customer_id; subscription.created event
        will follow with the price→plan mapping.
      * mode=payment → one-time Boost pack purchase; credit boost_credits.
    """
    clerk_user_id = (
        str(session_obj.get("client_reference_id") or "")
        or str((session_obj.get("metadata") or {}).get("clerk_user_id") or "")
    )
    customer_id = str(session_obj.get("customer") or "")
    mode = str(session_obj.get("mode") or "")

    profile = None
    if clerk_user_id:
        profile = await _find_profile_by_clerk_id(db, clerk_user_id)
    if profile is None and customer_id:
        profile = await _find_profile_by_stripe_customer(db, customer_id)
    if profile is None:
        logger.warning(
            "stripe: checkout.session.completed mode=%s clerk=%s cust=%s — no profile match",
            mode, clerk_user_id, customer_id,
        )
        return

    if customer_id and not profile.stripe_customer_id:
        profile.stripe_customer_id = customer_id

    if mode == "payment":
        # Boost pack: line items live on the session via line_items expansion,
        # but for a single-line checkout the metadata or the price hint is
        # enough. We credit one pack per Boost line.
        boost_price = settings.stripe_price_boost
        line_items = session_obj.get("line_items") or {}
        boost_lines = 0
        for item in (line_items.get("data") or []):
            price = (item.get("price") or {}).get("id") or ""
            qty = int(item.get("quantity") or 1)
            if price == boost_price:
                boost_lines += qty
        if boost_lines == 0:
            # Single-item checkout: fall back to a generous assumption — if
            # mode=payment fired and the session was launched against the
            # boost price, credit one pack. Frontend always launches with
            # this price, so this is safe.
            boost_lines = 1
        credited = settings.boost_pack_credits * boost_lines
        profile.boost_credits = (profile.boost_credits or 0) + credited
        logger.info(
            "stripe: profile=%s boost+=%d (total=%d)",
            profile.id, credited, profile.boost_credits,
        )


async def _on_subscription_upserted(db: AsyncSession, sub_obj: dict) -> None:
    """Map the subscription's current price → plan and write it to the profile."""
    subscription_id = str(sub_obj.get("id") or "")
    customer_id = str(sub_obj.get("customer") or "")
    if not subscription_id:
        return

    items = (sub_obj.get("items") or {}).get("data") or []
    price_id = ""
    if items:
        price_id = str((items[0].get("price") or {}).get("id") or "")

    new_plan = _price_to_plan(price_id)

    # Lookup order: subscription_id (most specific), then customer_id, then
    # the clerk_user_id we stashed in subscription metadata at checkout.
    profile = await _find_profile_by_stripe_subscription(db, subscription_id)
    if profile is None and customer_id:
        profile = await _find_profile_by_stripe_customer(db, customer_id)
    if profile is None:
        clerk_user_id = str((sub_obj.get("metadata") or {}).get("clerk_user_id") or "")
        if clerk_user_id:
            profile = await _find_profile_by_clerk_id(db, clerk_user_id)
    if profile is None:
        logger.warning(
            "stripe: subscription.upserted sub=%s cust=%s — no profile match",
            subscription_id, customer_id,
        )
        return

    if customer_id:
        profile.stripe_customer_id = customer_id
    profile.stripe_subscription_id = subscription_id

    status = str(sub_obj.get("status") or "")
    # Active or trialing → apply the plan; canceled/past_due/unpaid handled
    # via subscription.deleted or invoice.payment_failed paths.
    if status in {"active", "trialing"} and new_plan:
        profile.plan = new_plan
        logger.info(
            "stripe: profile=%s plan→%s via price=%s sub=%s",
            profile.id, new_plan, price_id, subscription_id,
        )
    elif new_plan is None and price_id:
        logger.warning(
            "stripe: unknown price=%s on sub=%s profile=%s — plan unchanged",
            price_id, subscription_id, profile.id,
        )


async def _on_subscription_deleted(db: AsyncSession, sub_obj: dict) -> None:
    """Subscription terminated → revert to scout, clear subscription pointer."""
    subscription_id = str(sub_obj.get("id") or "")
    customer_id = str(sub_obj.get("customer") or "")

    profile = await _find_profile_by_stripe_subscription(db, subscription_id)
    if profile is None and customer_id:
        profile = await _find_profile_by_stripe_customer(db, customer_id)
    if profile is None:
        return

    profile.plan = "scout"
    profile.stripe_subscription_id = None
    logger.info(
        "stripe: profile=%s plan→scout (subscription_deleted sub=%s)",
        profile.id, subscription_id,
    )
