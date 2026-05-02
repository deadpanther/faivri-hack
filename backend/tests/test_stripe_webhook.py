"""Stripe webhook unit tests — price→plan mapping and event dispatch.

These cover:
  1. `_price_to_plan` correctly maps every configured price (8 subscription
     prices) to its plan key, and refuses unknown prices.
  2. `_is_boost_price` recognizes the Boost one-time price.
  3. `_verify_event` rejects missing signatures, missing secrets, and
     mismatched signatures (delegates to stripe SDK so we mock it).
  4. `_apply_event` correctly transitions plan on subscription.upserted
     and reverts to scout on subscription.deleted.

Stripe's SDK is patched so we never make a real network call.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import stripe

from app.routers import webhooks_stripe as ws


# ─── price → plan mapping ─────────────────────────────────────────────────

@patch("app.routers.webhooks_stripe.settings")
def test_price_to_plan_maps_all_signal_prices(s):
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"
    for price in ("price_sig_m", "price_sig_y", "price_sig_sm", "price_sig_sy"):
        assert ws._price_to_plan(price) == "signal", price


@patch("app.routers.webhooks_stripe.settings")
def test_price_to_plan_maps_all_command_prices(s):
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"
    for price in ("price_cmd_m", "price_cmd_y", "price_cmd_sm", "price_cmd_sy"):
        assert ws._price_to_plan(price) == "command", price


@patch("app.routers.webhooks_stripe.settings")
def test_price_to_plan_returns_none_for_unknown(s):
    # An unknown / test-mode price leaking into a live webhook must NOT
    # silently upgrade the user.
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"
    assert ws._price_to_plan("price_bogus") is None
    assert ws._price_to_plan("") is None


@patch("app.routers.webhooks_stripe.settings")
def test_is_boost_price(s):
    s.stripe_price_boost = "price_boost_1"
    assert ws._is_boost_price("price_boost_1") is True
    assert ws._is_boost_price("price_other") is False
    s.stripe_price_boost = ""
    assert ws._is_boost_price("price_boost_1") is False


# ─── signature verification ────────────────────────────────────────────────

@patch("app.routers.webhooks_stripe.settings")
def test_verify_event_rejects_missing_secret(s):
    s.stripe_webhook_signing_secret = ""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ws._verify_event(b"{}", "t=1,v1=abc")
    assert exc.value.status_code == 401


@patch("app.routers.webhooks_stripe.settings")
def test_verify_event_rejects_missing_signature(s):
    s.stripe_webhook_signing_secret = "whsec_test"
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ws._verify_event(b"{}", None)
    assert exc.value.status_code == 401


@patch("app.routers.webhooks_stripe.settings")
@patch("app.routers.webhooks_stripe.stripe.Webhook.construct_event")
def test_verify_event_passes_through_stripe_sdk(construct_event, s):
    s.stripe_webhook_signing_secret = "whsec_test"
    fake_event = {"id": "evt_1", "type": "ping"}
    construct_event.return_value = fake_event
    out = ws._verify_event(b'{"id":"evt_1"}', "t=1,v1=abc")
    construct_event.assert_called_once()
    assert out == fake_event


@patch("app.routers.webhooks_stripe.settings")
@patch("app.routers.webhooks_stripe.stripe.Webhook.construct_event")
def test_verify_event_rejects_bad_signature(construct_event, s):
    s.stripe_webhook_signing_secret = "whsec_test"
    construct_event.side_effect = stripe.SignatureVerificationError(
        "bad sig", sig_header="t=1,v1=abc",
    )
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        ws._verify_event(b'{"id":"evt_1"}', "t=1,v1=abc")
    assert exc.value.status_code == 401


# ─── apply event dispatch ──────────────────────────────────────────────────

class _FakeProfile:
    def __init__(self, *, plan="scout", boost_credits=0,
                 stripe_customer_id=None, stripe_subscription_id=None):
        self.id = uuid.uuid4()
        self.plan = plan
        self.boost_credits = boost_credits
        self.stripe_customer_id = stripe_customer_id
        self.stripe_subscription_id = stripe_subscription_id
        self.clerk_user_id = "user_test"


def _session_finder(profile):
    """Async-mock session whose execute().scalar_one_or_none() returns profile."""
    sess = AsyncMock()
    res = AsyncMock()
    res.scalar_one_or_none = lambda: profile
    sess.execute = AsyncMock(return_value=res)
    sess.commit = AsyncMock()
    sess.flush = AsyncMock()
    return sess


@patch("app.routers.webhooks_stripe.settings")
def test_apply_subscription_upserted_promotes_to_signal(s):
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"

    profile = _FakeProfile(plan="scout")
    sess = _session_finder(profile)
    sub_obj = {
        "id": "sub_123",
        "customer": "cus_456",
        "status": "active",
        "items": {"data": [{"price": {"id": "price_sig_m"}}]},
        "metadata": {"clerk_user_id": "user_test"},
    }
    asyncio.run(ws._on_subscription_upserted(sess, sub_obj))
    assert profile.plan == "signal"
    assert profile.stripe_subscription_id == "sub_123"
    assert profile.stripe_customer_id == "cus_456"


@patch("app.routers.webhooks_stripe.settings")
def test_apply_subscription_upserted_unknown_price_keeps_plan(s):
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"

    profile = _FakeProfile(plan="scout")
    sess = _session_finder(profile)
    sub_obj = {
        "id": "sub_x",
        "customer": "cus_x",
        "status": "active",
        "items": {"data": [{"price": {"id": "price_unknown"}}]},
    }
    asyncio.run(ws._on_subscription_upserted(sess, sub_obj))
    assert profile.plan == "scout", "unknown price must NOT upgrade"


@patch("app.routers.webhooks_stripe.settings")
def test_apply_subscription_upserted_inactive_status_no_promote(s):
    s.stripe_price_signal_monthly = "price_sig_m"
    s.stripe_price_signal_yearly = "price_sig_y"
    s.stripe_price_signal_scholar_monthly = "price_sig_sm"
    s.stripe_price_signal_scholar_yearly = "price_sig_sy"
    s.stripe_price_command_monthly = "price_cmd_m"
    s.stripe_price_command_yearly = "price_cmd_y"
    s.stripe_price_command_scholar_monthly = "price_cmd_sm"
    s.stripe_price_command_scholar_yearly = "price_cmd_sy"

    profile = _FakeProfile(plan="scout")
    sess = _session_finder(profile)
    sub_obj = {
        "id": "sub_inc",
        "customer": "cus_inc",
        "status": "incomplete",  # not active/trialing
        "items": {"data": [{"price": {"id": "price_sig_m"}}]},
    }
    asyncio.run(ws._on_subscription_upserted(sess, sub_obj))
    # Pointer fields populated, but plan stays scout until status flips active
    assert profile.plan == "scout"
    assert profile.stripe_subscription_id == "sub_inc"


def test_apply_subscription_deleted_reverts_to_scout():
    profile = _FakeProfile(plan="signal", stripe_subscription_id="sub_999")
    sess = _session_finder(profile)
    sub_obj = {"id": "sub_999", "customer": "cus_x"}
    asyncio.run(ws._on_subscription_deleted(sess, sub_obj))
    assert profile.plan == "scout"
    assert profile.stripe_subscription_id is None


@patch("app.routers.webhooks_stripe.settings")
def test_apply_checkout_completed_credits_boost(s):
    s.stripe_price_boost = "price_boost_1"
    s.boost_pack_credits = 10

    profile = _FakeProfile(plan="scout", boost_credits=0)
    sess = _session_finder(profile)
    session_obj = {
        "client_reference_id": "user_test",
        "customer": "cus_b",
        "mode": "payment",
        "line_items": {
            "data": [
                {"price": {"id": "price_boost_1"}, "quantity": 1},
            ],
        },
    }
    asyncio.run(ws._on_checkout_completed(sess, session_obj))
    assert profile.boost_credits == 10
    assert profile.stripe_customer_id == "cus_b"


@patch("app.routers.webhooks_stripe.settings")
def test_apply_checkout_completed_no_profile_match_is_silent(s):
    s.stripe_price_boost = "price_boost_1"
    s.boost_pack_credits = 10
    sess = _session_finder(None)
    session_obj = {
        "client_reference_id": "user_orphan",
        "customer": "cus_orphan",
        "mode": "payment",
    }
    # No profile match → log warning and return without raising. Stripe
    # gets a 204 and stops retrying. (Critical: a 5xx would loop forever
    # on a checkout from a deleted user.)
    asyncio.run(ws._on_checkout_completed(sess, session_obj))
