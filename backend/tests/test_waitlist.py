"""Waitlist endpoint: insert, dedupe, normalize.

Same in-memory aiosqlite harness as the analyze roundtrip test — cross-dialect
@compiles shims for JSONB/UUID, plus a Uuid.bind_processor patch so raw string
UUIDs land cleanly in the CHAR(36) column.
"""

from __future__ import annotations

import asyncio
import uuid

from httpx import AsyncClient, ASGITransport
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.main import app
from app.models.db import Base, WaitlistEntry
from app.services import database as database_service


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):  # noqa: ARG001
    return "JSON"


@compiles(PG_UUID, "sqlite")
def _compile_uuid_sqlite(type_, compiler, **kw):  # noqa: ARG001
    return "CHAR(36)"


from sqlalchemy.sql import sqltypes as _sqltypes  # noqa: E402

_orig_bind = _sqltypes.Uuid.bind_processor


def _patched_bind(self, dialect):
    inner = _orig_bind(self, dialect)
    if inner is None:
        return None

    def _process(value):
        if isinstance(value, str):
            value = uuid.UUID(value)
        return inner(value)

    return _process


_sqltypes.Uuid.bind_processor = _patched_bind


def _run(coro):
    return asyncio.run(coro)


async def _bootstrap():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async def _test_get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[database_service.get_db] = _test_get_db
    return engine, session_factory


async def _body():
    engine, session_factory = await _bootstrap()
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            first = await client.post(
                "/api/v1/waitlist",
                json={"email": "  HELLO@example.com ", "source": "landing"},
            )
            assert first.status_code == 200, first.text
            body1 = first.json()
            assert body1["created"] is True

            second = await client.post(
                "/api/v1/waitlist",
                json={"email": "hello@example.com"},
            )
            assert second.status_code == 200, second.text
            body2 = second.json()
            assert body2["created"] is False

            bad = await client.post(
                "/api/v1/waitlist",
                json={"email": "not-an-email"},
            )
            assert bad.status_code == 422

            # Internal whitespace must be rejected, not silently removed — a
            # prior version stripped all whitespace and would have accepted
            # "foo @ bar.com" as "foo@bar.com", quietly rewriting the user's
            # input into a different valid address.
            for malformed in ("foo @ bar.com", "john doe@example.com", "hi\tthere@x.com"):
                res = await client.post(
                    "/api/v1/waitlist", json={"email": malformed}
                )
                assert res.status_code == 422, f"expected 422 for {malformed!r}, got {res.status_code}"

            # Confirm exactly one row persisted, with normalized email.
            async with session_factory() as s:
                result = await s.execute(
                    __import__("sqlalchemy").select(
                        WaitlistEntry.email, WaitlistEntry.source
                    )
                )
                rows = list(result.all())
            assert len(rows) == 1
            assert rows[0][0] == "hello@example.com"
            assert rows[0][1] == "landing"
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


def test_waitlist_dedupes_and_normalizes():
    _run(_body())
