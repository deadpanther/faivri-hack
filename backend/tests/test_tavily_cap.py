"""Global Tavily monthly cap — covers the in-memory fallback path (no Redis).

The cap fires before any HTTP call so a runaway pipeline can't drain the
Tavily budget. We test the fallback counter path because it is the one we
rely on whenever Upstash is unreachable, which is also the failure mode an
attacker would try to induce.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.services import tavily as tav


def _reset_fallback():
    tav._fallback_counts.clear()


def test_below_cap_does_not_raise(monkeypatch):
    _reset_fallback()
    monkeypatch.setattr(tav.settings, "tavily_monthly_search_cap", 5)
    # Monkey-patch get_redis to return None so the fallback path is taken.
    with patch("app.services.tavily.get_redis", AsyncMock(return_value=None)):
        for _ in range(5):
            asyncio.run(tav._enforce_monthly_cap())


def test_over_cap_raises_typed_error(monkeypatch):
    _reset_fallback()
    monkeypatch.setattr(tav.settings, "tavily_monthly_search_cap", 2)
    with patch("app.services.tavily.get_redis", AsyncMock(return_value=None)):
        asyncio.run(tav._enforce_monthly_cap())
        asyncio.run(tav._enforce_monthly_cap())
        with pytest.raises(tav.TavilyMonthlyCapExceeded):
            asyncio.run(tav._enforce_monthly_cap())


def test_zero_cap_disables_check(monkeypatch):
    # Operators set the cap to 0 to disable the check (e.g. on a paid plan
    # that doesn't need it). The increment must NOT be ticked — otherwise
    # a future re-enable would already start over the line.
    _reset_fallback()
    monkeypatch.setattr(tav.settings, "tavily_monthly_search_cap", 0)
    with patch("app.services.tavily.get_redis", AsyncMock(return_value=None)):
        asyncio.run(tav._enforce_monthly_cap())
    assert tav._fallback_counts == {}


def test_search_blocks_when_cap_exhausted(monkeypatch):
    _reset_fallback()
    monkeypatch.setattr(tav.settings, "tavily_monthly_search_cap", 1)
    monkeypatch.setattr(tav.settings, "tavily_api_key", "test_key")
    with patch("app.services.tavily.get_redis", AsyncMock(return_value=None)):
        # First call: allowed. We mock the actual HTTP layer so the test never
        # makes a network call — the assertion is on which exception fires
        # when the cap gate trips.
        with patch("app.services.tavily.httpx.AsyncClient") as ac:
            instance = ac.return_value.__aenter__.return_value
            response = AsyncMock()
            response.json = lambda: {"results": []}
            response.raise_for_status = lambda: None
            instance.post = AsyncMock(return_value=response)
            asyncio.run(tav.search("first query"))
        # Second call: cap exhausted. The cap raises BEFORE the http call,
        # so even if the network succeeded the user would still see 503.
        with pytest.raises(tav.TavilyMonthlyCapExceeded):
            asyncio.run(tav.search("second query"))
