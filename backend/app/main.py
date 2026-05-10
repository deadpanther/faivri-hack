import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.services.database import engine
from app.services.limiter import limiter
from app.routers import analyze, negotiate, feedback, history, community, vehicles, recommend, waitlist, usage, webhooks, extension, extension_auth, student, billing, webhooks_stripe, share, messages, memory, nia, hyperspell, tensorlake

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a UUID request_id to every request for log correlation."""

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    # For hackathon SQLite deployment: auto-create tables if they don't exist.
    # Production uses Alembic migrations.
    if settings.database_url.startswith("sqlite"):
        from app.models.db import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="Faivri API",
    version="0.1.0",
    description="AI-powered consumer protection — price analysis and negotiation guidance",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(RequestIdMiddleware)

# CORS: In hackathon mode, allow all origins with credentials off.
# Otherwise, refuse to combine `*` with credentialed requests.
_IS_HACKATHON = bool(os.getenv("HACKATHON_MODE"))

if _IS_HACKATHON:
    # Override: allow all origins, disable credentials for simplicity
    _cors_origins = ["*"]
    _cors_credentials = False
else:
    if any(origin.strip() == "*" for origin in settings.cors_origin_list):
        raise RuntimeError(
            "CORS_ORIGINS must not include '*' while allow_credentials=True. "
            "Set it to an explicit comma-separated list of origins."
        )
    _cors_origins = settings.cors_origin_list
    _cors_credentials = True

# Prod fail-fast: refuse to boot with an empty or localhost-only allowlist on
# Railway. Previously the default ("http://localhost:3000") would ship silently
# to production, 403-ing every browser request from faivri.com.
# HACKATHON: Skip strict CORS checks — we'll set CORS_ORIGINS dynamically.
_IS_PROD = os.getenv("RAILWAY_ENVIRONMENT", "").lower() == "production" or \
    os.getenv("FAIVRI_ENV", "").lower() == "production"
if _IS_PROD and not os.getenv("HACKATHON_MODE"):
    if not settings.cors_origin_list:
        raise RuntimeError(
            "CORS_ORIGINS is empty in production. Set it to the comma-separated "
            "list of frontend + extension origins (e.g. https://faivri.com)."
        )
    if all("localhost" in o or "127.0.0.1" in o for o in settings.cors_origin_list):
        raise RuntimeError(
            f"CORS_ORIGINS is localhost-only in production ({settings.cors_origin_list}). "
            "Set it to the public frontend origin so browsers aren't blocked."
        )
    if not settings.admin_api_key:
        logger.warning(
            "ADMIN_API_KEY unset in production — admin endpoints will always 403. "
            "Set ADMIN_API_KEY on Railway if you need to call /admin/* endpoints."
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"^chrome-extension://[a-z0-9]+$|^https://[a-z0-9-]+\.vercel\.app$|^https?://localhost:[0-9]+$",
    allow_credentials=_cors_credentials,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Api-Key", "X-Faivri-Source", REQUEST_ID_HEADER],
    expose_headers=[REQUEST_ID_HEADER],
)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    request_id = getattr(request.state, "request_id", None)
    return JSONResponse(
        status_code=429,
        content={
            "detail": f"Rate limit exceeded: {exc.detail}",
            "request_id": request_id,
        },
        headers={"Retry-After": "60"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Log full trace server-side; return a generic message with request_id."""
    request_id = getattr(request.state, "request_id", None)
    logger.exception(
        "Unhandled exception [request_id=%s] %s %s",
        request_id, request.method, request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "request_id": request_id,
        },
    )


