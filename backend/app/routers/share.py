"""Public share-token endpoints.

A signed-in (or anonymous) user clicks "Share" on a verdict; we mint an
unguessable token that points at the underlying record. Readers hit
`GET /api/v1/share/{token}` to fetch a sanitized payload — no receipt text,
no PII, no user_id, no source URLs that might leak the original listing
context. The public payload is the headline figures only, exactly the slice
a stranger needs to decide whether to try Faivri themselves.

Two record kinds are supported behind the same token shape:
- `query` — a /analyze verdict (services, retail, etc.)
- `purchase` — a /analyze/purchase used-car analysis

The frontend's `/share/[token]` route renders the response as a clean public
verdict page; `frontend/src/app/share/[token]/opengraph-image.tsx` consumes
the same payload to render the social preview image.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, Field, UUID4
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import PurchaseAnalysis, Query as QueryModel, ShareToken
from app.services.auth import enforce_extension_auth
from app.services.database import get_db
from app.services.limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter()

# 30-day token TTL. Long enough that a casual share survives a "I'll check
# this later" sleep, short enough that a forgotten link doesn't rank in
# search engines for ages with stale prices on it.
_SHARE_TOKEN_TTL = timedelta(days=30)

# 1/sec write rate per IP — minting share tokens is not a cost-bomb (no
# external API), but throttling keeps a runaway client from filling the
# table.
_RATE_SHARE_CREATE = "30/minute"
_RATE_SHARE_READ = "120/minute"


def _new_token() -> str:
    """24-byte URL-safe token (~32 chars). Ample entropy, fits in URL paths
    and OpenGraph URLs without escaping."""
    return secrets.token_urlsafe(24)


class CreateShareRequest(BaseModel):
    kind: str = Field(..., pattern="^(query|purchase)$")
    record_id: UUID4


class CreateShareResponse(BaseModel):
    token: str
    url: str
    expires_at: Optional[datetime] = None


class PublicSharePayload(BaseModel):
    """Sanitized public-read shape. Anything PII-bearing is intentionally
    omitted — receipt text, original source URLs, vendor names, the user's
    Clerk ID. Only the headline figures + safe context."""
    kind: str
    domain: str
    currency: str = "USD"
    quoted_price_cents: Optional[int] = None
    fair_low_cents: Optional[int] = None
    fair_high_cents: Optional[int] = None
    overcharge_multiplier: Optional[float] = None
    verdict: Optional[str] = None
    title: str
    subtitle: Optional[str] = None
    created_at: Optional[datetime] = None
    view_count: int = 0


def _site_url() -> str:
    """Public URL for share links. Hardcoded to avoid an env var that nobody
    sets in dev — Faivri's prod web frontend is the only consumer of this
    URL today, and the backend has no other place to encode it."""
    return "https://faivri.com"


def _build_query_payload(q: QueryModel, view_count: int) -> PublicSharePayload:
    """Sanitize a /analyze verdict for public consumption.

    The receipt text on `Query.input_text` can carry PII (medical context,
    legal matter descriptions, names of specific shops). We deliberately
    do NOT surface it here — the public title is a generic domain label
    and the subtitle is the city only, both safe to show a stranger.
    """
    overcharge = (
        float(q.overcharge_multiplier) if q.overcharge_multiplier is not None else None
    )
    return PublicSharePayload(
        kind="query",
        domain=q.domain or "auto",
        currency=q.currency or "USD",
        quoted_price_cents=q.quoted_price,
        fair_low_cents=q.fair_price_low,
        fair_high_cents=q.fair_price_high,
        overcharge_multiplier=overcharge,
        verdict=q.verdict,
        title=f"Quote check · {q.domain or 'service'}",
        subtitle=q.location_city or None,
        created_at=q.created_at,
        view_count=view_count,
    )


def _build_purchase_payload(
    p: PurchaseAnalysis, view_count: int,
) -> PublicSharePayload:
    payload = p.payload or {}
    fair_range = payload.get("fair_price_range") or {}
    title = f"{p.year} {p.make} {p.model}"
    miles = p.mileage_km or 0
    subtitle_bits: list[str] = []
    if miles:
        subtitle_bits.append(f"{int(round(miles / 1.609)):,} mi")
    if p.city:
        subtitle_bits.append(p.city)
    subtitle = " · ".join(subtitle_bits) if subtitle_bits else None
    overcharge = payload.get("overcharge_multiplier")
    return PublicSharePayload(
        kind="purchase",
        domain="used_cars",
        currency="USD",
        quoted_price_cents=p.asking_price,
        fair_low_cents=int(fair_range.get("low") or 0) or None,
        fair_high_cents=int(fair_range.get("high") or 0) or None,
        overcharge_multiplier=float(overcharge) if overcharge is not None else None,
        verdict=payload.get("asking_price_verdict"),
        title=title,
        subtitle=subtitle,
        created_at=p.created_at,
        view_count=view_count,
    )


async def _existing_token_for(
    db: AsyncSession, kind: str, record_id: UUID, owner_id: Optional[str],
) -> Optional[ShareToken]:
    """Idempotent mint — return a live, non-revoked token for the same record
    + owner pair if one already exists. Stops a rapid double-click on Share
    from peppering the table with a token per click."""
    now = datetime.utcnow()
    if kind == "query":
        stmt = select(ShareToken).where(
            ShareToken.kind == "query",
            ShareToken.query_id == record_id,
            ShareToken.revoked_at.is_(None),
        )
    else:
        stmt = select(ShareToken).where(
            ShareToken.kind == "purchase",
            ShareToken.purchase_id == record_id,
            ShareToken.revoked_at.is_(None),
        )
    if owner_id:
        stmt = stmt.where(ShareToken.owner_id == owner_id)
    else:
        stmt = stmt.where(ShareToken.owner_id.is_(None))
    result = await db.execute(stmt.order_by(ShareToken.created_at.desc()).limit(1))
    row = result.scalar_one_or_none()
    if row is None:
        return None
    if row.expires_at and row.expires_at <= now:
        return None
    return row


@router.post("/share", response_model=CreateShareResponse)
@limiter.limit(_RATE_SHARE_CREATE)
async def create_share(
    request: Request,
    req: CreateShareRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Mint (or reuse) a public share token for an existing verdict.

    Owner-only on owned records — same shape as /negotiate's `_authorize_*`
    helpers. Anonymous records (user_id IS NULL) are a shared handle: the
    UUID is the capability and anyone holding it can mint a share token.
    """
    if req.kind == "query":
        result = await db.execute(
            select(QueryModel).where(QueryModel.id == req.record_id)
        )
        q = result.scalar_one_or_none()
        if q is None:
            raise HTTPException(status_code=404, detail="Quote not found")
        if q.user_id is not None and (not user_id or str(user_id) != str(q.user_id)):
            raise HTTPException(status_code=404, detail="Quote not found")
        owner_clerk_id = str(q.user_id) if q.user_id else None
    else:  # purchase
        result = await db.execute(
            select(PurchaseAnalysis).where(PurchaseAnalysis.id == req.record_id)
        )
        p = result.scalar_one_or_none()
        if p is None:
            raise HTTPException(status_code=404, detail="Analysis not found")
        if p.user_id is not None and (not user_id or str(user_id) != str(p.user_id)):
            raise HTTPException(status_code=404, detail="Analysis not found")
        owner_clerk_id = str(p.user_id) if p.user_id else None

    existing = await _existing_token_for(db, req.kind, req.record_id, owner_clerk_id)
    if existing is not None:
        return CreateShareResponse(
            token=existing.token,
            url=f"{_site_url()}/share/{existing.token}",
            expires_at=existing.expires_at,
        )

    token = _new_token()
    expires_at = datetime.utcnow() + _SHARE_TOKEN_TTL
    row = ShareToken(
        token=token,
        kind=req.kind,
        query_id=req.record_id if req.kind == "query" else None,
        purchase_id=req.record_id if req.kind == "purchase" else None,
        owner_id=owner_clerk_id,
        expires_at=expires_at,
    )
    db.add(row)
    try:
        await db.commit()
    except Exception:
        # Token collision is astronomically unlikely (24 bytes of urandom),
        # but a transient DB failure during the insert shouldn't 5xx the
        # whole share flow — log and surface a generic 503 the UI can retry.
        logger.exception("share token insert failed kind=%s id=%s", req.kind, req.record_id)
        await db.rollback()
        raise HTTPException(status_code=503, detail="Could not create share link. Please retry.")

    return CreateShareResponse(
        token=token,
        url=f"{_site_url()}/share/{token}",
        expires_at=expires_at,
    )


