"""Clerk auth — verify the JWT cryptographically, not by brute-force session scan.

Three public dependencies:
    get_optional_user_id  — returns user_id or None (anonymous-friendly)
    require_user_id       — 401 if not signed in
    require_admin         — 403 unless the admin API key header matches

AUTH-P1-01: the previous implementation fetched every active Clerk session and
linear-searched for the token. That's O(N) on global traffic AND does not
verify the JWT signature. This module replaces it with standard JWKS-based
RS256 verification (PyJWT + cryptography). The JWKS is cached for one hour.

The token's `iss` claim is how we discover the JWKS URL — Clerk signs each
environment's tokens with its own Frontend API domain, so we don't need to
hardcode the tenant. A small allow-list (`CLERK_ISSUER_HOSTS`) prevents a
forged `iss` from pointing us at an attacker-controlled JWKS.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from datetime import datetime
from typing import Any, Optional

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.db import ExtensionDeviceToken, Profile
from app.services.database import get_db

# Extension device tokens are prefixed so the auth layer can fast-path
# straight to the device-token table without doing JWT decoding work on
# every extension request.
EXTENSION_TOKEN_PREFIX = "fvt_"

logger = logging.getLogger(__name__)

JWKS_CACHE_TTL_SECONDS = 3600  # 1h
JWT_LEEWAY_SECONDS = 30        # clock-skew tolerance

# Only trust issuers hosted on Clerk's own domains. A valid Clerk token's `iss`
# looks like  https://<slug>.clerk.accounts.dev  or  https://clerk.<your-domain>.
# The hostname suffix check is the cheapest way to stop a forged `iss` from
# pointing our JWKS fetch at an attacker-controlled origin.
_DEFAULT_CLERK_ISSUER_HOST_SUFFIXES = (
    ".clerk.accounts.dev",
    ".clerk.com",
    ".accounts.dev",
)


def _issuer_host_suffixes() -> tuple[str, ...]:
    """Default Clerk-owned suffixes plus any custom domains from env.

    Prod Clerk signs with `iss=https://clerk.<your-domain>`, so the custom
    domain suffix (e.g. ".faivri.com") has to be in the allow-list or every
    authenticated request 401s. Read at call-time so test monkey-patches of
    `settings.clerk_allowed_issuer_hosts` take effect.
    """
    raw = (settings.clerk_allowed_issuer_hosts or "").strip()
    extras = tuple(
        suffix.strip() for suffix in raw.split(",") if suffix.strip()
    )
    return _DEFAULT_CLERK_ISSUER_HOST_SUFFIXES + extras


# Kept for backwards compat with anything importing the symbol directly.
CLERK_ISSUER_HOST_SUFFIXES = _DEFAULT_CLERK_ISSUER_HOST_SUFFIXES


# ─── JWKS cache ──────────────────────────────────────────────────────────────

# {jwks_url: (fetched_at_epoch, {kid: public_key})}
_jwks_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_jwks_lock = asyncio.Lock()


def _issuer_is_trusted(issuer: str) -> bool:
    try:
        host = httpx.URL(issuer).host
    except Exception:
        return False
    return any(host.endswith(suffix) for suffix in _issuer_host_suffixes())


async def _fetch_jwks(jwks_url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.get(jwks_url)
        res.raise_for_status()
        data = res.json()
    keys_by_kid: dict[str, Any] = {}
    for key in data.get("keys", []):
        kid = key.get("kid")
        if not kid:
            continue
        keys_by_kid[kid] = jwt.algorithms.RSAAlgorithm.from_jwk(key)
    return keys_by_kid


async def _get_signing_key(jwks_url: str, kid: str) -> Any:
    """Return the public key for `kid`, fetching & caching the JWKS as needed.

    Resilience (AUTH-P1-02): transient JWKS fetch failures used to 401 users
    whose tokens were otherwise valid. We now serve a stale cached key if the
    refetch fails, as long as we've successfully fetched at least once before.
    Only a cold-cache failure surfaces to the user.
    """
    now = time.time()
    cached = _jwks_cache.get(jwks_url)
    if cached and now - cached[0] < JWKS_CACHE_TTL_SECONDS and kid in cached[1]:
        return cached[1][kid]

    async with _jwks_lock:
        # Re-check under lock so concurrent misses share one fetch.
        cached = _jwks_cache.get(jwks_url)
        if cached and now - cached[0] < JWKS_CACHE_TTL_SECONDS and kid in cached[1]:
            return cached[1][kid]
        try:
            keys = await _fetch_jwks(jwks_url)
            _jwks_cache[jwks_url] = (now, keys)
        except Exception as exc:
            # Refetch failed. Fall back to stale cache if we have the kid —
            # a one-minute DNS blip shouldn't log everyone out.
            if cached and kid in cached[1]:
                logger.warning(
                    "JWKS refetch failed (%s); serving stale key for kid=%s",
                    exc, kid,
                )
                return cached[1][kid]
            raise

    if kid not in keys:
        # Key rotation edge case: token signed with a key not in the JWKS we
        # just fetched. Force a refetch on next call by clearing the cache.
        _jwks_cache.pop(jwks_url, None)
        raise jwt.InvalidKeyError(f"No signing key for kid={kid}")
    return keys[kid]


async def _verify_clerk_jwt(token: str) -> tuple[Optional[str], Optional[str]]:
    """Return (sub, sid) on a valid token, else (None, None).

    `sub` = Clerk user id; `sid` = Clerk session id. Session id feeds the
    2-device cap; absence of sid is acceptable (older tokens / machine
    tokens) and simply skips the cap enforcement.

    Never raises — bad tokens, fetch failures, etc. all collapse to
    (None, None) so the dependency layer can decide how to respond
    (401 vs anonymous).
    """
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg", "RS256")
        if not kid:
            return None, None

        # We have to peek at the payload to discover `iss`, but we do NOT trust
        # it yet — the signature check below is what makes it authoritative.
        unverified = jwt.decode(token, options={"verify_signature": False})
        issuer = unverified.get("iss")
        if not issuer or not _issuer_is_trusted(issuer):
            logger.warning("Rejecting JWT with untrusted issuer: %s", issuer)
            return None, None

        jwks_url = f"{issuer.rstrip('/')}/.well-known/jwks.json"
        signing_key = await _get_signing_key(jwks_url, kid)

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=[alg],
            issuer=issuer,
            leeway=JWT_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
        sub = payload.get("sub")
        sid = payload.get("sid")
        sub = sub if isinstance(sub, str) and sub else None
        sid = sid if isinstance(sid, str) and sid else None
        return sub, sid
    except jwt.PyJWTError as e:
        logger.info("JWT verification failed: %s", e)
        return None, None
    except Exception:
        logger.exception("Unexpected error verifying Clerk JWT")
        return None, None


# ─── Clerk sub → Profile UUID mapping ────────────────────────────────────────
# Routes scope queries to `profiles.id` (a UUID), not to Clerk's native
# `user_xxx` sub. Previously the auth dep returned the raw sub, which landed
# straight into `WHERE user_id = :user_id` against a UUID column and blew up
# with `invalid UUID 'user_3CAG...'`. We now translate sub → profile.id per
# request (and auto-create the row on first sign-in so users never see a
# stale-profile error).

async def _resolve_profile_id(db: AsyncSession, clerk_sub: str) -> Optional[str]:
    """Return the internal `profiles.id` UUID for this Clerk sub, creating a
    row on first sign-in. Returns None if the DB lookup fails completely —
    the caller surfaces that as 401 or anonymous, same as a bad token."""
    try:
        result = await db.execute(
            select(Profile.id).where(Profile.clerk_user_id == clerk_sub)
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            return str(existing)

        # Auto-provision: first time we've seen this Clerk user hit the API.
        profile = Profile(clerk_user_id=clerk_sub)
        db.add(profile)
        try:
            await db.commit()
            await db.refresh(profile)
            return str(profile.id)
        except IntegrityError:
            # Concurrent first-request raced us to INSERT. Pick up the winner's
            # row rather than failing the request.
            await db.rollback()
            result = await db.execute(
                select(Profile.id).where(Profile.clerk_user_id == clerk_sub)
            )
            existing = result.scalar_one_or_none()
            return str(existing) if existing is not None else None
    except Exception:
        logger.exception("Profile resolve/create failed for clerk_sub=%s", clerk_sub)
        return None


# ─── InsForge JWT verification (hackathon) ──────────────────────────────────

async def _verify_insforge_jwt(token: str) -> Optional[str]:
    """Verify an InsForge-issued JWT by calling the InsForge auth API.

    InsForge signs access tokens with a project JWT secret we don't have.
    Instead of trying to verify locally, we call getCurrentUser to validate
    the token and get the user ID.
    """
    try:
        insforge_url = settings.insforge_url
        if not insforge_url:
            return None

        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{insforge_url}/api/auth/sessions/current",
                headers={
                    "Authorization": f"Bearer {token}",
                },
            )
            logger.info("InsForge verify response: status=%d body=%s", resp.status_code, resp.text[:200])
            if resp.status_code != 200:
                return None
            data = resp.json()
            # Response shape: {"user": {"id": "...", ...}}
            user_obj = data.get("user", data)
            user_id = user_obj.get("id") or data.get("sub")
            if not user_id:
                return None

        # Resolve to internal profile
        from app.services.database import async_session
        async with async_session() as db:
            profile_id = await _resolve_profile_id(db, f"insforge_{user_id}")
            return profile_id
    except Exception:
        logger.exception("Unexpected error verifying InsForge JWT")
        return None


# ─── FastAPI dependencies ────────────────────────────────────────────────────

def _hash_device_token(raw: str) -> str:
    """Stable sha256 hash of an extension device token. The raw token is
    only ever hashed before it touches the database, so a DB leak does not
    grant API access."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def _verify_extension_device_token(
    db: AsyncSession, raw_token: str,
) -> Optional[str]:
    """Look up the profile UUID associated with an extension device token.

    Returns None if the token is unknown or revoked. Updates `last_used_at`
    on a successful match — best-effort, never raises into the caller."""
    if not raw_token.startswith(EXTENSION_TOKEN_PREFIX):
        return None
    token_hash = _hash_device_token(raw_token)
    try:
        result = await db.execute(
            select(ExtensionDeviceToken)
            .where(ExtensionDeviceToken.token_hash == token_hash)
            .where(ExtensionDeviceToken.revoked_at.is_(None))
        )
        row = result.scalar_one_or_none()
        if row is None:
            return None
        # Touch last_used_at on every authed call so revocation tooling can
        # surface "active in last 7 days" later. Use a separate UPDATE so a
        # concurrent commit on the request can't roll our timestamp back.
        try:
            await db.execute(
                update(ExtensionDeviceToken)
                .where(ExtensionDeviceToken.id == row.id)
                .values(last_used_at=datetime.utcnow())
            )
            await db.commit()
        except Exception:
            await db.rollback()
        return str(row.user_id)
    except Exception:
        logger.exception("Extension device token verification failed")
        return None


