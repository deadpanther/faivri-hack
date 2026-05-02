"""Extension device-token pairing flow.

Endpoints implementing the rendezvous handshake between the Chrome
extension popup and a signed-in faivri.com tab:

  POST /extension/device/start
      Caller: extension popup (no auth).
      Generates a short-lived pairing code. Returns the code + the deep
      link the user opens in a new tab.

  POST /extension/device/pair
      Caller: signed-in faivri.com (Clerk-authed).
      Confirms the code on behalf of the active Clerk user. The web app
      hits this when the user clicks "Pair extension" in /extension/link.
      Mints a device token; stashes the raw token in a single-use slot
      that /poll drains.

  POST /extension/device/poll
      Caller: extension popup (no auth).
      Returns the raw `fvt_*` token exactly once after pair, then marks
      the rendezvous row as claimed so it can't be replayed.

  GET /extension/device/me
      Caller: extension popup (device-token or Clerk auth).
      Profile basics for the popup header.

  POST /extension/device/revoke
      Caller: extension popup (device-token auth).
      Revokes the current device token. Powers the popup Sign-Out button.
"""

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import ExtensionDeviceToken, ExtensionPairCode, Profile
from app.services.auth import (
    EXTENSION_TOKEN_PREFIX,
    _hash_device_token,
    require_user_id,
)
from app.services.database import get_db
from app.services.limiter import RATE_LIMIT_NEGOTIATE, limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Pairing codes expire after 10 minutes. Long enough that a user can
# finish the click-through even if they get distracted; short enough
# that an abandoned code can't loiter on the table forever.
PAIR_CODE_TTL = timedelta(minutes=10)
PAIR_CODE_BYTES = 12
DEVICE_TOKEN_BYTES = 32
MAX_TOKENS_PER_USER = 10

# In-memory single-use slot for the raw device token between /pair and
# /poll. The rendezvous row only stores the hash; the raw token never
# touches disk. If the API process recycles between pair and poll, the
# user simply hits "Pair extension" again.
_PENDING_RAW_TOKENS: dict[str, str] = {}


class StartPairingRequest(BaseModel):
    label: Optional[str] = Field(default=None, max_length=128)


class StartPairingResponse(BaseModel):
    code: str
    pair_url: str
    expires_at: str


class ConfirmPairingRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=64)
    label: Optional[str] = Field(default=None, max_length=128)


class ConfirmPairingResponse(BaseModel):
    paired: bool


class PollPairingRequest(BaseModel):
    code: str = Field(..., min_length=8, max_length=64)


class PollPairingResponse(BaseModel):
    status: str  # "pending" | "paired" | "expired" | "claimed"
    token: Optional[str] = None


class DeviceMeResponse(BaseModel):
    user_id: str
    plan: str
    display_name: Optional[str]


def _build_pair_url(code: str, request: Request) -> str:
    """Browser deep link the popup surfaces. Pinned to faivri.com so the
    user lands on the marketing/web domain — never the bare API host."""
    return f"https://faivri.com/extension/link?code={code}"


def _expired(row: ExtensionPairCode) -> bool:
    return row.expires_at <= datetime.utcnow()


