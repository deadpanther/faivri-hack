from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

_kwargs: dict = dict(echo=False)
if not _is_sqlite:
    _kwargs.update(
        pool_size=5,
        max_overflow=10,
        pool_timeout=10,
        pool_recycle=1800,
        pool_pre_ping=True,
    )

engine = create_async_engine(settings.database_url, **_kwargs)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
