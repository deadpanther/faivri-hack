"""Thin wrapper around Resend's HTTPS API.

Resend chosen over SMTP because it's a single outbound POST — no long-lived
connection to keep alive on Railway's autoscaler, no cert/STARTTLS dance,
and the sandboxed test mode lets us develop without burning real sends.

Routes that require email call `send_email()` and expect either a truthy
message id or `None` when the key is unset. The .edu verify flow converts
`None` into an HTTP 503 so the frontend can surface "email is temporarily
unavailable" rather than silently failing the OTP handshake.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import settings


logger = logging.getLogger(__name__)


async def send_email(to: str, subject: str, html: str) -> Optional[str]:
    """Send a transactional email. Returns Resend's message id or None."""
    if not settings.resend_api_key:
        logger.warning("resend_api_key unset; skipping email to %s", to)
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.resend_from_email,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("resend send failed: %s", exc)
        return None

    if resp.status_code >= 400:
        logger.error("resend rejected send to=%s status=%s body=%s", to, resp.status_code, resp.text[:400])
        return None

    data = resp.json() if resp.content else {}
    return data.get("id")
