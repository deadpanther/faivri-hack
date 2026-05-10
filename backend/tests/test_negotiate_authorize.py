"""Regression guard for the negotiate/feedback ownership check.

Authorization rules:

1. The auth dep returns a `str`, but `query.user_id` is a `uuid.UUID` from the
   column. A raw `!=` between those never matches — authors got "Query not
   found" trying to open a script for their own verdict. Both IDs are
   normalized to str before comparison.

2. Anonymous queries (query.user_id is None) are SHARED handles — the extension
   emits anonymous /analyze responses whose ID is the only thing the client
   has to reopen the verdict, so follow-up routes (/negotiate, /negotiate/chat,
   /feedback) must accept them. The ID is already secret-grade (UUIDv4) and
   /analyze returns the verdict inline, so no new information leaks when the
   same ID is used to request scripts.

3. Owned queries stay strict: the caller must present the owning profile's
   UUID or they get 404 (same shape as "doesn't exist" so we don't leak which
   IDs are real).
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.negotiate import _authorize_query_access


def _fake_query(user_id):
    return SimpleNamespace(user_id=user_id)


def test_str_caller_matches_uuid_owner():
    owner = uuid.uuid4()
    _authorize_query_access(_fake_query(owner), str(owner))


def test_uuid_caller_matches_uuid_owner():
    owner = uuid.uuid4()
    _authorize_query_access(_fake_query(owner), str(owner))


def test_anonymous_query_is_shared_handle_for_anonymous_caller():
    # Extension anonymous flow: /analyze returned a verdict inline, and the same
    # caller now wants /negotiate against it. Must NOT raise.
    _authorize_query_access(_fake_query(None), None)


def test_anonymous_query_is_shared_handle_for_signed_in_caller():
    # A signed-in user who raced Clerk's AuthTokenBridge during /analyze may
    # land here with a signed-in caller against an anonymous query. Still OK.
    _authorize_query_access(_fake_query(None), str(uuid.uuid4()))


def test_mismatched_owner_404s():
    with pytest.raises(HTTPException) as excinfo:
        _authorize_query_access(_fake_query(uuid.uuid4()), str(uuid.uuid4()))
    assert excinfo.value.status_code == 404


def test_unauthenticated_caller_on_owned_query_404s():
    with pytest.raises(HTTPException) as excinfo:
        _authorize_query_access(_fake_query(uuid.uuid4()), None)
    assert excinfo.value.status_code == 404
