"""Thin wrapper around Clerk's Backend API for server-side admin actions.

Used for:
  - revoke_session: terminate the oldest session when a user logs in on a
    3rd device. Clerk's own dashboard has a "max sessions" setting but it
    hard-rejects the new login; we flip that — newest wins, oldest gets out.
  - get_primary_verified_email: pulls the user's primary email + its verified
    state. Used by the Scholar verification flow to skip OTP when Clerk has
    already verified a .edu address (Resend-free path).

Clerk Backend API docs: https://clerk.com/docs/reference/backend-api
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings


logger = logging.getLogger(__name__)


async def revoke_session(clerk_session_id: str) -> bool:
    """Ask Clerk to terminate this session. Idempotent on their side —
    revoking an already-revoked session returns 200. Returns True on HTTP
    success, False on any failure (caller logs but never raises so a
    billing-critical request path isn't brought down by Clerk being slow)."""
    if not settings.clerk_secret_key:
        logger.warning("clerk_secret_key unset; skipping revoke for %s", clerk_session_id)
        return False
    if not clerk_session_id:
        return False

    url = f"https://api.clerk.com/v1/sessions/{clerk_session_id}/revoke"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
    except httpx.HTTPError as exc:
        logger.exception("clerk revoke failed session=%s err=%s", clerk_session_id, exc)
        return False

    if resp.status_code >= 400:
        logger.error(
            "clerk revoke rejected session=%s status=%s body=%s",
            clerk_session_id, resp.status_code, resp.text[:300],
        )
        return False
    return True


async def get_primary_verified_email(clerk_user_id: str) -> Optional[str]:
    """Return the user's primary email if Clerk has marked it verified.

    Returns None when:
      - the Clerk secret key isn't configured (local dev),
      - Clerk returns a non-2xx (network blip, deleted user, bad id),
      - the user has no primary email or it's unverified.

    The caller (Scholar verification flow) treats None as "fall back to the
    OTP path" rather than 5xx'ing — Clerk going down should never block a
    user from initiating verification.
    """
    if not settings.clerk_secret_key or not clerk_user_id:
        return None

    url = f"https://api.clerk.com/v1/users/{clerk_user_id}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("clerk user lookup failed user=%s err=%s", clerk_user_id, exc)
        return None

    if resp.status_code >= 400:
        logger.warning(
            "clerk user lookup rejected user=%s status=%s",
            clerk_user_id, resp.status_code,
        )
        return None

    try:
        data = resp.json()
    except ValueError:
        return None

    primary_id = data.get("primary_email_address_id")
    if not primary_id:
        return None

    for entry in data.get("email_addresses") or []:
        if entry.get("id") != primary_id:
            continue
        # Clerk reports verification under `verification.status == "verified"`.
        # Treat anything else (including missing) as unverified — we don't
        # want a typo'd email to grant Scholar pricing.
        verification = entry.get("verification") or {}
        if verification.get("status") != "verified":
            return None
        email = entry.get("email_address")
        if isinstance(email, str) and email.strip():
            return email.strip().lower()
        return None
    return None


async def get_primary_email(clerk_user_id: str) -> Optional[str]:
    """Return the user's primary email regardless of verification status.

    Used to prefill Stripe Checkout — Stripe re-validates the address before
    sending receipts, so handing it an unverified primary still saves the
    user from retyping. Verification-gated flows (Scholar) must use
    `get_primary_verified_email` instead.
    """
    if not settings.clerk_secret_key or not clerk_user_id:
        return None

    url = f"https://api.clerk.com/v1/users/{clerk_user_id}"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                url,
                headers={"Authorization": f"Bearer {settings.clerk_secret_key}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("clerk user lookup failed user=%s err=%s", clerk_user_id, exc)
        return None

    if resp.status_code >= 400:
        logger.warning(
            "clerk user lookup rejected user=%s status=%s",
            clerk_user_id, resp.status_code,
        )
        return None

    try:
        data = resp.json()
    except ValueError:
        return None

    primary_id = data.get("primary_email_address_id")
    if not primary_id:
        return None

    for entry in data.get("email_addresses") or []:
        if entry.get("id") != primary_id:
            continue
        email = entry.get("email_address")
        if isinstance(email, str) and email.strip():
            return email.strip().lower()
        return None
    return None
