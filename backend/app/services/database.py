import logging

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

logger = logging.getLogger(__name__)

# ── Resolve effective database URL ──────────────────────────────────────
# InsForge managed Postgres is the primary. If INSFORGE_DATABASE_URL is
# set (e.g. on Railway), we use it. Otherwise fall back to local SQLite.
_effective_url = settings.insforge_database_url or settings.database_url
_is_sqlite = _effective_url.startswith("sqlite")

logger.info(
    "Database: %s (%s)",
    "InsForge Postgres" if settings.insforge_database_url else "local SQLite",
    _effective_url.split("@")[-1] if "@" in _effective_url else _effective_url,
)

_kwargs: dict = dict(echo=False)
if not _is_sqlite:
    _kwargs.update(
        pool_size=5,
        max_overflow=10,
        pool_timeout=10,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

engine = create_async_engine(_effective_url, **_kwargs)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