@router.get("/share/{token}", response_model=PublicSharePayload)
@limiter.limit(_RATE_SHARE_READ)
async def get_share(
    request: Request,
    token: str = Path(..., min_length=8, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    """Public read — no auth. Returns a sanitized verdict.

    A 404 on a missing / revoked / expired token is intentional: even an
    owner shouldn't be able to enumerate revoked tokens through this route.
    Bumps `view_count` best-effort; a failure to increment doesn't block
    the response.
    """
    result = await db.execute(
        select(ShareToken).where(ShareToken.token == token)
    )
    share = result.scalar_one_or_none()
    if share is None or share.revoked_at is not None:
        raise HTTPException(status_code=404, detail="Share link not found")
    if share.expires_at and share.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=404, detail="Share link has expired")

    if share.kind == "query" and share.query_id is not None:
        q_result = await db.execute(
            select(QueryModel).where(QueryModel.id == share.query_id)
        )
        q = q_result.scalar_one_or_none()
        if q is None:
            raise HTTPException(status_code=404, detail="Share link not found")
        payload = _build_query_payload(q, share.view_count + 1)
    elif share.kind == "purchase" and share.purchase_id is not None:
        p_result = await db.execute(
            select(PurchaseAnalysis).where(PurchaseAnalysis.id == share.purchase_id)
        )
        p = p_result.scalar_one_or_none()
        if p is None:
            raise HTTPException(status_code=404, detail="Share link not found")
        payload = _build_purchase_payload(p, share.view_count + 1)
    else:
        raise HTTPException(status_code=404, detail="Share link not found")

    # Best-effort view counter bump — a stale count in the response body is
    # cosmetically wrong, not load-bearing, so we don't 5xx on a write fail.
    try:
        await db.execute(
            update(ShareToken)
            .where(ShareToken.id == share.id)
            .values(view_count=ShareToken.view_count + 1)
        )
        await db.commit()
    except Exception:
        logger.warning("share view_count bump failed token=%s", token)
        await db.rollback()

    return payload
