"""HMAC signature verification + variant→plan mapping.

Lemon Squeezy retries on non-2xx, so the unsigned/invalid-signature path
must 401 and the happy path must 204. Unknown variant ids must NOT silently
promote a user — they should leave the plan unchanged.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import patch

from app.routers.webhooks import _variant_to_plan, _verify_signature


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_signature_rejects_missing_secret():
    # With no secret configured, every request must fail verification —
    # never trust an unsigned webhook even in dev.
    with patch("app.routers.webhooks.settings") as s:
        s.lemonsqueezy_signing_secret = ""
        assert _verify_signature(b"{}", "anything") is False


def test_verify_signature_rejects_mismatched_sig():
    secret = "testing-secret"
    body = b'{"event":"subscription_created"}'
    wrong = _sign(body, "other-secret")
    with patch("app.routers.webhooks.settings") as s:
        s.lemonsqueezy_signing_secret = secret
        assert _verify_signature(body, wrong) is False


def test_verify_signature_accepts_valid_sig():
    secret = "testing-secret"
    body = b'{"event":"subscription_created"}'
    sig = _sign(body, secret)
    with patch("app.routers.webhooks.settings") as s:
        s.lemonsqueezy_signing_secret = secret
        assert _verify_signature(body, sig) is True


def test_variant_to_plan_maps_configured_variants():
    with patch("app.routers.webhooks.settings") as s:
        s.lemonsqueezy_variant_signal = "sig-1"
        s.lemonsqueezy_variant_signal_scholar = "sig-1-s"
        s.lemonsqueezy_variant_command = "cmd-1"
        s.lemonsqueezy_variant_command_scholar = "cmd-1-s"
        assert _variant_to_plan("sig-1") == "signal"
        assert _variant_to_plan("sig-1-s") == "signal"
        assert _variant_to_plan("cmd-1") == "command"
        assert _variant_to_plan("cmd-1-s") == "command"


def test_variant_to_plan_returns_none_for_unknown():
    # An unknown variant must NOT silently upgrade the user — webhook
    # handler falls through without touching the plan column.
    with patch("app.routers.webhooks.settings") as s:
        s.lemonsqueezy_variant_signal = "sig-1"
        s.lemonsqueezy_variant_signal_scholar = "sig-1-s"
        s.lemonsqueezy_variant_command = "cmd-1"
        s.lemonsqueezy_variant_command_scholar = "cmd-1-s"
        assert _variant_to_plan("bogus-variant") is None
        assert _variant_to_plan("") is None
