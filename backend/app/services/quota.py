"""Plan-based monthly quota for /analyze.

Two-phase charge so a pipeline failure doesn't burn a user's monthly budget:

  1. `check(db, user_id)` rolls the window if `usage_reset_at` is in the
     past, then raises `QuotaExhausted` if the cap is already hit. Returns
     a `QuotaStatus` snapshot; does NOT tick the counter.
  2. `consume(db, user_id)` increments `queries_this_month` after the
     pipeline completes successfully. A raised 503 between check and
     consume simply doesn't charge.

Anonymous users don't hit this module — their ceiling is enforced by the
Redis daily-cap in `services.anonymous_cap`.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


def _utc_now_naive() -> datetime:
    """Naive-UTC `now` regardless of container timezone.

    `datetime.utcnow()` is deprecated and silently wrong if `TZ` drifts. We
    explicitly take the tz-aware UTC moment and strip tzinfo so it stays
    comparable to the naive `usage_reset_at` column already in the DB —
    rewriting all rows to tz-aware is a separate (non-launch-blocking)
    migration.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Profile


# Monthly caps by plan key. `None` = unlimited (Command tier). Keys must
# match what the Lemon Squeezy webhook writes into `profiles.plan` and the
# strings rendered on the pricing page.
PLAN_LIMITS: dict[str, Optional[int]] = {
    "scout": 3,
    "signal": 20,
    "command": None,
}

DEFAULT_PLAN = "scout"


@dataclass
class QuotaStatus:
    plan: str
    limit: Optional[int]   # None = unlimited
    used: int
    remaining: Optional[int]   # None = unlimited
    reset_at: Optional[datetime]

    @property
    def exhausted(self) -> bool:
        return self.remaining is not None and self.remaining <= 0


def _first_of_next_month(now: datetime) -> datetime:
    """Return midnight on the 1st of the following month.

    Kept naive-UTC to match the `usage_reset_at` column type (no tzinfo)
    used elsewhere in the codebase. `now` must come from `_utc_now_naive`.
    """
    if now.month == 12:
        return datetime(now.year + 1, 1, 1)
    return datetime(now.year, now.month + 1, 1)


async def _load_profile(db: AsyncSession, user_id: str) -> Optional[Profile]:
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    return result.scalar_one_or_none()


def _plan_limit(plan: str) -> Optional[int]:
    # Unknown plans (e.g. a typo in a webhook payload or a tier we haven't
    # configured yet) fall back to Scout rather than silently unlimited.
    return PLAN_LIMITS.get(plan, PLAN_LIMITS[DEFAULT_PLAN])


async def get_status(db: AsyncSession, user_id: str) -> QuotaStatus:
    """Read-only quota snapshot. Used by GET /api/v1/usage and not by the
    analyze hot-path (we want the hot path to roll + persist in one txn)."""
    profile = await _load_profile(db, user_id)
    if profile is None:
        return QuotaStatus(DEFAULT_PLAN, PLAN_LIMITS[DEFAULT_PLAN], 0,
                           PLAN_LIMITS[DEFAULT_PLAN], None)
    limit = _plan_limit(profile.plan or DEFAULT_PLAN)
    used = profile.queries_this_month or 0
    remaining = None if limit is None else max(0, limit - used)
    return QuotaStatus(profile.plan or DEFAULT_PLAN, limit, used, remaining,
                       profile.usage_reset_at)


async def check(db: AsyncSession, user_id: str) -> QuotaStatus:
    """Verify the user has quota left and roll the window if overdue.

    Boost credits are checked AHEAD of the monthly cap — a top-up buyer
    should never see a 402 until their boost balance reaches zero AND
    their plan cap is also hit. Raises `QuotaExhausted` only when both
    sources are empty. Does NOT decrement anything — call `consume` after
    the pipeline succeeds so 503s don't burn the monthly budget.
    """
    profile = await _load_profile(db, user_id)
    if profile is None:
        # Auth returned a UUID that no longer maps to a row (deleted between
        # auth and quota). Treat as "start a fresh Scout" rather than 500.
        return QuotaStatus(DEFAULT_PLAN, PLAN_LIMITS[DEFAULT_PLAN], 0,
                           PLAN_LIMITS[DEFAULT_PLAN], None)

    now = _utc_now_naive()
    rolled = False
    if profile.usage_reset_at is None or profile.usage_reset_at <= now:
        profile.queries_this_month = 0
        profile.usage_reset_at = _first_of_next_month(now)
        rolled = True

    plan = profile.plan or DEFAULT_PLAN
    limit = _plan_limit(plan)
    used = profile.queries_this_month or 0
    boost = profile.boost_credits or 0

    # Within the monthly plan cap → normal pass-through, boost is untouched.
    plan_has_room = limit is None or used < limit

    if not plan_has_room and boost <= 0:
        if rolled:
            # Persist the rollover even when refusing, so the frontend's
            # usage badge stays accurate across the month boundary.
            await db.commit()
        raise QuotaExhausted(plan=plan, limit=limit or 0,
                             reset_at=profile.usage_reset_at,
                             boost_credits=boost)

    if rolled:
        await db.commit()

    remaining = None if limit is None else max(0, limit - used)
    return QuotaStatus(plan, limit, used, remaining, profile.usage_reset_at)


async def consume(db: AsyncSession, user_id: str) -> None:
    """Decrement the correct bucket after a successful pipeline run.

    Boost credits are spent ONLY when the monthly plan cap is already
    exhausted — this keeps the boost balance as an overflow reservoir
    rather than a parallel counter that races the plan cap. Best-effort:
    a bookkeeping failure here is logged but doesn't fail the verdict.
    """
    profile = await _load_profile(db, user_id)
    if profile is None:
        return

    plan = profile.plan or DEFAULT_PLAN
    limit = _plan_limit(plan)
    used = profile.queries_this_month or 0

    if limit is not None and used >= limit and (profile.boost_credits or 0) > 0:
        profile.boost_credits = (profile.boost_credits or 0) - 1
    else:
        profile.queries_this_month = used + 1

    try:
        await db.commit()
    except Exception:
        # The verdict was already committed by the orchestrator earlier in
        # the request — rolling back here only drops the failed counter
        # increment, not the analysis the user just paid for. We log loudly
        # so a recurring failure here is visible (a user could in principle
        # escape charging on persistent DB blips) but never 5xx the request.
        import logging
        await db.rollback()
        logging.getLogger(__name__).exception(
            "quota.consume commit failed user_id=%s — counter NOT incremented",
            user_id,
        )


class QuotaExhausted(Exception):
    """Raised by `check` when the user is out of monthly analyses AND has
    no Boost Pack credits left. Carries the boost balance (always zero at
    raise-time under the current logic) so the router can still surface a
    consistent payload shape — the frontend uses it to decide whether to
    show "Grab a boost" vs "Upgrade plan" CTAs."""

    def __init__(self, plan: str, limit: int, reset_at: datetime, boost_credits: int = 0):
        self.plan = plan
        self.limit = limit
        self.reset_at = reset_at
        self.boost_credits = boost_credits
        super().__init__(
            f"Plan '{plan}' allows {limit}/month; resets at {reset_at.isoformat()}"
        )
