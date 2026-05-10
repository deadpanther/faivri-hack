"""Student (.edu) verification → 50% off Scholar pricing.

Flow:
  1. POST /auth/student/verify  — body {email}. Validates domain is a real
     .edu (regex + deny-list), generates a 6-digit OTP, stores a hashed
     record in Redis keyed by email hash, sends the OTP via Resend to the
     address. Authenticated: only a signed-in user can initiate.
  2. POST /auth/student/confirm — body {email, otp}. Verifies the OTP,
     sets `profile.student_discount_until = now + 180 days`, stashes the
     email hash for replay guards. Returns active_until so the frontend
     can refresh the pricing badge.
  3. GET  /auth/student/status   — returns whether the current user has
     an active Scholar discount and when it expires.

Design notes:
  * The OTP is only ever stored hashed (sha256). If Redis leaks we still
    don't expose the raw codes.
  * Rate limit: 3 verify requests per email per hour, 3 confirm attempts
    per OTP. Redis counters with 1h / 10m TTL.
  * Disposable domain deny-list: services/disposable_emails.py. Kept
    narrow to avoid false-positive blocks on real students.
  * If Resend isn't configured we hard-fail with 503 rather than silently
    saving nothing to Redis — no "OTP sent" lie to the user.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Profile
from app.services.auth import require_user_id
from app.services.clerk_admin import get_primary_verified_email
from app.services.database import get_db
from app.services.disposable_emails import is_disposable
from app.services.email import send_email
from app.services.redis import get_redis


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/student", tags=["student"])


SCHOLAR_DURATION_DAYS = 180
OTP_TTL_SECONDS = 10 * 60            # 10 minutes to paste the code
OTP_MAX_ATTEMPTS = 3
SEND_LIMIT_PER_HOUR = 3
SEND_WINDOW_SECONDS = 60 * 60        # 1h

# .edu and common international academic TLDs. Start narrow — expand as
# real students report false blocks.
_EDU_PATTERN = re.compile(
    r"^[a-z0-9][a-z0-9._%+\-]*@"
    r"(?:[a-z0-9\-]+\.)+"
    r"(?:edu|edu\.[a-z]{2}|ac\.[a-z]{2})$",
    re.IGNORECASE,
)


class VerifyRequest(BaseModel):
    email: str = Field(..., max_length=254)


class ConfirmRequest(BaseModel):
    email: str = Field(..., max_length=254)
    otp: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


def _hash_email(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def _hash_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode("utf-8")).hexdigest()


def _validate_edu(email: str) -> None:
    if not _EDU_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Email must be a real .edu or academic address.")
    if is_disposable(email):
        raise HTTPException(status_code=400, detail="Temporary or disposable addresses aren't accepted.")


async def _rate_check_send(email_hash: str) -> None:
    r = await get_redis()
    if r is None:
        return
    key = f"fc:student:send:{email_hash}"
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, SEND_WINDOW_SECONDS)
    if count > SEND_LIMIT_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Too many verification attempts for this address. Try again in an hour.",
        )


def _render_otp_email(otp: str) -> str:
    return f"""
    <!doctype html>
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #FDFBF6; padding: 32px;">
        <div style="max-width: 440px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; border: 1px solid rgba(55,53,47,0.09);">
          <p style="font-size: 13px; font-weight: 600; color: #9B9A97; text-transform: uppercase; letter-spacing: 0.08em; margin: 0;">Faivri Scholar</p>
          <h1 style="font-size: 24px; font-weight: 700; color: #37352F; margin: 12px 0 8px;">Verify your student email</h1>
          <p style="font-size: 14px; color: #6B6B6B; line-height: 1.5; margin: 0 0 24px;">
            Paste this code into Faivri to unlock Scholar pricing — 50% off every plan for the semester.
          </p>
          <div style="background: #F7F7F5; border-radius: 12px; padding: 20px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 0.25em; color: #37352F; font-family: 'SF Mono', Monaco, monospace;">
            {otp}
          </div>
          <p style="font-size: 12px; color: #9B9A97; margin: 24px 0 0;">
            This code expires in 10 minutes. If you didn't request it, you can ignore this email.
          </p>
        </div>
      </body>
    </html>
    """


@router.post("/verify-clerk")
async def verify_student_via_clerk(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Skip-the-OTP path: trust Clerk's existing email verification.

    When a user is already signed in with a Clerk-verified .edu address
    (e.g. they registered with their school email), there's no value in
    making them paste a second OTP — Clerk has already proved they own the
    inbox. We pull the primary email via the Clerk Backend API, reject
    anything Clerk hasn't marked verified, validate it's a real .edu, and
    flip on the Scholar discount in a single call.

    The OTP-based /verify path remains as the fallback for users whose
    Clerk primary email isn't a school address — they can verify a
    secondary .edu without changing their login.
    """
    profile = await _load_profile(db, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    if not profile.clerk_user_id:
        raise HTTPException(status_code=400, detail="Account not linked to Clerk.")

    email = await get_primary_verified_email(profile.clerk_user_id)
    if not email:
        # Caller couldn't be auto-verified — surface a 422 so the frontend
        # can fall through to the OTP form rather than treating this as a
        # service outage.
        raise HTTPException(
            status_code=422,
            detail="Your primary email isn't a verified .edu address. Use the form below to verify a school email instead.",
        )

    try:
        _validate_edu(email)
    except HTTPException as exc:
        # Same fall-through signal — the user's Clerk email is verified but
        # not a school address. Send them to the OTP form.
        raise HTTPException(
            status_code=422,
            detail="Your primary email isn't a school address. Use the form below to verify a .edu instead.",
        ) from exc

    email_hash = _hash_email(email)
    active_until = datetime.utcnow() + timedelta(days=SCHOLAR_DURATION_DAYS)
    profile.student_discount_until = active_until
    profile.student_email_hash = email_hash
    await db.commit()

    logger.info(
        "student auto-verified via clerk user=%s until=%s",
        user_id, active_until.isoformat(),
    )
    return {
        "verified": True,
        "active_until": active_until.isoformat(),
        "discount_pct": 50,
        "method": "clerk",
        "email_masked": _mask_email(email),
    }


@router.post("/verify")
async def verify_student_email(
    payload: VerifyRequest,
    user_id: str = Depends(require_user_id),
):
    email = payload.email.strip().lower()
    _validate_edu(email)
    email_hash = _hash_email(email)

    await _rate_check_send(email_hash)

    r = await get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Verification is temporarily unavailable.")

    otp = f"{secrets.randbelow(1_000_000):06d}"
    otp_hash = _hash_otp(otp)

    # Store the OTP hash + attempt counter. The verify key is scoped per
    # email hash so a parallel laptop + phone session can't race each
    # other into weird states.
    await r.setex(f"fc:student:otp:{email_hash}", OTP_TTL_SECONDS, otp_hash)
    await r.setex(f"fc:student:attempts:{email_hash}", OTP_TTL_SECONDS, "0")

    msg_id = await send_email(
        to=email,
        subject="Your Faivri Scholar verification code",
        html=_render_otp_email(otp),
    )
    if msg_id is None:
        # Roll back the OTP so we don't strand the user — they'd see a
        # "code sent" UI but never receive anything.
        await r.delete(f"fc:student:otp:{email_hash}", f"fc:student:attempts:{email_hash}")
        raise HTTPException(status_code=503, detail="Couldn't send the verification email right now.")

    masked = _mask_email(email)
    logger.info("student verify initiated user=%s masked=%s", user_id, masked)
    return {"sent": True, "email_masked": masked, "expires_in_seconds": OTP_TTL_SECONDS}


@router.post("/confirm")
async def confirm_student_email(
    payload: ConfirmRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    email = payload.email.strip().lower()
    _validate_edu(email)
    email_hash = _hash_email(email)

    r = await get_redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Verification is temporarily unavailable.")

    otp_key = f"fc:student:otp:{email_hash}"
    attempts_key = f"fc:student:attempts:{email_hash}"

    stored = await r.get(otp_key)
    if stored is None:
        raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")

    attempts = await r.incr(attempts_key)
    if attempts > OTP_MAX_ATTEMPTS:
        await r.delete(otp_key, attempts_key)
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")

    if _hash_otp(payload.otp) != stored:
        raise HTTPException(status_code=400, detail="That code didn't match. Double-check and try again.")

    # One-shot: consume the OTP so it can't be replayed.
    await r.delete(otp_key, attempts_key)

    profile = await _load_profile(db, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")

    active_until = datetime.utcnow() + timedelta(days=SCHOLAR_DURATION_DAYS)
    profile.student_discount_until = active_until
    profile.student_email_hash = email_hash
    await db.commit()

    logger.info(
        "student verified user=%s until=%s", user_id, active_until.isoformat()
    )
    return {
        "verified": True,
        "active_until": active_until.isoformat(),
        "discount_pct": 50,
    }


@router.get("/status")
async def student_status(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    profile = await _load_profile(db, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")

    active_until = profile.student_discount_until
    is_active = bool(active_until and active_until > datetime.utcnow())
    return {
        "active": is_active,
        "active_until": active_until.isoformat() if active_until else None,
        "discount_pct": 50 if is_active else 0,
    }


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + "*" * (len(local) - 2) + local[-1]
    return f"{masked_local}@{domain}"


async def _load_profile(db: AsyncSession, user_id: str) -> Optional[Profile]:
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    return result.scalar_one_or_none()
