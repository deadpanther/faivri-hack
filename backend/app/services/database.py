from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# pool_timeout bounds how long a request waits for a free connection under
# burst load — default (30s) is way past Railway's 20s request budget, so a
# connection-pool stampede would surface as generic 502s instead of a fast
# 503. pool_recycle drops connections older than 30 min to survive silent
# Postgres restarts / idle-timeouts on managed providers (Railway, Supabase).
# pool_pre_ping catches dead sockets before we hand them to the request.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
