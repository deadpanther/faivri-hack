"""End-to-end prorated billing exerciser for the Stripe pipeline.

Drives /billing/change-plan/preview + /billing/change-plan against a real
Stripe TEST-MODE subscription and asserts the resulting plan/interval via
/billing/status (which reads live from Stripe, so we don't need to wait
for webhooks to update the DB before assertion).

The 12-transition matrix from the plan is collapsed into 9 API-driven
transitions here; the 3 webhook-only ones (signature-rejection,
idempotency-replay, customer.subscription.deleted) are listed in
NON_API_CASES at the bottom and meant to be run via stripe-cli — see
the README block at the top of run_all().

Usage
-----
    export FAIVRI_BACKEND_URL=https://api.faivri.com         # or http://localhost:8000
    export FAIVRI_TEST_BEARER='ey...'                        # Clerk JWT for the test user
    python3 backend/scripts/e2e_prorated_test.py [--apply] [--only signal_monthly,signal_yearly]

Without --apply, only the /preview endpoint is hit (read-only — no Stripe
state mutated). Pass --apply to actually call /change-plan and walk the
real subscription through each transition. --only narrows the matrix to
specific PriceKey targets (comma-separated).

Pre-requisites
--------------
1. The bearer's profile must already have stripe_subscription_id populated
   (i.e. one successful Checkout Session has run). If not, finish the
   `signal_monthly` checkout once via the pricing page before running.
2. STRIPE_SECRET_KEY on the backend must be a sk_test_* key.
3. The user's profile.student_discount_until must be in the future for
   the scholar-tier transitions (set via /api/v1/edu/verify or directly
   in the DB for testing).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Optional
from urllib import error as urlerror
from urllib import request as urlrequest


PRICE_KEYS = [
    "signal_monthly",
    "signal_yearly",
    "signal_scholar_monthly",
    "signal_scholar_yearly",
    "command_monthly",
    "command_yearly",
    "command_scholar_monthly",
    "command_scholar_yearly",
]

# (label, target price_key, expected_plan_after, expected_interval_after).
# We start each run from the *current* subscription state — the matrix is
# walked in order, so each row's "expected" state is what the user should
# land on after the transition.
TRANSITIONS: list[tuple[str, str, str, str]] = [
    ("Signal monthly → Signal yearly (annual upgrade, prorated)",
     "signal_yearly", "signal", "yearly"),
    ("Signal yearly → Command yearly (tier upgrade, prorated)",
     "command_yearly", "command", "yearly"),
    ("Command yearly → Command monthly (interval downgrade)",
     "command_monthly", "command", "monthly"),
    ("Command monthly → Signal monthly (tier downgrade)",
     "signal_monthly", "signal", "monthly"),
    ("Signal monthly → Signal scholar monthly (.edu silent switch)",
     "signal_scholar_monthly", "signal", "monthly"),
    ("Signal scholar monthly → Signal scholar yearly",
     "signal_scholar_yearly", "signal", "yearly"),
    ("Signal scholar yearly → Command scholar yearly",
     "command_scholar_yearly", "command", "yearly"),
    ("Command scholar yearly → Signal monthly (off scholar)",
     "signal_monthly", "signal", "monthly"),
]

NON_API_CASES = [
    "customer.subscription.deleted webhook → plan reverts to scout "
    "(replay via: stripe trigger customer.subscription.deleted)",
    "Webhook idempotency: replay the same event_id twice; second apply "
    "is a no-op (assert single profile mutation in logs)",
    "Webhook signature rejection: POST /api/v1/webhooks/stripe with a "
    "tampered Stripe-Signature header → 400, no profile mutation",
    "Boost pack one-time checkout → boost_credits increments by "
    "settings.boost_pack_credits (mode=payment branch in webhook)",
]


@dataclass
class StatusSnapshot:
    plan: str
    interval: Optional[str]
    price_key: Optional[str]
    cancel_at_period_end: bool
    has_active_subscription: bool


def _fail(msg: str) -> None:
    sys.stderr.write(f"\n[fail] {msg}\n")
    sys.exit(1)


def _http(method: str, url: str, *, bearer: str, body: Optional[dict] = None) -> dict:
    payload = json.dumps(body).encode() if body is not None else None
    req = urlrequest.Request(url, data=payload, method=method)
    req.add_header("Authorization", f"Bearer {bearer}")
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urlrequest.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw)
    except urlerror.HTTPError as exc:
        try:
            detail = exc.read().decode()
        except Exception:
            detail = ""
        _fail(f"{method} {url} → {exc.code} {detail}")
        return {}


def get_status(base: str, bearer: str) -> StatusSnapshot:
    data = _http("GET", f"{base}/api/v1/billing/status", bearer=bearer)
    return StatusSnapshot(
        plan=str(data.get("plan") or ""),
        interval=data.get("interval"),
        price_key=data.get("price_key"),
        cancel_at_period_end=bool(data.get("cancel_at_period_end")),
        has_active_subscription=bool(data.get("has_active_subscription")),
    )


def preview_change(base: str, bearer: str, target_key: str) -> dict:
    return _http(
        "POST",
        f"{base}/api/v1/billing/change-plan/preview",
        bearer=bearer,
        body={"price_key": target_key},
    )


def apply_change(base: str, bearer: str, target_key: str) -> dict:
    return _http(
        "POST",
        f"{base}/api/v1/billing/change-plan",
        bearer=bearer,
        body={"price_key": target_key},
    )


def cents(amount: object) -> str:
    try:
        n = int(amount or 0)
    except (TypeError, ValueError):
        return "?"
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n) / 100:.2f}"


def assert_preview_shape(label: str, preview: dict, target_key: str) -> None:
    needed = (
        "current_plan", "new_plan", "amount_due_cents",
        "proration_credit_cents", "proration_charge_cents",
        "next_cycle_cents", "currency",
    )
    missing = [k for k in needed if k not in preview]
    if missing:
        _fail(f"{label}: preview missing keys {missing}")
    if preview.get("amount_due_cents") is None:
        _fail(f"{label}: amount_due_cents is None")


def wait_for_webhook(base: str, bearer: str, target_plan: str,
                      target_interval: str, *, timeout_s: int = 25) -> StatusSnapshot:
    """Poll /billing/status until plan+interval match (webhook landed)."""
    deadline = time.time() + timeout_s
    last = get_status(base, bearer)
    while time.time() < deadline:
        if last.plan == target_plan and (last.interval or "") == target_interval:
            return last
        time.sleep(1.0)
        last = get_status(base, bearer)
    return last


def run_all(apply_changes: bool, only: Optional[set[str]]) -> int:
    base = os.environ.get("FAIVRI_BACKEND_URL") or "http://localhost:8000"
    bearer = os.environ.get("FAIVRI_TEST_BEARER")
    if not bearer:
        _fail("FAIVRI_TEST_BEARER not set (Clerk JWT for the test user).")

    print(f"backend: {base}")
    print(f"mode:    {'APPLY (mutating Stripe state)' if apply_changes else 'preview-only (read-only)'}")
    if only:
        print(f"only:    {sorted(only)}")
    print()

    initial = get_status(base, bearer)
    print(f"start state: plan={initial.plan} interval={initial.interval} "
          f"price_key={initial.price_key} active_sub={initial.has_active_subscription}")
    if not initial.has_active_subscription:
        _fail("Test user has no active subscription. Run a Stripe Checkout for "
              "signal_monthly first, then re-run this script.")

    rows: list[tuple[str, str, str]] = []  # (label, status, detail)

    for label, target_key, expected_plan, expected_interval in TRANSITIONS:
        if only and target_key not in only:
            rows.append((label, "skip", f"--only filtered out {target_key}"))
            continue

        # Preview always runs — it's safe and validates the API contract.
        preview = preview_change(base, bearer, target_key)
        assert_preview_shape(label, preview, target_key)
        detail = (
            f"due={cents(preview.get('amount_due_cents'))} "
            f"credit={cents(preview.get('proration_credit_cents'))} "
            f"charge={cents(preview.get('proration_charge_cents'))} "
            f"next_cycle={cents(preview.get('next_cycle_cents'))}"
        )

        if not apply_changes:
            rows.append((label, "preview-ok", detail))
            continue

        before = get_status(base, bearer)
        if before.price_key == target_key:
            rows.append((label, "already-on-target", f"price_key={target_key} (no-op)"))
            continue

        apply_change(base, bearer, target_key)
        after = wait_for_webhook(base, bearer, expected_plan, expected_interval)

        if after.plan != expected_plan or (after.interval or "") != expected_interval:
            rows.append((label, "MISMATCH",
                         f"got plan={after.plan} interval={after.interval}, "
                         f"want plan={expected_plan} interval={expected_interval}"))
            continue
        rows.append((label, "ok", f"{detail} → plan={after.plan}/{after.interval}"))

    # Cancel + resume cycle (only in --apply mode).
    if apply_changes:
        cancel = _http("POST", f"{base}/api/v1/billing/cancel", bearer=bearer)
        if not cancel.get("cancel_at_period_end"):
            rows.append(("cancel-at-period-end", "MISMATCH",
                         f"cancel_at_period_end={cancel.get('cancel_at_period_end')}"))
        else:
            rows.append(("cancel-at-period-end", "ok",
                         f"period_end={cancel.get('current_period_end')}"))

        resume = _http("POST", f"{base}/api/v1/billing/resume", bearer=bearer)
        if resume.get("cancel_at_period_end"):
            rows.append(("resume-subscription", "MISMATCH",
                         "cancel_at_period_end still true after resume"))
        else:
            rows.append(("resume-subscription", "ok",
                         f"status={resume.get('status')}"))

    width = max(len(r[0]) for r in rows) + 2
    print()
    print("=" * (width + 60))
    print(f"{'transition'.ljust(width)} {'status'.ljust(18)} detail")
    print("-" * (width + 60))
    failed = 0
    for label, status, detail in rows:
        marker = "✓" if status in {"ok", "preview-ok", "already-on-target", "skip"} else "✗"
        if marker == "✗":
            failed += 1
        print(f"{label.ljust(width)} {marker} {status.ljust(16)} {detail}")
    print("=" * (width + 60))

    print("\nNot covered by this script (drive via stripe-cli):")
    for case in NON_API_CASES:
        print(f"  - {case}")

    return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Actually call /change-plan (mutates Stripe state). "
                         "Without this flag, only /preview is exercised.")
    ap.add_argument("--only", default="",
                    help="Comma-separated PriceKey list to filter the matrix "
                         "(e.g. 'signal_yearly,command_yearly').")
    args = ap.parse_args()
    only = {k.strip() for k in args.only.split(",") if k.strip()} or None
    return run_all(apply_changes=args.apply, only=only)


if __name__ == "__main__":
    raise SystemExit(main())
