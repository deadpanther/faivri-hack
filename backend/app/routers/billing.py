"""Stripe Checkout + Customer Portal session creation.

Frontend calls these to launch the hosted Stripe pages — we never touch
card data ourselves. Both endpoints require auth so we can stamp the
Clerk user id onto the session for later webhook lookup.

Endpoints:
  POST /api/v1/billing/checkout   — launch a Checkout Session
  POST /api/v1/billing/portal     — launch a Customer Portal session
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import Profile
from app.services.auth import require_user_id
from app.services.clerk_admin import get_primary_email
from app.services.database import get_db


logger = logging.getLogger(__name__)
router = APIRouter()


PriceKey = Literal[
    "signal_monthly",
    "signal_yearly",
    "signal_scholar_monthly",
    "signal_scholar_yearly",
    "command_monthly",
    "command_yearly",
    "command_scholar_monthly",
    "command_scholar_yearly",
    "boost",
]


def _resolve_price_id(key: PriceKey) -> str:
    mapping = {
        "signal_monthly": settings.stripe_price_signal_monthly,
        "signal_yearly": settings.stripe_price_signal_yearly,
        "signal_scholar_monthly": settings.stripe_price_signal_scholar_monthly,
        "signal_scholar_yearly": settings.stripe_price_signal_scholar_yearly,
        "command_monthly": settings.stripe_price_command_monthly,
        "command_yearly": settings.stripe_price_command_yearly,
        "command_scholar_monthly": settings.stripe_price_command_scholar_monthly,
        "command_scholar_yearly": settings.stripe_price_command_scholar_yearly,
        "boost": settings.stripe_price_boost,
    }
    price_id = mapping.get(key, "")
    if not price_id:
        raise HTTPException(status_code=503, detail=f"price '{key}' not configured")
    return price_id


def _is_scholar_price(key: PriceKey) -> bool:
    return "scholar" in key


def _is_one_time(key: PriceKey) -> bool:
    return key == "boost"


def _price_id_to_key(price_id: str) -> Optional[PriceKey]:
    """Reverse lookup: Stripe Price id → our PriceKey literal.

    Used by /billing/status so the frontend can match the user's live
    subscription back to one of the cards on the pricing page (e.g. mark
    "Signal yearly" as the current plan instead of just "signal").
    """
    if not price_id:
        return None
    mapping: dict[str, PriceKey] = {
        settings.stripe_price_signal_monthly: "signal_monthly",
        settings.stripe_price_signal_yearly: "signal_yearly",
        settings.stripe_price_signal_scholar_monthly: "signal_scholar_monthly",
        settings.stripe_price_signal_scholar_yearly: "signal_scholar_yearly",
        settings.stripe_price_command_monthly: "command_monthly",
        settings.stripe_price_command_yearly: "command_yearly",
        settings.stripe_price_command_scholar_monthly: "command_scholar_monthly",
        settings.stripe_price_command_scholar_yearly: "command_scholar_yearly",
        settings.stripe_price_boost: "boost",
    }
    return mapping.get(price_id)


def _plan_from_price_key(key: Optional[PriceKey]) -> str:
    if not key:
        return "scout"
    if key.startswith("signal"):
        return "signal"
    if key.startswith("command"):
        return "command"
    return "scout"


def _interval_from_price_key(key: Optional[PriceKey]) -> Optional[str]:
    if not key:
        return None
    if "yearly" in key:
        return "yearly"
    if "monthly" in key:
        return "monthly"
    return None


_ACTIVE_SUB_STATUSES = {"active", "trialing", "past_due"}


class CheckoutRequest(BaseModel):
    price_key: PriceKey
    # Optional: if frontend has a hint about scholar status from the user's
    # profile cache, it can pass it. The server still re-checks against
    # `student_discount_until` and rejects scholar prices for non-students.
    is_scholar_hint: Optional[bool] = None


class CheckoutResponse(BaseModel):
    url: str
    session_id: str


class PortalResponse(BaseModel):
    url: str


@router.post("/billing/checkout", response_model=CheckoutResponse)
async def create_checkout_session(
    body: CheckoutRequest,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> CheckoutResponse:
    """Create a Stripe Checkout Session and return the redirect URL.

    Auth is required so we can stamp `client_reference_id` (Clerk user id)
    on the session — that's how the webhook ties the resulting subscription
    back to the right profile.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")

    # Server-side scholar guard: if the requested price is a scholar variant,
    # require an active student_discount_until. This prevents a tampered
    # frontend from launching Scholar checkout for a non-student.
    if _is_scholar_price(body.price_key):
        until = profile.student_discount_until
        if until is None or until <= datetime.utcnow():
            raise HTTPException(
                status_code=403, detail="scholar pricing requires verified .edu",
            )

    # Block double-checkout: a user with an active subscription must use
    # /billing/change-plan (prorated) — running a second Checkout would
    # create a duplicate sub on Stripe and double-bill them.
    if not _is_one_time(body.price_key) and profile.stripe_subscription_id:
        try:
            sub = stripe.Subscription.retrieve(profile.stripe_subscription_id)
            if str(sub.get("status") or "") in _ACTIVE_SUB_STATUSES:
                raise HTTPException(
                    status_code=409,
                    detail="You already have an active subscription. Use change-plan to switch.",
                )
        except stripe.StripeError:
            # Stripe lookup failed — let checkout proceed rather than block
            # a paying user behind a transient API error. The UI's plan
            # badge is the user-visible safety; this is a back-stop.
            logger.warning(
                "stripe sub lookup failed during checkout guard user=%s sub=%s",
                user_id, profile.stripe_subscription_id,
            )

    price_id = _resolve_price_id(body.price_key)
    mode = "payment" if _is_one_time(body.price_key) else "subscription"
    success_url = f"{settings.public_site_url}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{settings.public_site_url}/pricing"

    # Stripe rejects passing both `customer=` and `customer_email=` on the
    # same Checkout Session — once we have the customer id, the email is
    # already on file. Only prefill on the very first checkout.
    prefill_email = None if profile.stripe_customer_id else await _safe_email(profile)

    try:
        session = stripe.checkout.Session.create(
            mode=mode,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=profile.clerk_user_id,
            customer=profile.stripe_customer_id or None,
            customer_email=prefill_email,
            metadata={"clerk_user_id": profile.clerk_user_id, "price_key": body.price_key},
            subscription_data=(
                {"metadata": {"clerk_user_id": profile.clerk_user_id}}
                if mode == "subscription" else None
            ),
            allow_promotion_codes=True,
        )
    except stripe.StripeError as exc:
        logger.exception("stripe checkout create failed user=%s key=%s", user_id, body.price_key)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    return CheckoutResponse(url=session.url or "", session_id=session.id)


