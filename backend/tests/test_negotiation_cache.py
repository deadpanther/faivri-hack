"""Playbook cache round-trip + counter-offer dedupe TTL.

These tests cover the pure helpers — no DB, no LLM. The full request flow is
exercised by the live E2E suite; the goal here is locking down two
invariants:

1. A serialized playbook deserializes back into an identical NegotiateResponse
   (apart from `freshness.cached`, which is set on read by design). Without
   this, a future field rename silently turns every cached blob into a cache
   miss and we pay LLM costs we thought we'd eliminated.

2. A version mismatch on the cache blob is treated as a miss. We don't want
   the next deploy serving stale cached scripts that don't match the current
   response shape.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace

from app.models.schemas import NegotiateResponse
from app.routers.negotiate import (
    COUNTER_OFFER_CACHE_TTL,
    PLAYBOOK_CACHE_VERSION,
    _build_cached_response,
    _serialize_playbook_for_cache,
)


def _query(currency="USD", domain="auto", created_at=None):
    return SimpleNamespace(
        currency=currency,
        domain=domain,
        created_at=created_at or datetime.utcnow(),
    )


def _response():
    return NegotiateResponse(
        target_price=8500,
        walk_away_above=12000,
        currency="USD",
        scripts=[{"role": "open", "text": "Best you can do at $85?"}],
        tactics=[{"name": "anchor", "text": "Lead with $85, not $100."}],
        evidence_summary="3 comps within 12% of $85.",
        quoted_price=10000,
        domain="auto",
        freshness={"checked_at": "2026-04-28T12:00:00", "refreshed": False},
    )


def test_round_trip_cache_blob_preserves_response_fields():
    original = _response()
    blob = _serialize_playbook_for_cache(original)

    assert blob["version"] == PLAYBOOK_CACHE_VERSION
    assert blob["scripts"] == original.scripts

    rebuilt = _build_cached_response(blob, _query())
    assert rebuilt is not None
    assert rebuilt.target_price == original.target_price
    assert rebuilt.walk_away_above == original.walk_away_above
    assert rebuilt.scripts == original.scripts
    assert rebuilt.tactics == original.tactics
    assert rebuilt.evidence_summary == original.evidence_summary
    # `cached` is always set on the read side so the frontend can label it.
    assert rebuilt.freshness["cached"] is True


def test_blob_with_wrong_version_treated_as_miss():
    blob = _serialize_playbook_for_cache(_response())
    blob["version"] = PLAYBOOK_CACHE_VERSION + 1
    assert _build_cached_response(blob, _query()) is None


def test_empty_or_missing_scripts_treated_as_miss():
    blob = _serialize_playbook_for_cache(_response())
    blob["scripts"] = []
    assert _build_cached_response(blob, _query()) is None

    blob.pop("scripts")
    assert _build_cached_response(blob, _query()) is None


def test_non_dict_blob_treated_as_miss():
    assert _build_cached_response(None, _query()) is None
    assert _build_cached_response([], _query()) is None
    assert _build_cached_response("nope", _query()) is None


def test_counter_offer_cache_ttl_is_two_hours():
    # Locked because the cutoff is computed in the request handler — anything
    # other than 2h would let stale anchors leak into fresh advice.
    assert COUNTER_OFFER_CACHE_TTL == timedelta(hours=2)
