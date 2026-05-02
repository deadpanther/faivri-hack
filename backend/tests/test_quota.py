"""Plan-quota math and monthly rollover.

These run against an in-memory SQLite harness so they don't depend on a
live Postgres. Core paths under guard:

- `check()` raises QuotaExhausted when `queries_this_month >= limit`.
- `check()` resets the counter and bumps `usage_reset_at` when the stored
  reset date is in the past (month-boundary roll).
- `consume()` increments the counter but never persists negatives.
- Unknown plan strings (e.g. a webhook typo) fall back to Scout so a
  misconfigured variant can't silently unlock unlimited usage.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.services.quota import (
    DEFAULT_PLAN,
    PLAN_LIMITS,
    QuotaExhausted,
    _first_of_next_month,
    _plan_limit,
    check,
    consume,
)


class _FakeProfile:
    def __init__(self, *, plan: str, queries_this_month: int,
                 usage_reset_at: datetime | None, boost_credits: int = 0):
        self.id = uuid.uuid4()
        self.plan = plan
        self.queries_this_month = queries_this_month
        self.usage_reset_at = usage_reset_at
        # Boost credits are an overflow reservoir read by quota.check(); a
        # missing attribute would AttributeError once the plan cap is hit.
        self.boost_credits = boost_credits


def _session_returning(profile: _FakeProfile | None):
    """Build an AsyncSession-shaped mock whose `execute(...)` returns an
    object whose `scalar_one_or_none()` yields the given profile."""
    session = AsyncMock()
    result = AsyncMock()
    result.scalar_one_or_none = lambda: profile
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    return session


def test_plan_limits_map_covers_all_published_tiers():
    assert set(PLAN_LIMITS.keys()) >= {"scout", "signal", "command"}
    assert PLAN_LIMITS["command"] is None
    assert PLAN_LIMITS["scout"] == 3
    assert PLAN_LIMITS["signal"] == 20


def test_unknown_plan_falls_back_to_scout():
    # A webhook typo that sets plan='Pro' shouldn't unlock unlimited usage.
    assert _plan_limit("pro") == PLAN_LIMITS[DEFAULT_PLAN]
    assert _plan_limit("") == PLAN_LIMITS[DEFAULT_PLAN]


def test_first_of_next_month_rolls_december():
    assert _first_of_next_month(datetime(2026, 12, 15)) == datetime(2027, 1, 1)
    assert _first_of_next_month(datetime(2026, 3, 31)) == datetime(2026, 4, 1)


def test_check_raises_when_scout_cap_is_hit():
    profile = _FakeProfile(
        plan="scout", queries_this_month=3,
        usage_reset_at=datetime.utcnow() + timedelta(days=10),
    )
    session = _session_returning(profile)
    with pytest.raises(QuotaExhausted) as exc:
        asyncio.run(check(session, str(profile.id)))
    assert exc.value.plan == "scout"
    assert exc.value.limit == 3


def test_check_allows_when_under_cap():
    profile = _FakeProfile(
        plan="signal", queries_this_month=4,
        usage_reset_at=datetime.utcnow() + timedelta(days=10),
    )
    session = _session_returning(profile)
    status = asyncio.run(check(session, str(profile.id)))
    assert status.plan == "signal"
    assert status.remaining == 16  # 20 - 4


def test_check_rolls_window_and_clears_counter_when_reset_is_past():
    # User was on Scout and had burned all 3. A full month has passed.
    profile = _FakeProfile(
        plan="scout", queries_this_month=3,
        usage_reset_at=datetime(2024, 1, 1),
    )
    session = _session_returning(profile)
    status = asyncio.run(check(session, str(profile.id)))
    assert status.used == 0
    assert status.remaining == 3
    assert profile.queries_this_month == 0
    assert profile.usage_reset_at > datetime.utcnow()


def test_check_unlimited_plan_never_raises():
    profile = _FakeProfile(
        plan="command", queries_this_month=10_000,
        usage_reset_at=datetime.utcnow() + timedelta(days=10),
    )
    session = _session_returning(profile)
    status = asyncio.run(check(session, str(profile.id)))
    assert status.remaining is None  # signals unlimited to the frontend


def test_consume_increments_monthly_counter():
    profile = _FakeProfile(
        plan="signal", queries_this_month=4,
        usage_reset_at=datetime.utcnow() + timedelta(days=5),
    )
    session = _session_returning(profile)
    asyncio.run(consume(session, str(profile.id)))
    assert profile.queries_this_month == 5


def test_consume_handles_missing_profile_without_raising():
    session = _session_returning(None)
    # Should not raise: a best-effort increment absorbs missing rows.
    asyncio.run(consume(session, str(uuid.uuid4())))