app.include_router(analyze.router, prefix="/api/v1", tags=["analyze"])
app.include_router(negotiate.router, prefix="/api/v1", tags=["negotiate"])
app.include_router(feedback.router, prefix="/api/v1", tags=["feedback"])
app.include_router(history.router, prefix="/api/v1", tags=["history"])
app.include_router(community.router, prefix="/api/v1", tags=["community"])
app.include_router(vehicles.router, prefix="/api/v1", tags=["vehicles"])
app.include_router(recommend.router, prefix="/api/v1", tags=["recommend"])
app.include_router(waitlist.router, prefix="/api/v1", tags=["waitlist"])
app.include_router(usage.router, prefix="/api/v1", tags=["usage"])
app.include_router(webhooks.router, prefix="/api/v1", tags=["webhooks"])
app.include_router(webhooks_stripe.router, prefix="/api/v1", tags=["webhooks"])
app.include_router(extension.router, prefix="/api/v1", tags=["extension"])
app.include_router(extension_auth.router, prefix="/api/v1", tags=["extension"])
app.include_router(student.router, prefix="/api/v1", tags=["student"])
app.include_router(billing.router, prefix="/api/v1", tags=["billing"])
app.include_router(share.router, prefix="/api/v1", tags=["share"])
# Hackathon sponsor routers — Nia (context search), Hyperspell (negotiation memory), Tensorlake (price monitors)
app.include_router(messages.router, prefix="/api/v1", tags=["messages"])
app.include_router(memory.router, prefix="/api/v1", tags=["memory"])
app.include_router(nia.router, prefix="/api/v1", tags=["nia"])
app.include_router(hyperspell.router, prefix="/api/v1", tags=["hyperspell"])
app.include_router(tensorlake.router, prefix="/api/v1", tags=["tensorlake"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "faivri-api"}


@app.get("/integrations")
async def integrations():
    """Report which hackathon sponsor integrations are live in this deploy.

    Surfaces honest 'Powered by ...' signals to the frontend so the
    landing page only credits a sponsor when their key is actually
    configured.
    """
    from app.services import nia, hyperspell, tensorlake

    return {
        "service": "faivri-api",
        "tagline": "AI-powered negotiation agent",
        "hackathon": "Nozomio AI Nexus — May 9, 2026",
        "track": "Ship It + Company Brain + Always-On Agents",
        "sponsors": {
            "nia": nia.status(),
            "hyperspell": hyperspell.status(),
            "tensorlake": tensorlake.status(),
        },
    }


@app.get("/health/deep")
async def health_deep():
    """Deep health probe — pings DB and Redis with short timeouts.

    Railway's default /health doesn't catch DB-pool saturation or a dead
    Upstash token; this endpoint returns 503 when either dependency is
    unreachable so the load balancer drains the bad replica. Timeouts are
    aggressive (1.5s) to avoid masking a slow dep as healthy."""
    import asyncio
    from sqlalchemy import text

    out: dict = {"service": "faivri-api", "status": "ok", "checks": {}}
    overall_ok = True

    try:
        async with engine.begin() as conn:
            await asyncio.wait_for(conn.execute(text("SELECT 1")), timeout=1.5)
        out["checks"]["database"] = "ok"
    except Exception as exc:
        overall_ok = False
        out["checks"]["database"] = f"error: {type(exc).__name__}"

    try:
        if settings.upstash_redis_url:
            from app.services.redis import get_redis
            client = await get_redis()
            if client is None:
                out["checks"]["redis"] = "error: client_init_failed"
                overall_ok = False
            else:
                pong = await asyncio.wait_for(client.ping(), timeout=1.5)
                ok = bool(pong)
                out["checks"]["redis"] = "ok" if ok else "error: ping_failed"
                if not ok:
                    overall_ok = False
        else:
            out["checks"]["redis"] = "skipped"
    except Exception as exc:
        overall_ok = False
        out["checks"]["redis"] = f"error: {type(exc).__name__}"

    # Schema drift: compare DB's alembic_version to the latest migration on
    # disk. Catches the "pushed new migration, forgot to run upgrade" case
    # where /health passes but queries against new columns 500.
    try:
        from alembic.config import Config as AlembicConfig
        from alembic.script import ScriptDirectory
        from sqlalchemy import text as sa_text
        import pathlib

        alembic_ini = pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"
        script = ScriptDirectory.from_config(AlembicConfig(str(alembic_ini)))
        expected_heads = set(script.get_heads())

        async with engine.begin() as conn:
            result = await asyncio.wait_for(
                conn.execute(sa_text("SELECT version_num FROM alembic_version")),
                timeout=1.5,
            )
            current_heads = {row[0] for row in result.fetchall()}

        if current_heads == expected_heads:
            out["checks"]["migrations"] = "ok"
        else:
            overall_ok = False
            out["checks"]["migrations"] = (
                f"error: drift (db={sorted(current_heads)}, expected={sorted(expected_heads)})"
            )
    except Exception as exc:
        # Don't flip overall_ok to False on inspection failure — a missing
        # alembic_version table is recoverable, and we'd rather serve
        # traffic than 503 if the introspection pipeline itself is broken.
        out["checks"]["migrations"] = f"skipped: {type(exc).__name__}"

    if not overall_ok:
        out["status"] = "degraded"
        return JSONResponse(status_code=503, content=out)
    return out