@router.post("/billing/portal", response_model=PortalResponse)
async def create_portal_session(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> PortalResponse:
    """Open the Stripe Customer Portal for managing/cancelling subscriptions.

    Requires the profile to have a `stripe_customer_id` already (set by the
    webhook on the first successful checkout). Customers without one have
    nothing to manage — return 404 so the frontend hides the link.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_customer_id:
        raise HTTPException(status_code=404, detail="no billing history")

    return_url = f"{settings.public_site_url}/account"
    try:
        session = stripe.billing_portal.Session.create(
            customer=profile.stripe_customer_id,
            return_url=return_url,
        )
    except stripe.StripeError as exc:
        logger.exception("stripe portal create failed user=%s", user_id)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    return PortalResponse(url=session.url or "")


class PortalUpdateRequest(BaseModel):
    price_key: PriceKey


@router.post("/billing/portal-update", response_model=PortalResponse)
async def create_portal_update_session(
    body: PortalUpdateRequest,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> PortalResponse:
    """Open Stripe Customer Portal directly to the plan-switch confirmation.

    Stripe's `flow_data.subscription_update_confirm` lets us deep-link
    into the portal's "review prorated changes" screen with the target
    price pre-selected. The user sees Stripe's native proration breakdown,
    confirms there, and Stripe handles SCA / 3DS challenges if the upgrade
    requires reauth on the card. We rely on `customer.subscription.updated`
    to sync the new plan back to our DB.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    if _is_one_time(body.price_key):
        raise HTTPException(status_code=400, detail="boost is one-time, not a plan switch")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_customer_id or not profile.stripe_subscription_id:
        raise HTTPException(status_code=404, detail="no active subscription")

    if _is_scholar_price(body.price_key):
        until = profile.student_discount_until
        if until is None or until <= datetime.utcnow():
            raise HTTPException(status_code=403, detail="scholar pricing requires verified .edu")

    new_price_id = _resolve_price_id(body.price_key)

    try:
        sub = stripe.Subscription.retrieve(profile.stripe_subscription_id)
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    items = (sub.get("items") or {}).get("data") or []
    if not items:
        raise HTTPException(status_code=409, detail="subscription has no items")
    item_id = str(items[0].get("id") or "")

    return_url = f"{settings.public_site_url}/pricing?switched=1"
    try:
        session = stripe.billing_portal.Session.create(
            customer=profile.stripe_customer_id,
            return_url=return_url,
            flow_data={
                "type": "subscription_update_confirm",
                "subscription_update_confirm": {
                    "subscription": profile.stripe_subscription_id,
                    "items": [{"id": item_id, "price": new_price_id}],
                },
                "after_completion": {
                    "type": "redirect",
                    "redirect": {"return_url": return_url},
                },
            },
        )
    except stripe.StripeError as exc:
        logger.exception(
            "stripe portal-update create failed user=%s key=%s",
            user_id, body.price_key,
        )
        raw = (exc.user_message or str(exc) or "").lower()
        # Stripe rejects the deep-link if the target price isn't enabled in
        # the Customer Portal config. The raw error mentions "features" and
        # "subscription_update" — translate that into something the user
        # (or whoever's debugging) can act on without paging the team.
        if "features" in raw and "subscription_update" in raw:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This plan isn't enabled for self-service switching yet. "
                    "Email support@faivri.com and we'll move you over manually."
                ),
            )
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    return PortalResponse(url=session.url or "")