@router.post("/extension/device/start", response_model=StartPairingResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def start_pairing(
    request: Request,
    body: StartPairingRequest,
    db: AsyncSession = Depends(get_db),
    user_agent: Optional[str] = Header(None),
):
    """Generate a fresh pairing code. No auth — the extension calls this
    before the user is signed in. The code is useless without the matching
    /pair call from a signed-in faivri.com tab."""
    code = secrets.token_urlsafe(PAIR_CODE_BYTES).rstrip("=")
    now = datetime.utcnow()
    row = ExtensionPairCode(
        code=code,
        user_agent=(user_agent or "")[:512] or None,
        created_at=now,
        expires_at=now + PAIR_CODE_TTL,
    )
    db.add(row)
    await db.commit()
    return StartPairingResponse(
        code=code,
        pair_url=_build_pair_url(code, request),
        expires_at=row.expires_at.isoformat() + "Z",
    )


@router.post("/extension/device/pair", response_model=ConfirmPairingResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def confirm_pairing(
    request: Request,
    body: ConfirmPairingRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
    user_agent: Optional[str] = Header(None),
):
    """Confirm a pairing code on behalf of the signed-in user. Mints a
    device token; persists its hash on the rendezvous row + a per-token
    record for revocation tooling. The raw token is parked in
    _PENDING_RAW_TOKENS for /poll to consume — it never hits disk."""
    res = await db.execute(
        select(ExtensionPairCode).where(ExtensionPairCode.code == body.code)
    )
    row = res.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Pairing code not found")
    if _expired(row):
        raise HTTPException(
            status_code=410,
            detail="Pairing code expired — restart from the extension",
        )
    if row.paired_at is not None:
        if str(row.user_id) != user_id:
            raise HTTPException(
                status_code=409, detail="Code already paired to another account",
            )
        return ConfirmPairingResponse(paired=True)

    # Cap tokens per user. A leaked code can't be replayed indefinitely
    # by spamming /pair from a stolen Clerk session — over the cap we
    # revoke the oldest active token before issuing a new one.
    active_res = await db.execute(
        select(ExtensionDeviceToken)
        .where(ExtensionDeviceToken.user_id == UUID(user_id))
        .where(ExtensionDeviceToken.revoked_at.is_(None))
        .order_by(ExtensionDeviceToken.created_at.asc())
    )
    active = list(active_res.scalars().all())
    if len(active) >= MAX_TOKENS_PER_USER:
        active[0].revoked_at = datetime.utcnow()

    raw_token = (
        f"{EXTENSION_TOKEN_PREFIX}"
        f"{secrets.token_urlsafe(DEVICE_TOKEN_BYTES).rstrip('=')}"
    )
    token_hash = _hash_device_token(raw_token)

    device = ExtensionDeviceToken(
        id=uuid4(),
        user_id=UUID(user_id),
        token_hash=token_hash,
        label=body.label or "Chrome extension",
        user_agent=(row.user_agent or user_agent or "")[:512] or None,
        created_at=datetime.utcnow(),
    )
    db.add(device)

    row.user_id = UUID(user_id)
    row.device_token_hash = token_hash
    row.paired_at = datetime.utcnow()

    await db.commit()

    _PENDING_RAW_TOKENS[body.code] = raw_token
    logger.info("extension paired user=%s code=%s…", user_id, body.code[:6])
    return ConfirmPairingResponse(paired=True)


@router.post("/extension/device/poll", response_model=PollPairingResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def poll_pairing(
    request: Request,
    body: PollPairingRequest,
    db: AsyncSession = Depends(get_db),
):
    """Extension-side poll. Returns the raw token exactly once after pair,
    then marks the row as claimed so it can't be replayed."""
    res = await db.execute(
        select(ExtensionPairCode).where(ExtensionPairCode.code == body.code)
    )
    row = res.scalar_one_or_none()
    if row is None:
        return PollPairingResponse(status="expired")
    if _expired(row):
        return PollPairingResponse(status="expired")
    if row.paired_at is None:
        return PollPairingResponse(status="pending")
    if row.claimed_at is not None:
        return PollPairingResponse(status="claimed")

    raw = _PENDING_RAW_TOKENS.pop(body.code, None)
    if raw is None:
        # Process restart between pair and poll — user re-pairs.
        return PollPairingResponse(status="expired")

    row.claimed_at = datetime.utcnow()
    await db.commit()
    return PollPairingResponse(status="paired", token=raw)


@router.get("/extension/device/me", response_model=DeviceMeResponse)
async def device_me(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Profile basics for the popup header. Honors both `fvt_*` device
    tokens and Clerk JWTs via the shared require_user_id dep."""
    res = await db.execute(select(Profile).where(Profile.id == UUID(user_id)))
    profile = res.scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return DeviceMeResponse(
        user_id=str(profile.id),
        plan=profile.plan or "scout",
        display_name=profile.display_name,
    )


@router.post("/extension/device/revoke")
async def revoke_device(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: Optional[str] = Header(None),
):
    """Revoke the device token used to authenticate this request. Used
    by the popup Sign-Out button."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.removeprefix("Bearer ").strip()
    if not token.startswith(EXTENSION_TOKEN_PREFIX):
        raise HTTPException(status_code=400, detail="Not a device token")
    token_hash = _hash_device_token(token)
    res = await db.execute(
        select(ExtensionDeviceToken).where(
            ExtensionDeviceToken.token_hash == token_hash
        )
    )
    row = res.scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return {"revoked": False}
    row.revoked_at = datetime.utcnow()
    await db.commit()
    return {"revoked": True}
