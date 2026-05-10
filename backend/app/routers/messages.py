"""POST /api/v1/messages/draft — Photon reply coach.

Photon reads an inbound seller message, pulls the negotiation memory from
HydraDB, and drafts a polite, data-backed reply the user can send verbatim.

This router is *new top-level surface* for the messaging assistant. The
existing `/extension/reply-coach` route stays untouched because the Chrome
extension depends on its exact contract; new web-app callers (the /messages
page) are pointed here. Both eventually share the Photon orchestrator.
"""

import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.auth import enforce_extension_auth
from app.services.database import get_db
from app.services.limiter import RATE_LIMIT_NEGOTIATE, limiter
from app.services.photon import (
    ALLOWED_TONES,
    DEFAULT_TONE,
    PhotonGroundingMissing,
    draft_reply,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Request / response shapes ──────────────────────────────────────────────

class DraftReplyRequest(BaseModel):
    query_id: UUID = Field(
        ...,
        description="ID of the verdict this negotiation belongs to.",
    )
    seller_message: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description="The seller's most recent message (paste verbatim).",
    )
    user_intent: Optional[str] = Field(
        default=None,
        max_length=500,
        description="Optional hint about what the user wants out of this turn.",
    )
    tone: Optional[str] = Field(
        default=DEFAULT_TONE,
        description=f"One of: {', '.join(ALLOWED_TONES)}",
    )
    provider: Optional[str] = Field(
        default="anthropic",
        description="Preferred LLM provider (Photon will route through GMI Cloud first).",
    )

    @field_validator("tone")
    @classmethod
    def _coerce_tone(cls, v: Optional[str]) -> str:
        if v is None or v not in ALLOWED_TONES:
            return DEFAULT_TONE
        return v


class DraftReplyResponse(BaseModel):
    reply: str
    tone: str
    suggested_price_cents: Optional[int]
    served_by: str
    grounded_in: dict


# ─── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/messages/draft", response_model=DraftReplyResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def messages_draft(
    request: Request,
    body: DraftReplyRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Draft a polite, data-backed reply for the user to send to the seller.

    Returns 409 when the verdict has no negotiation memory yet — that
    means the user hasn't analyzed the quote, so Photon has nothing to
    ground its reply in. The frontend turns that into a "Run an analysis
    first" CTA.
    """
    try:
        reply = await draft_reply(
            db,
            query_id=body.query_id,
            seller_message=body.seller_message,
            user_intent=body.user_intent,
            tone=body.tone or DEFAULT_TONE,
            requested_provider=body.provider or "anthropic",
        )
    except PhotonGroundingMissing as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception:
        logger.exception(
            "Photon draft failed [user=%s query=%s]", user_id, body.query_id,
        )
        raise HTTPException(
            status_code=503,
            detail="Photon is briefly unavailable. Try again in a moment.",
        )

    return DraftReplyResponse(
        reply=reply.text,
        tone=reply.tone,
        suggested_price_cents=reply.suggested_price_cents,
        served_by=reply.served_by,
        grounded_in=reply.grounded_in,
    )