async def _safe_email(profile: Profile) -> Optional[str]:
    """Best-effort email pull for prefilling Stripe Checkout.

    We don't store email on Profile (only the .edu hash), so we ask Clerk's
    Backend API for the primary address. Verified-or-not is fine here —
    Stripe revalidates on send, and a typo is the user's to fix at Checkout.
    Any failure (Clerk down, missing key) returns None so Stripe just
    renders its own email field; the request must never 5xx because of
    this prefill.
    """
    if not profile.clerk_user_id:
        return None
    try:
        return await get_primary_email(profile.clerk_user_id)
    except Exception:
        logger.warning(
            "clerk email lookup raised user=%s — proceeding without prefill",
            profile.id,
        )
        return None


class BillingStatusResponse(BaseModel):
    plan: str                       # scout | signal | command
    interval: Optional[str] = None  # monthly | yearly | None (free / one-time)
    price_key: Optional[PriceKey] = None
    is_scholar: bool = False
    cancel_at_period_end: bool = False
    current_period_end: Optional[str] = None  # ISO 8601, UTC
    status: Optional[str] = None    # raw Stripe status (active, trialing, past_due, ...)
    has_billing_history: bool = False
    has_active_subscription: bool = False


@router.get("/billing/status", response_model=BillingStatusResponse)
async def billing_status(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> BillingStatusResponse:
    """Live snapshot of the user's subscription state.

    Frontend uses this to decorate the pricing page (badge the current plan,
    enable/disable buttons, show "cancel anytime" vs. "resume"). We hit
    Stripe directly so the answer reflects pending changes that the webhook
    hasn't echoed back yet (e.g. a cancel scheduled 30 seconds ago).
    """
    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")

    has_history = bool(profile.stripe_customer_id)
    fallback = BillingStatusResponse(
        plan=profile.plan or "scout",
        has_billing_history=has_history,
    )

    if not profile.stripe_subscription_id or not settings.stripe_secret_key:
        return fallback

    stripe.api_key = settings.stripe_secret_key
    try:
        sub = stripe.Subscription.retrieve(profile.stripe_subscription_id)
    except stripe.StripeError:
        logger.warning(
            "stripe sub retrieve failed user=%s sub=%s — returning DB fallback",
            user_id, profile.stripe_subscription_id,
        )
        return fallback

    items = (sub.get("items") or {}).get("data") or []
    price_id = ""
    if items:
        price_id = str((items[0].get("price") or {}).get("id") or "")

    price_key = _price_id_to_key(price_id)
    sub_status = str(sub.get("status") or "")
    is_active = sub_status in _ACTIVE_SUB_STATUSES

    period_end_raw = sub.get("current_period_end")
    period_end_iso: Optional[str] = None
    if period_end_raw:
        try:
            period_end_iso = datetime.utcfromtimestamp(int(period_end_raw)).isoformat() + "Z"
        except (TypeError, ValueError):
            period_end_iso = None

    return BillingStatusResponse(
        plan=_plan_from_price_key(price_key) if is_active else (profile.plan or "scout"),
        interval=_interval_from_price_key(price_key),
        price_key=price_key,
        is_scholar=bool(price_key and "scholar" in price_key),
        cancel_at_period_end=bool(sub.get("cancel_at_period_end")),
        current_period_end=period_end_iso,
        status=sub_status or None,
        has_billing_history=has_history,
        has_active_subscription=is_active,
    )


class ChangePlanRequest(BaseModel):
    price_key: PriceKey


class ChangePlanResponse(BaseModel):
    status: str
    plan: str
    interval: Optional[str]
    price_key: PriceKey
    proration_behavior: str = "create_prorations"


class ProrationPreviewResponse(BaseModel):
    """What the user will see/owe if they confirm a plan switch.

    The user pays nothing today — `proration_behavior=create_prorations`
    on `Subscription.modify` rolls all adjustments into the *next*
    invoice. The numbers below describe that next invoice:

      next_cycle_cents      — full regular charge for the new plan/period
      proration_charge_cents — extra charge for the partial new-plan time
                               between switch date and next renewal
      proration_credit_cents — credit for the unused portion of the old plan
      amount_due_cents       — Stripe's bottom line on that next invoice
                               (next_cycle + proration_charge − proration_credit,
                               clamped at 0 if credit overflows)

    `currency` is lowercase ISO ("usd").
    """
    current_plan: str
    current_interval: Optional[str]
    new_plan: str
    new_interval: Optional[str]
    amount_due_cents: int
    proration_credit_cents: int
    proration_charge_cents: int
    next_cycle_cents: int
    currency: str
    next_invoice_at: Optional[str]


@router.post("/billing/change-plan/preview", response_model=ProrationPreviewResponse)
async def preview_change_plan(
    body: ChangePlanRequest,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> ProrationPreviewResponse:
    """Return Stripe's prorated invoice preview for a hypothetical plan switch.

    The frontend calls this before confirming a switch so the user sees
    the actual dollar amount (charge or credit) instead of a vague
    "prorated" label. We do not modify the subscription here.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    if _is_one_time(body.price_key):
        raise HTTPException(status_code=400, detail="boost is one-time, not a plan switch")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_subscription_id or not profile.stripe_customer_id:
        raise HTTPException(status_code=404, detail="no active subscription")

    if _is_scholar_price(body.price_key):
        until = profile.student_discount_until
        if until is None or until <= datetime.utcnow():
            raise HTTPException(
                status_code=403, detail="scholar pricing requires verified .edu",
            )

    new_price_id = _resolve_price_id(body.price_key)

    try:
        sub = stripe.Subscription.retrieve(profile.stripe_subscription_id)
    except stripe.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    items = (sub.get("items") or {}).get("data") or []
    if not items:
        raise HTTPException(status_code=409, detail="subscription has no items")
    item_id = str(items[0].get("id") or "")
    current_price_id = str((items[0].get("price") or {}).get("id") or "")
    current_key = _price_id_to_key(current_price_id)
    current_plan_str = _plan_from_price_key(current_key) if current_key else (profile.plan or "")
    current_interval = _interval_from_price_key(current_key) if current_key else None

    try:
        upcoming = stripe.Invoice.upcoming(
            customer=profile.stripe_customer_id,
            subscription=profile.stripe_subscription_id,
            subscription_items=[{"id": item_id, "price": new_price_id}],
            subscription_proration_behavior="create_prorations",
        )
    except stripe.StripeError as exc:
        logger.exception("stripe upcoming-invoice failed user=%s", user_id)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    # Stripe's upcoming invoice mixes two kinds of line items when you
    # change a subscription item with create_prorations:
    #   - proration: true  → the immediate "credit unused old + charge
    #                        partial new" pair (rolled into next bill)
    #   - proration: false → the regular recurring charge for the new
    #                        plan's next full period
    # Lumping them together gives nonsense math (Charge − Credit ≠ Due).
    # Split them so the UI can show each piece honestly.
    lines = (upcoming.get("lines") or {}).get("data") or []
    proration_charge_cents = 0
    proration_credit_cents = 0
    next_cycle_cents = 0
    for ln in lines:
        amount = int(ln.get("amount") or 0)
        if bool(ln.get("proration")):
            if amount >= 0:
                proration_charge_cents += amount
            else:
                proration_credit_cents += -amount
        else:
            next_cycle_cents += max(0, amount)
    amount_due = int(upcoming.get("amount_due") or 0)
    next_invoice_ts = upcoming.get("next_payment_attempt") or upcoming.get("period_end")
    next_invoice_iso: Optional[str] = None
    if next_invoice_ts:
        try:
            next_invoice_iso = datetime.utcfromtimestamp(int(next_invoice_ts)).isoformat() + "Z"
        except (TypeError, ValueError):
            next_invoice_iso = None

    return ProrationPreviewResponse(
        current_plan=current_plan_str,
        current_interval=current_interval,
        new_plan=_plan_from_price_key(body.price_key),
        new_interval=_interval_from_price_key(body.price_key),
        amount_due_cents=amount_due,
        proration_credit_cents=proration_credit_cents,
        proration_charge_cents=proration_charge_cents,
        next_cycle_cents=next_cycle_cents,
        currency=str(upcoming.get("currency") or "usd").lower(),
        next_invoice_at=next_invoice_iso,
    )


@router.post("/billing/change-plan", response_model=ChangePlanResponse)
async def change_plan(
    body: ChangePlanRequest,
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> ChangePlanResponse:
    """Switch an active subscription to a new price with prorated billing.

    Stripe handles the math: we tell it `proration_behavior="create_prorations"`
    and it credits the unused portion of the current plan against the new
    one. The user is charged on the next invoice — no surprise immediate
    charge — which is the standard upgrade UX.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    if _is_one_time(body.price_key):
        raise HTTPException(status_code=400, detail="boost is one-time, not a plan switch")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_subscription_id:
        raise HTTPException(
            status_code=404,
            detail="No active subscription. Start one from the pricing page.",
        )

    if _is_scholar_price(body.price_key):
        until = profile.student_discount_until
        if until is None or until <= datetime.utcnow():
            raise HTTPException(
                status_code=403, detail="scholar pricing requires verified .edu",
            )

    price_id = _resolve_price_id(body.price_key)

    try:
        sub = stripe.Subscription.retrieve(profile.stripe_subscription_id)
    except stripe.StripeError as exc:
        logger.exception("stripe sub retrieve failed user=%s", user_id)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    items = (sub.get("items") or {}).get("data") or []
    if not items:
        raise HTTPException(status_code=409, detail="subscription has no items to update")
    item_id = str(items[0].get("id") or "")
    current_price_id = str((items[0].get("price") or {}).get("id") or "")

    if current_price_id == price_id:
        # No-op switch — surface the active state without billing the user.
        return ChangePlanResponse(
            status="unchanged",
            plan=_plan_from_price_key(body.price_key),
            interval=_interval_from_price_key(body.price_key),
            price_key=body.price_key,
        )

    try:
        updated = stripe.Subscription.modify(
            profile.stripe_subscription_id,
            items=[{"id": item_id, "price": price_id}],
            proration_behavior="create_prorations",
            cancel_at_period_end=False,
            payment_behavior="allow_incomplete",
        )
    except stripe.StripeError as exc:
        logger.exception(
            "stripe sub modify failed user=%s sub=%s key=%s",
            user_id, profile.stripe_subscription_id, body.price_key,
        )
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    new_plan = _plan_from_price_key(body.price_key)
    new_status = str(updated.get("status") or "")

    # `payment_behavior="allow_incomplete"` means Stripe accepts the modify
    # even when the proration invoice can't be charged (declined card, SCA
    # required). In those states the subscription's *items* are pointing at
    # the new price, but the user hasn't actually paid for the upgrade yet
    # — flipping `profile.plan` here would unlock the higher-tier features
    # without payment. Only commit the plan flip on healthy states; let
    # `customer.subscription.updated` reconcile when the invoice finally
    # settles (or `invoice.payment_failed` keep us pinned to the old plan).
    if new_status in {"active", "trialing"}:
        profile.plan = new_plan
        await db.commit()
        logger.info(
            "billing: user=%s plan→%s via change-plan sub=%s status=%s",
            user_id, new_plan, profile.stripe_subscription_id, new_status,
        )
    elif new_status in {"incomplete", "incomplete_expired"}:
        logger.warning(
            "billing: change-plan landed in %s user=%s sub=%s — plan NOT flipped",
            new_status, user_id, profile.stripe_subscription_id,
        )
        raise HTTPException(
            status_code=402,
            detail=(
                "Your card couldn't be charged for the prorated upgrade. "
                "Please update your payment method in the billing portal "
                "and try again."
            ),
        )
    else:
        # past_due / unpaid / paused — items already moved on Stripe's side.
        # Don't 4xx (the switch will likely settle), but don't grant access
        # either. Webhook will sync once the next invoice clears.
        logger.warning(
            "billing: change-plan status=%s user=%s sub=%s — awaiting webhook",
            new_status, user_id, profile.stripe_subscription_id,
        )

    return ChangePlanResponse(
        status=new_status or "active",
        plan=new_plan,
        interval=_interval_from_price_key(body.price_key),
        price_key=body.price_key,
    )


class CancelResponse(BaseModel):
    cancel_at_period_end: bool
    current_period_end: Optional[str] = None
    status: str


@router.post("/billing/cancel", response_model=CancelResponse)
async def cancel_subscription(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> CancelResponse:
    """Schedule a subscription cancel at the end of the current period.

    We never hard-cancel mid-cycle — the user already paid for the rest of
    the month and yanking access would feel hostile. Stripe sets
    `cancel_at_period_end=true`, the user keeps their plan until renewal,
    then `customer.subscription.deleted` fires and the webhook reverts
    them to scout.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_subscription_id:
        raise HTTPException(status_code=404, detail="no active subscription")

    try:
        sub = stripe.Subscription.modify(
            profile.stripe_subscription_id,
            cancel_at_period_end=True,
        )
    except stripe.StripeError as exc:
        logger.exception("stripe cancel failed user=%s", user_id)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    period_end_raw = sub.get("current_period_end")
    period_end_iso: Optional[str] = None
    if period_end_raw:
        try:
            period_end_iso = datetime.utcfromtimestamp(int(period_end_raw)).isoformat() + "Z"
        except (TypeError, ValueError):
            period_end_iso = None

    logger.info("billing: user=%s scheduled cancel sub=%s", user_id, profile.stripe_subscription_id)
    return CancelResponse(
        cancel_at_period_end=True,
        current_period_end=period_end_iso,
        status=str(sub.get("status") or ""),
    )


@router.post("/billing/resume", response_model=CancelResponse)
async def resume_subscription(
    user_id: str = Depends(require_user_id),
    db: AsyncSession = Depends(get_db),
) -> CancelResponse:
    """Undo a pending cancellation that's still inside the current period."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="stripe not configured")
    stripe.api_key = settings.stripe_secret_key

    profile = (
        await db.execute(select(Profile).where(Profile.id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="profile not found")
    if not profile.stripe_subscription_id:
        raise HTTPException(status_code=404, detail="no active subscription")

    try:
        sub = stripe.Subscription.modify(
            profile.stripe_subscription_id,
            cancel_at_period_end=False,
        )
    except stripe.StripeError as exc:
        logger.exception("stripe resume failed user=%s", user_id)
        raise HTTPException(status_code=502, detail=f"stripe error: {exc.user_message or str(exc)}")

    period_end_raw = sub.get("current_period_end")
    period_end_iso: Optional[str] = None
    if period_end_raw:
        try:
            period_end_iso = datetime.utcfromtimestamp(int(period_end_raw)).isoformat() + "Z"
        except (TypeError, ValueError):
            period_end_iso = None

    logger.info("billing: user=%s resumed sub=%s", user_id, profile.stripe_subscription_id)
    return CancelResponse(
        cancel_at_period_end=False,
        current_period_end=period_end_iso,
        status=str(sub.get("status") or ""),
    )
