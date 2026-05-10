"""GET /api/v1/usage — quota snapshot for the signed-in user.

The frontend calls this on the analyzer page to show "2 / 3 left this month"
and to disable the submit button when the quota is exhausted (so the user
sees the constraint before they hit 402).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import Profile
from app.services.auth import require_user_id
from app.services.database import get_db
from app.services.quota import PLAN_LIMITS, get_status


router = APIRouter()


async def _boost_balance(db: AsyncSession, user_id: str) -> int:
    row = await db.execute(
        select(Profile.boost_credits).where(Profile.id == user_id)
    )
    return int(row.scalar_one_or_none() or 0)


def _boost_info() -> dict:
    return {
        "credits_per_pack": settings.boost_pack_credits,
        "price_cents": settings.boost_pack_price_cents,
        "checkout_url": settings.lemonsqueezy_boost_checkout_url or None,
    }


@router.get("/usage")
async def get_usage(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    status = await get_status(db, user_id)
    boost = await _boost_balance(db, user_id)
    return {
        "plan": status.plan,
        "limit": status.limit,
        "used": status.used,
        "remaining": status.remaining,
        "reset_at": status.reset_at.isoformat() if status.reset_at else None,
        "unlimited": status.limit is None,
        "boost_credits": boost,
        "boost": _boost_info(),
    }


@router.get("/usage/plans")
async def list_plans():
    """Public catalog the frontend can use to render the upgrade modal."""
    return {
        "plans": [
            {"key": k, "monthly_limit": v, "unlimited": v is None}
            for k, v in PLAN_LIMITS.items()
        ],
        "boost": _boost_info(),
    }


@router.get("/usage/boost/checkout")
async def boost_checkout(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Return a Boost Pack checkout URL.

    Two backends. We prefer Lemon Squeezy when its hosted URL is configured
    (legacy path), and fall back to Stripe Checkout against
    STRIPE_PRICE_BOOST. The webhook handlers credit boost_credits on
    completion in either case.
    """
    profile_row = await db.execute(
        select(Profile.clerk_user_id, Profile.stripe_customer_id).where(Profile.id == user_id)
    )
    row = profile_row.one_or_none()
    if row is None:
        return {"checkout_url": None, "configured": False}
    clerk_user_id = row[0] or ""
    stripe_customer_id = row[1] or ""

    ls_url = settings.lemonsqueezy_boost_checkout_url
    if ls_url:
        from urllib.parse import urlencode, urlparse, parse_qsl, urlunparse
        parsed = urlparse(ls_url)
        existing = dict(parse_qsl(parsed.query))
        existing["checkout[custom][clerk_user_id]"] = clerk_user_id
        built = urlunparse(parsed._replace(query=urlencode(existing)))
        return {
            "checkout_url": built,
            "configured": True,
            "provider": "lemonsqueezy",
            "credits_per_pack": settings.boost_pack_credits,
            "price_cents": settings.boost_pack_price_cents,
        }

    if settings.stripe_secret_key and settings.stripe_price_boost:
        import stripe
        stripe.api_key = settings.stripe_secret_key
        success_url = f"{settings.public_site_url}/billing/success?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{settings.public_site_url}/pricing"
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                line_items=[{"price": settings.stripe_price_boost, "quantity": 1}],
                success_url=success_url,
                cancel_url=cancel_url,
                client_reference_id=clerk_user_id or None,
                customer=stripe_customer_id or None,
                metadata={"clerk_user_id": clerk_user_id, "price_key": "boost"},
                allow_promotion_codes=True,
            )
        except stripe.StripeError:
            return {"checkout_url": None, "configured": False, "provider": "stripe"}
        return {
            "checkout_url": session.url or "",
            "configured": True,
            "provider": "stripe",
            "credits_per_pack": settings.boost_pack_credits,
            "price_cents": settings.boost_pack_price_cents,
        }

    return {"checkout_url": None, "configured": False}
