"""POST /api/v1/waitlist — persist a marketing-site email signup.

Idempotent: re-submitting the same email returns the existing row rather than
raising a 409. Emails are normalized (trimmed + lower-cased) so case/whitespace
variants dedupe cleanly. The caller gets a `created: bool` so the UI can pick
between "You're on the list" and "You're already on the list".
"""

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import WaitlistEntry
from app.services.database import get_db
from app.services.limiter import limiter

router = APIRouter()

# Abuse guard — one IP can't hammer the endpoint to probe email existence.
RATE_LIMIT_WAITLIST = "10/minute"

# Deliberately loose — we want to catch user typos without forcing a hard
# dependency on `email-validator`. The DB unique constraint is the source of
# truth for "is this the same email".
#
# Internal whitespace is NOT stripped: "foo @ bar.com" and "john doe@x.com"
# must fail validation rather than be silently rewritten into a different
# valid address. Only leading/trailing whitespace is trimmed.
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _normalize_email(raw: str) -> str:
    return raw.strip().lower()


class WaitlistRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    source: Optional[str] = Field(default=None, max_length=64)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        normalized = _normalize_email(value)
        if not _EMAIL_RE.match(normalized):
            raise ValueError("Invalid email address")
        return normalized


class WaitlistResponse(BaseModel):
    status: str
    created: bool
    message: str


@router.post("/waitlist", response_model=WaitlistResponse)
@limiter.limit(RATE_LIMIT_WAITLIST)
async def join_waitlist(
    request: Request,
    payload: WaitlistRequest,
    db: AsyncSession = Depends(get_db),
) -> WaitlistResponse:
    email = payload.email  # already normalized by the validator

    # Try insert first; fall back to lookup on unique-constraint race.
    entry = WaitlistEntry(email=email, source=payload.source)
    db.add(entry)
    try:
        await db.commit()
        return WaitlistResponse(
            status="ok",
            created=True,
            message="You're on the waitlist. We'll be in touch.",
        )
    except IntegrityError:
        await db.rollback()
        result = await db.execute(
            select(WaitlistEntry.id).where(WaitlistEntry.email == email)
        )
        if result.scalar_one_or_none() is None:
            # Unique violation without a matching row means something else blew
            # up — surface as a generic failure rather than lie about success.
            raise HTTPException(status_code=500, detail="Could not join waitlist")
        return WaitlistResponse(
            status="ok",
            created=False,
            message="You're already on the waitlist.",
        )
