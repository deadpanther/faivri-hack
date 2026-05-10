"""End-to-end roundtrip: POST /analyze → GET /history/{id} for a signed-in user.

This was the regression that shipped four times:
 1. Frontend never sent the Clerk JWT.
 2. Backend auth returned the raw Clerk sub (non-UUID) into a UUID column.
 3. /analyze never accepted user_id, so even authenticated writes saved as NULL.
 4. GET /history required user_id match; anonymous rows were unreadable.

We spin up the real FastAPI app, point it at an in-process async SQLite DB,
and override just the auth dep (so we don't need a real Clerk JWT). Tavily and
the LLM layer are stubbed so the pipeline stays offline.

Matches the repo convention of using `asyncio.run` over pytest-asyncio so the
suite runs with stock pytest (no plugin dependency).
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from httpx import AsyncClient, ASGITransport
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.main import app
from app.models.db import Base, Profile
from app.services import auth as auth_service
from app.services import database as database_service
from app.routers import analyze as analyze_router


# SQLite doesn't know JSONB or native UUID. Compile them to JSON/CHAR(36)
# just for this test module so the PG-native model still creates_all cleanly
# on an aiosqlite engine. Prod still gets the real PG types.
@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ARG001
    return "JSON"


@compiles(PG_UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):  # noqa: ARG001
    return "CHAR(36)"


# Prod passes raw UUID strings into UUID columns (asyncpg accepts that).
# SQLAlchemy's non-native Uuid bind_processor calls `.hex` on the value and
# chokes on plain strings. Wrap it so strings get promoted to uuid.UUID first —
# only for this test module.
from sqlalchemy.sql import sqltypes as _sqltypes  # noqa: E402

_orig_uuid_bind_processor = _sqltypes.Uuid.bind_processor


def _patched_uuid_bind_processor(self, dialect):
    inner = _orig_uuid_bind_processor(self, dialect)
    if inner is None:
        return None

    def _process(value):
        if isinstance(value, str):
            value = uuid.UUID(value)
        return inner(value)

    return _process


_sqltypes.Uuid.bind_processor = _patched_uuid_bind_processor


def _run(coro):
    return asyncio.run(coro)


async def _bootstrap_env(profile_id: str):
    """Fresh in-memory DB + auth stubs + offline pipeline for one test body."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async with session_factory() as s:
        s.add(Profile(id=uuid.UUID(profile_id), clerk_user_id="user_testsub"))
        await s.commit()

    async def _test_get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[database_service.get_db] = _test_get_db
    return engine


def _install_stubs(monkey: dict, profile_id: str):
    """Patch the auth + pipeline hot-spots on the module objects the routers
    imported. Returns a rollback callable for the caller."""
    originals = {
        "verify": auth_service._verify_clerk_jwt,
        "resolve": auth_service._resolve_profile_id,
        "process": analyze_router.process_query,
    }

    async def _fake_verify(_token):
        # `_verify_clerk_jwt` returns (sub, sid). The test stub doesn't need
        # a real sid — None skips the device-cap path in the auth dependency.
        return "user_testsub", None

    async def _fake_resolve(_db, _sub):
        return profile_id

    async def _fake_process_query(**kwargs: Any) -> dict:
        from app.intelligence.orchestrator import _store_query

        verdict = {
            "verdict": "fair",
            "overcharge_multiplier": 1.0,
            "fair_price_low": 5000,
            "fair_price_mid": 6000,
            "fair_price_high": 7000,
            "conservative_overpay": 0,
            "expected_overpay": 0,
            "confidence_score": 80,
            "data_points_count": 5,
            "explanation": "stub",
            "red_flags": [],
            "questions_to_ask": [],
            "evidence": {"sources": []},
            "quoted_price": kwargs.get("quoted_price"),
            "currency": "USD",
            "domain": "auto",
            "location_city": kwargs.get("city") or "Fremont",
            "location_country": "US",
        }
        classification = {
            "domain": "auto",
            "city": kwargs.get("city") or "Fremont",
            "country": "US",
            "service": "oil change",
            "quoted_price": kwargs.get("quoted_price"),
        }
        query_id = await _store_query(
            kwargs["db"], kwargs["query_text"], classification, verdict,
            kwargs.get("user_id"), "USD",
        )
        verdict["id"] = query_id
        return verdict

    auth_service._verify_clerk_jwt = _fake_verify
    auth_service._resolve_profile_id = _fake_resolve
    analyze_router.process_query = _fake_process_query
    monkey["originals"] = originals


def _restore_stubs(monkey: dict):
    originals = monkey.get("originals") or {}
    if "verify" in originals:
        auth_service._verify_clerk_jwt = originals["verify"]
    if "resolve" in originals:
        auth_service._resolve_profile_id = originals["resolve"]
    if "process" in originals:
        analyze_router.process_query = originals["process"]
    app.dependency_overrides.clear()


async def _roundtrip_body(profile_id: str) -> tuple[int, int, str]:
    engine = await _bootstrap_env(profile_id)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            headers = {"Authorization": "Bearer test-token"}
            r1 = await client.post(
                "/api/v1/analyze",
                json={"query": "oil change", "quoted_price": 40000, "city": "Fremont", "country": "US"},
                headers=headers,
            )
            assert r1.status_code == 200, r1.text
            query_id = r1.json()["id"]

            r2 = await client.get(f"/api/v1/history/{query_id}", headers=headers)
            r3 = await client.get(f"/api/v1/history/{query_id}")
            return r2.status_code, r3.status_code, query_id
    finally:
        await engine.dispose()


def test_signed_in_analyze_then_fetch_history_roundtrips():
    profile_id = str(uuid.uuid4())
    monkey: dict = {}
    _install_stubs(monkey, profile_id)
    try:
        auth_200, anon_401, query_id = _run(_roundtrip_body(profile_id))
        assert auth_200 == 200, "signed-in GET /history/{id} should succeed"
        assert anon_401 == 401, "anonymous GET /history/{id} should 401"
        assert uuid.UUID(query_id)
    finally:
        _restore_stubs(monkey)
