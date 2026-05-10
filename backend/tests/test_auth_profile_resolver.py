"""Regression guard for the Clerk sub → profile.id mapping.

The auth dep previously returned the raw Clerk sub, which landed directly
into `WHERE user_id = :x` against a UUID column and threw:
    invalid UUID 'user_3CAG...': unexpected character 'u'
Now the resolver translates sub → profile.id (creating the Profile row on
first sign-in). These tests cover the three paths: existing profile,
auto-provision on first hit, and race-safe rollback.
"""

import asyncio
import uuid
from types import SimpleNamespace

from sqlalchemy.exc import IntegrityError

from app.services.auth import _resolve_profile_id


def _run(coro):
    return asyncio.run(coro)


class _FakeScalars:
    def __init__(self, val):
        self._val = val

    def one_or_none(self):
        return self._val


class _FakeResult:
    def __init__(self, val):
        self._val = val

    def scalar_one_or_none(self):
        return self._val


class _FakeSession:
    """Mimics the AsyncSession surface we actually touch in the resolver."""

    def __init__(self, select_results, commit_error=None, second_select=None):
        self._select_results = list(select_results)
        self._commit_error = commit_error
        self._second_select = second_select
        self._add_calls = 0
        self._commit_calls = 0
        self._refresh_calls = 0
        self._rollback_calls = 0
        self._refresh_assigned_id = None

    async def execute(self, _stmt):
        if not self._select_results:
            return _FakeResult(None)
        return _FakeResult(self._select_results.pop(0))

    def add(self, obj):
        self._add_calls += 1
        self._added_obj = obj

    async def commit(self):
        self._commit_calls += 1
        if self._commit_error is not None:
            err = self._commit_error
            self._commit_error = None
            raise err

    async def rollback(self):
        self._rollback_calls += 1

    async def refresh(self, obj):
        self._refresh_calls += 1
        # New profiles don't have an id until commit — simulate that.
        if obj.id is None:
            obj.id = uuid.uuid4()


def test_returns_existing_profile_id_without_inserting():
    existing_id = uuid.uuid4()
    session = _FakeSession([existing_id])
    result = _run(_resolve_profile_id(session, "user_existing"))
    assert result == str(existing_id)
    assert session._add_calls == 0
    assert session._commit_calls == 0


def test_creates_profile_on_first_sign_in():
    session = _FakeSession([None])  # first select misses
    result = _run(_resolve_profile_id(session, "user_new"))
    assert uuid.UUID(result)  # valid UUID string
    assert session._add_calls == 1
    assert session._commit_calls == 1
    assert session._refresh_calls == 1


def test_race_loses_insert_but_picks_up_winner():
    winner_id = uuid.uuid4()
    session = _FakeSession(
        select_results=[None, winner_id],
        commit_error=IntegrityError("x", {}, BaseException()),
    )
    result = _run(_resolve_profile_id(session, "user_raced"))
    assert result == str(winner_id)
    assert session._add_calls == 1
    assert session._commit_calls == 1
    assert session._rollback_calls == 1


def test_returns_none_when_db_is_down():
    class _BrokenSession:
        async def execute(self, _stmt):
            raise RuntimeError("simulated outage")

    result = _run(_resolve_profile_id(_BrokenSession(), "user_x"))
    assert result is None
