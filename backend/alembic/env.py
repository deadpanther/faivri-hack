"""Alembic migration runner — async-aware, picks up DATABASE_URL from settings.

We don't use the static `sqlalchemy.url` in alembic.ini because the app's
database URL lives in the same Settings object that the FastAPI runtime reads.
Keeping one source of truth here prevents the "migrations ran against the wrong
DB" class of incident.

Async-to-sync bridge: Alembic itself is sync. We open an AsyncEngine, then hand
its raw connection into `context.configure` via `run_sync`. This mirrors the
pattern documented in SQLAlchemy 2.0 + Alembic async cookbook.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import settings
from app.models.db import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Runtime-resolve the DB URL — honors `.env`, shell env, deploy secrets.
config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting — useful for CI review diffs."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