async def get_optional_user_id(
    authorization: Optional[str] = Header(None),
    user_agent: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> Optional[str]:
    """Return the internal profile UUID for the Clerk-authenticated user.

    Semantics (AUTH-P1-03):
    - No Authorization header at all      → None (anonymous traffic).
    - Header present but token is invalid → 401 (do NOT silently downgrade).

    Silent downgrade was the root cause of two defects: (1) an expired tab
    burned the anonymous IP cap instead of the user's plan quota, and (2)
    purchase analyses landed as `user_id=NULL` rows — readable to anyone
    holding the UUID. Refusing the request is the safer default.

    Extension device tokens (prefix `fvt_`) take precedence over the JWT
    path — they're long-lived bearer creds bound to a specific browser
    install, not Clerk session JWTs, so they bypass the JWKS/session-cap
    machinery entirely.
    """
    if not authorization:
        return None
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        # Empty Bearer header: treat as anonymous so misconfigured clients
        # that send `Authorization: ` don't hard-fail. The rarer case of an
        # *explicitly set* but malformed token drops into the next branch.
        return None

    # Fast-path extension device tokens BEFORE attempting Clerk JWT verify.
    if token.startswith(EXTENSION_TOKEN_PREFIX):
        device_user_id = await _verify_extension_device_token(db, token)
        if device_user_id:
            return device_user_id
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Extension token is invalid or revoked. Re-pair from faivri.com.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Try InsForge JWT first (hackathon auth)
    logger.info("Attempting InsForge JWT verification, token length=%d", len(token))
    insforge_user_id = await _verify_insforge_jwt(token)
    if insforge_user_id:
        logger.info("InsForge JWT verified: user_id=%s", insforge_user_id)
        return insforge_user_id
    logger.warning("InsForge JWT verification failed, falling back to Clerk")

    # Fall back to Clerk JWT verification
    clerk_sub, clerk_sid = await _verify_clerk_jwt(token)
    if not clerk_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    profile_id = await _resolve_profile_id(db, clerk_sub)
    if not profile_id:
        # DB failure resolving the profile — don't pretend this user is
        # anonymous (same leak). Surface the DB hiccup as 503 so the client
        # can retry. A flat 401 would force a needless re-sign-in.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Profile lookup temporarily unavailable. Please retry.",
        )
    # Enforce the 2-device cap. Best-effort: a generic failure here must
    # not take down the authed request. The one exception we DO surface is
    # SessionRevokedByCap — that's the case where an older device is still
    # using a JWT whose Clerk session was already kicked by a newer login.
    # The frontend uses the X-Faivri-Auth-Reason header to show a toast.
    if clerk_sid:
        from app.services.session_cap import (
            SessionRevokedByCap,
            touch_and_enforce,
        )
        try:
            await touch_and_enforce(db, profile_id, clerk_sid, user_agent)
        except SessionRevokedByCap:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Signed out — your account is now active on a different device.",
                headers={
                    "WWW-Authenticate": "Bearer",
                    "X-Faivri-Auth-Reason": "session_revoked_by_cap",
                },
            )
        except Exception:
            logger.exception("session cap enforcement failed user=%s", profile_id)
    return profile_id


async def require_user_id(
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> str:
    user_id = await get_optional_user_id(authorization=authorization, db=db)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def enforce_extension_auth(
    x_faivri_source: Optional[str] = Header(None),
    user_id: Optional[str] = Depends(get_optional_user_id),
) -> Optional[str]:
    """For routes shared between web + extension: require sign-in when the
    request is coming from the Chrome extension.

    Web traffic is anonymous-friendly (Free tier supports anonymous /analyze).
    Extension traffic must be paired — anonymous extension calls were a
    quota and abuse risk and the user-facing requirement is "sign in to
    track analyses". Other clients are unaffected.
    """
    if (x_faivri_source or "").lower() == "extension" and not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="sign_in_required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def require_admin(
    x_admin_api_key: Optional[str] = Header(None),
) -> None:
    """Require the configured admin API key. 403 otherwise (also 403 when the
    server's ADMIN_API_KEY env var is unset — effectively disables the route)."""
    expected = settings.admin_api_key
    if not expected or not x_admin_api_key or x_admin_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
