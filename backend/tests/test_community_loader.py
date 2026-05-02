"""Smoke tests for the community-price evidence loader.

Covers the anti-poisoning guarantees we rely on downstream:
  - all rows share one synthetic domain so volume can't fake diversity
  - trust weight is pinned at 0.80 (above trusted threshold, below curated)
  - token-overlap matcher drops rows with no meaningful service overlap
  - locality flag is set when the target city matches
  - DB failure returns `[]` so community is additive, never blocking
"""

import asyncio
import uuid
from types import SimpleNamespace

from app.intelligence.community import (
    COMMUNITY_DOMAIN_LABEL,
    COMMUNITY_TRUST_WEIGHT,
    load_community_prices,
)


def _run(coro):
    """Test harness runs on stock pytest — no pytest-asyncio plugin needed."""
    return asyncio.run(coro)


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalars(self._rows)

    def all(self):
        # Loader now does `select(col1, col2, ...)` + `result.all()` to dodge
        # ORM column expansion, so the fake needs to answer .all() directly.
        return list(self._rows)


class _FakeSession:
    """Minimal async session stand-in. Ignores the stmt, returns seeded rows."""

    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return _FakeResult(self._rows)


class _FailingSession:
    async def execute(self, _stmt):
        raise RuntimeError("simulated db outage")


def _row(*, service_type: str, city: str, price_paid: int = 35000):
    return SimpleNamespace(
        id=uuid.uuid4(),
        service_type=service_type,
        city=city,
        price_paid=price_paid,
    )


def test_rows_share_synthetic_domain_and_trust_weight():
    session = _FakeSession([
        _row(service_type="brake pad replacement", city="Austin"),
        _row(service_type="brake pad job", city="Austin"),
        _row(service_type="brake service", city="Austin"),
    ])
    records = _run(load_community_prices(
        session,
        domain="auto",
        target_city="Austin",
        target_state="TX",
        service_query="brake pad replacement on sedan",
    ))
    assert len(records) == 3
    assert all(r.domain_root == COMMUNITY_DOMAIN_LABEL for r in records)
    assert all(r.trust_weight == COMMUNITY_TRUST_WEIGHT for r in records)


def test_drops_rows_with_no_token_overlap():
    session = _FakeSession([
        _row(service_type="brake pad replacement", city="Austin"),
        _row(service_type="transmission rebuild", city="Austin"),
    ])
    records = _run(load_community_prices(
        session,
        domain="auto",
        target_city="Austin",
        target_state="TX",
        service_query="brake pad replacement",
    ))
    assert len(records) == 1
    assert "brake" in records[0].raw_snippet.lower()


def test_flags_local_when_city_matches():
    session = _FakeSession([
        _row(service_type="brake service", city="Austin, TX"),
        _row(service_type="brake service", city="Houston, TX"),
    ])
    records = _run(load_community_prices(
        session,
        domain="auto",
        target_city="Austin",
        target_state="TX",
        service_query="brake service",
    ))
    by_city = {r.raw_snippet: r.is_local for r in records}
    assert any(is_local for is_local in by_city.values())
    assert any(not is_local for is_local in by_city.values())


def test_db_failure_returns_empty_list_not_raise():
    records = _run(load_community_prices(
        _FailingSession(),
        domain="auto",
        target_city="Austin",
        target_state="TX",
        service_query="brake service",
    ))
    assert records == []


def test_empty_query_tokens_does_not_crash():
    session = _FakeSession([
        _row(service_type="brake service", city="Austin"),
    ])
    records = _run(load_community_prices(
        session,
        domain="auto",
        target_city="Austin",
        target_state="TX",
        service_query="a the for",
    ))
    assert len(records) == 1
