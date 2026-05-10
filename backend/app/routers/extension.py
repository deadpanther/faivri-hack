"""Extension Pro endpoints — Seller Risk Score, Listing Watch, Reply Coach.

These power the Chrome extension's add-on features. They are *additive*:
none of the existing /analyze, /negotiate, /history flows change.

Data strategy:
- Firecrawl is the new structured-extraction layer (seller profiles,
  listing status). Degrades gracefully when not configured — Seller Risk
  Score falls back to a Tavily-only heuristic.
- The Reply Coach is a thin wrapper over /negotiate/chat. We pass the
  user's tone preference through to the LLM via the user_message prefix
  so we don't have to reshape the existing LLM interface.
- Listing Watch persists to `listing_watches` — a background worker
  (tracked separately) consumes the table.

Note: no `from __future__ import annotations` here. With Pydantic v2 +
FastAPI, stringified annotations on Pydantic request/response models
break schema resolution at route-registration time.
"""

import ipaddress
import logging
import re
import socket
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import UUID4, BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import ListingWatch, Profile, Query as QueryModel
from app.services.auth import enforce_extension_auth, get_optional_user_id, require_user_id
from app.services.database import get_db
from app.services.firecrawl import extract as fc_extract
from app.services.firecrawl import is_configured as firecrawl_is_configured
from app.services.firecrawl import scrape as fc_scrape
from app.services.limiter import (
    RATE_LIMIT_NEGOTIATE,
    RATE_LIMIT_HISTORY_READ,
    limiter,
)
from app.services.tavily import search as tavily_search

logger = logging.getLogger(__name__)

router = APIRouter()

# Risk score thresholds — tune once we have real feedback data. These are
# deliberately conservative so the extension badge errs on the side of
# "amber" rather than falsely reassuring users with "green".
RISK_BAND_GREEN_MAX = 35
RISK_BAND_AMBER_MAX = 65

# How often we re-check a watched listing. Domain medians are from the docs:
# eBay fixed-price listings stale at ~14d, FB Marketplace at ~10d. We poll
# daily in between — the worker coalesces so a single user can't force
# Firecrawl spend.
WATCH_RECHECK_INTERVAL = timedelta(days=1)

# Allowed tone values for the reply coach. Mirrors the UI toggle so the LLM
# gets a constrained vocabulary. Anything outside this set collapses to
# "friendly" — the default tone used by the negotiation coach today.
ALLOWED_TONES = {"polite", "firm", "walk_away", "friendly"}
DEFAULT_TONE = "friendly"


# Hosts we will fetch via Firecrawl / Tavily. Without an allow-list, the
# listing URL flows straight into outbound HTTP fetches — meaning a user
# could point us at `http://169.254.169.254/...` (AWS IMDS), `http://
# localhost:5432/`, or any internal service. We validate against both the
# allow-list *and* the resolved IP being public, so DNS rebinding at
# fetch-time can't re-point an allowed host at loopback.
_ALLOWED_LISTING_HOSTS = (
    "ebay.com", "ebay.co.uk", "ebay.de", "ebay.com.au",
    "facebook.com", "fb.com",
    "craigslist.org",
    "offerup.com",
    "mercari.com",
    "poshmark.com",
    "etsy.com",
    "amazon.com", "amazon.in", "amazon.co.uk",
    "flipkart.com", "meesho.com", "olx.in",
)


def _host_is_allowed(host: str) -> bool:
    host = host.lower()
    return any(host == allowed or host.endswith("." + allowed) for allowed in _ALLOWED_LISTING_HOSTS)


def _validate_listing_url(url: str, field_name: str = "listing_url") -> str:
    """Reject URLs that could be weaponized into SSRF.

    - Scheme must be http(s).
    - Hostname must be a registered domain we recognise as a marketplace.
    - Hostname must resolve to a *public* IP (rules out 127.0.0.1,
      RFC1918, link-local, AWS IMDS, IPv6 loopback, etc.). We don't cache
      the resolution here — this is a best-effort gate; the outbound
      HTTP client should pair with a rebinding-safe resolver for full
      protection, but the combination of allow-list + IP check already
      blocks the common exploit classes.

    Raises HTTPException(400) instead of ValueError so Pydantic surfaces
    a consistent 400 to the extension rather than a 422.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name}: invalid URL")
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail=f"{field_name}: only http(s) URLs are accepted")
    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail=f"{field_name}: URL has no hostname")
    if not _host_is_allowed(host):
        raise HTTPException(
            status_code=400,
            detail=f"{field_name}: host is not a supported marketplace",
        )
    try:
        resolved = socket.gethostbyname(host)
        ip = ipaddress.ip_address(resolved)
    except (socket.gaierror, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name}: host is not resolvable")
    if not ip.is_global:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name}: host resolves to a non-public address",
        )
    return url


# ---------------------------------------------------------------------------
# Schemas (kept inline — these types don't escape this router)
# ---------------------------------------------------------------------------


class SellerRiskRequest(BaseModel):
    listing_url: str = Field(..., min_length=8, max_length=2048)
    seller_profile_url: Optional[str] = Field(default=None, max_length=2048)
    platform: Optional[str] = Field(default=None, max_length=32)

    @field_validator("listing_url", "seller_profile_url")
    @classmethod
    def _validate_url(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return value
        _validate_listing_url(value, field_name="url")
        return value


class SellerRiskReason(BaseModel):
    key: str
    label: str
    severity: str  # "info" | "warn" | "flag"


class SellerRiskResponse(BaseModel):
    score: int
    band: str  # "green" | "amber" | "red"
    summary: str
    reasons: list[SellerRiskReason]
    seller: dict[str, Any]
    data_sources: list[str]


class ReplyCoachRequest(BaseModel):
    query_id: UUID4
    session_id: str = Field(..., min_length=8, max_length=128)
    user_message: Optional[str] = Field(default=None, max_length=4000)
    seller_message: Optional[str] = Field(default=None, max_length=4000)
    tone: str = Field(default=DEFAULT_TONE)


class ReplyCoachMessage(BaseModel):
    role: str  # "user" | "assistant" | "seller"
    content: str
    at: Optional[str] = None
    tone: Optional[str] = None


class ReplyCoachResponse(BaseModel):
    reply: str
    tone: str
    suggested_price_cents: Optional[int] = None
    messages: list[ReplyCoachMessage]


class ListingWatchCreateRequest(BaseModel):
    listing_url: str = Field(..., min_length=8, max_length=2048)
    fair_high_cents: Optional[int] = Field(default=None, ge=0, le=10_000_000_000)
    last_known_price_cents: Optional[int] = Field(default=None, ge=0, le=10_000_000_000)
    query_id: Optional[UUID] = None
    initial_risk_score: Optional[int] = Field(default=None, ge=0, le=100)

    @field_validator("listing_url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        _validate_listing_url(value)
        return value


class ListingWatchResponse(BaseModel):
    id: UUID
    listing_url: str
    platform: Optional[str]
    status: str
    fair_high_cents: Optional[int]
    last_known_price_cents: Optional[int]
    initial_risk_score: Optional[int]
    next_check_at: Optional[str]
    last_checked_at: Optional[str]
    created_at: Optional[str]


# ---------------------------------------------------------------------------
# Seller Risk Score
# ---------------------------------------------------------------------------


_PLATFORM_HOSTS = {
    "ebay": ("ebay.com", "ebay.co.uk", "ebay.de"),
    "facebook": ("facebook.com", "fb.com"),
}


def _infer_platform(url: str, hint: Optional[str]) -> Optional[str]:
    if hint and hint.lower() in _PLATFORM_HOSTS:
        return hint.lower()
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return None
    for platform, hosts in _PLATFORM_HOSTS.items():
        if any(host.endswith(h) for h in hosts):
            return platform
    return None


def _derive_seller_profile_url(listing_url: str, platform: Optional[str]) -> Optional[str]:
    """Best-effort guess of the seller profile URL from a listing URL.

    We only handle eBay reliably — FB Marketplace seller profiles require
    auth and the listing URL doesn't contain the seller handle in a form
    we can parse. For FB we return None and let the caller pass the
    seller_profile_url explicitly from the content script.
    """
    if platform != "ebay":
        return None
    # eBay listing URLs look like https://www.ebay.com/itm/<id> — the seller
    # handle isn't in the URL, so we can't reconstruct the profile URL
    # without scraping the listing first. Leave that to the Firecrawl call.
    return None


_SELLER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "seller_handle": {"type": "string"},
        "account_age_years": {"type": "number"},
        "positive_feedback_percent": {"type": "number"},
        "feedback_count": {"type": "integer"},
        "active_listings_count": {"type": "integer"},
        "location": {"type": "string"},
        "is_top_rated": {"type": "boolean"},
    },
}


async def _fetch_seller_profile(listing_url: str, profile_url: Optional[str]) -> dict[str, Any]:
    """Try Firecrawl /extract on the seller profile; fall back to scraping
    the listing page and regex-grepping the markdown. Returns best-effort
    structured fields — missing keys just become `None`.
    """
    target = profile_url or listing_url

    if firecrawl_is_configured():
        extracted = await fc_extract(
            url=target,
            schema=_SELLER_SCHEMA,
            prompt=(
                "Extract the seller's public profile details from this page. "
                "If a field isn't present, leave it null. Return account age "
                "in decimal years (round up partial years)."
            ),
        )
        if extracted:
            return extracted

        scraped = await fc_scrape(target, formats=["markdown"])
        if scraped and scraped.get("markdown"):
            return _heuristic_from_markdown(scraped["markdown"])

    return {}


def _heuristic_from_markdown(markdown: str) -> dict[str, Any]:
    """Very light heuristic fallback when structured extraction is unavailable."""
    out: dict[str, Any] = {}
    age_match = re.search(r"member since ([\w\s,]+\d{4})", markdown, re.IGNORECASE)
    if age_match:
        out["member_since_raw"] = age_match.group(1).strip()
    feedback_match = re.search(r"(\d{1,3}(?:\.\d)?)\s*% positive feedback", markdown, re.IGNORECASE)
    if feedback_match:
        try:
            out["positive_feedback_percent"] = float(feedback_match.group(1))
        except ValueError:
            pass
    count_match = re.search(r"\((\d{3,})\)", markdown)
    if count_match:
        try:
            out["feedback_count"] = int(count_match.group(1))
        except ValueError:
            pass
    return out


async def _image_reuse_signal(listing_url: str) -> Optional[bool]:
    """Tavily reverse-search for the listing image. If we find > 3 distinct
    domains hosting the same listing title, flag as likely stock-photo
    reuse. Conservative — false negatives preferred over false positives.
    """
    try:
        results = await tavily_search(
            query=f"site-reuse check for listing {listing_url}",
            max_results=6,
        )
    except RuntimeError:
        return None
    distinct = {urlparse(r.get("url", "")).hostname for r in results if r.get("url")}
    distinct.discard(None)
    return len(distinct) > 3


def _compute_risk_score(
    profile: dict[str, Any],
    image_reuse: Optional[bool],
) -> tuple[int, list[SellerRiskReason]]:
    """Score from 0 (pristine) to 100 (very risky). Start at 20 and move
    based on signals. Every rule explains itself so the UI can list the
    reasons verbatim.
    """
    score = 20
    reasons: list[SellerRiskReason] = []

    age = profile.get("account_age_years")
    if isinstance(age, (int, float)):
        if age < 0.25:
            score += 30
            reasons.append(SellerRiskReason(
                key="new_account",
                label=f"Seller account is {int(age * 12)} months old — very new.",
                severity="flag",
            ))
        elif age < 1:
            score += 15
            reasons.append(SellerRiskReason(
                key="young_account",
                label=f"Seller account is under a year old ({age:.1f}y).",
                severity="warn",
            ))
        else:
            reasons.append(SellerRiskReason(
                key="established_account",
                label=f"Seller account is {age:.1f} years old.",
                severity="info",
            ))
    else:
        score += 5
        reasons.append(SellerRiskReason(
            key="age_unknown",
            label="Couldn't confirm account age — judgment withheld.",
            severity="info",
        ))

    feedback = profile.get("positive_feedback_percent")
    if isinstance(feedback, (int, float)):
        if feedback < 95:
            score += 15
            reasons.append(SellerRiskReason(
                key="low_feedback",
                label=f"Positive feedback is {feedback:.1f}% — below 95% threshold.",
                severity="warn",
            ))
        else:
            reasons.append(SellerRiskReason(
                key="strong_feedback",
                label=f"Positive feedback is {feedback:.1f}%.",
                severity="info",
            ))

    count = profile.get("feedback_count")
    if isinstance(count, int):
        if count < 10:
            score += 10
            reasons.append(SellerRiskReason(
                key="few_ratings",
                label=f"Only {count} feedback ratings — limited track record.",
                severity="warn",
            ))

    if profile.get("is_top_rated"):
        score -= 15
        reasons.append(SellerRiskReason(
            key="top_rated",
            label="Top-Rated Seller badge on the profile.",
            severity="info",
        ))

    if image_reuse is True:
        score += 20
        reasons.append(SellerRiskReason(
            key="image_reuse",
            label="Listing image appears on multiple other sites — possible stock photo.",
            severity="flag",
        ))
    elif image_reuse is False:
        reasons.append(SellerRiskReason(
            key="unique_image",
            label="Listing image looks unique to this seller.",
            severity="info",
        ))

    # Clamp.
    score = max(0, min(100, score))
    return score, reasons


def _band_for_score(score: int) -> str:
    if score <= RISK_BAND_GREEN_MAX:
        return "green"
    if score <= RISK_BAND_AMBER_MAX:
        return "amber"
    return "red"


def _summary_for_band(band: str, reasons: list[SellerRiskReason]) -> str:
    flags = [r for r in reasons if r.severity == "flag"]
    if band == "green" and not flags:
        return "Looks clean — established seller, no obvious red flags."
    if band == "amber":
        return "Mixed signals — proceed, but negotiate firmly and verify the item before paying."
    if band == "red":
        return "High risk — we'd walk away unless the seller can address every flag below."
    return "Limited data — the badge below shows what we could verify."


@router.post("/extension/seller-risk", response_model=SellerRiskResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def seller_risk(
    request: Request,
    req: SellerRiskRequest,
    user_id: str = Depends(require_user_id),
):
    """Seller Risk Score — hybrid Firecrawl + Tavily.

    Auth required: each call triggers a Firecrawl + Tavily lookup that
    costs real money per invocation. Anonymous burst access was a wallet
    risk, so we gate on a real account. Plan-based limits still happen
    in the extension UI; this just prevents unauthenticated abuse.
    """
    platform = _infer_platform(req.listing_url, req.platform)
    profile_url = req.seller_profile_url or _derive_seller_profile_url(
        req.listing_url, platform,
    )

    # FB Marketplace profiles are auth-gated — we can't scrape them without
    # cookies. Return a neutral "N/A" payload so the UI can render a
    # "requires login" state instead of a misleading score.
    if platform == "facebook" and not profile_url:
        return SellerRiskResponse(
            score=50,
            band="amber",
            summary="Facebook Marketplace seller profiles require login — risk score unavailable.",
            reasons=[SellerRiskReason(
                key="fb_login_required",
                label="We can't read FB Marketplace seller profiles without a logged-in session.",
                severity="info",
            )],
            seller={"platform": "facebook"},
            data_sources=["tavily"],
        )

    profile_data = await _fetch_seller_profile(req.listing_url, profile_url)
    image_reuse = await _image_reuse_signal(req.listing_url)
    score, reasons = _compute_risk_score(profile_data, image_reuse)
    band = _band_for_score(score)

    sources: list[str] = []
    if firecrawl_is_configured():
        sources.append("firecrawl")
    if image_reuse is not None:
        sources.append("tavily")

    return SellerRiskResponse(
        score=score,
        band=band,
        summary=_summary_for_band(band, reasons),
        reasons=reasons,
        seller={
            "platform": platform,
            "profile_url": profile_url,
            **{k: v for k, v in profile_data.items() if v is not None},
        },
        data_sources=sources or ["heuristic"],
    )


# ---------------------------------------------------------------------------
# Listing Watch
# ---------------------------------------------------------------------------


async def _require_profile(db: AsyncSession, user_id: str) -> Profile:
    res = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=401, detail="Profile not found")
    return profile


def _to_iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


def _watch_to_response(watch: ListingWatch) -> ListingWatchResponse:
    return ListingWatchResponse(
        id=watch.id,
        listing_url=watch.listing_url,
        platform=watch.platform,
        status=watch.status,
        fair_high_cents=watch.fair_high_cents,
        last_known_price_cents=watch.last_known_price_cents,
        initial_risk_score=watch.initial_risk_score,
        next_check_at=_to_iso(watch.next_check_at),
        last_checked_at=_to_iso(watch.last_checked_at),
        created_at=_to_iso(watch.created_at),
    )


@router.post("/extension/listing-watch", response_model=ListingWatchResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def create_listing_watch(
    request: Request,
    req: ListingWatchCreateRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """Register a listing for stale-price watching. User-bound only —
    anonymous watches have no owner to notify.
    """
    await _require_profile(db, user_id)
    platform = _infer_platform(req.listing_url, None)
    next_check = datetime.utcnow() + WATCH_RECHECK_INTERVAL

    watch = ListingWatch(
        id=uuid4(),
        user_id=UUID(user_id),
        query_id=req.query_id,
        listing_url=req.listing_url,
        platform=platform,
        fair_high_cents=req.fair_high_cents,
        last_known_price_cents=req.last_known_price_cents,
        initial_risk_score=req.initial_risk_score,
        status="active",
        next_check_at=next_check,
    )
    db.add(watch)
    await db.commit()
    await db.refresh(watch)
    return _watch_to_response(watch)


@router.get("/extension/listing-watch", response_model=list[ListingWatchResponse])
@limiter.limit(RATE_LIMIT_HISTORY_READ)
async def list_listing_watches(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    """List the caller's active watches — used by the extension popup."""
    res = await db.execute(
        select(ListingWatch)
        .where(ListingWatch.user_id == user_id)
        .order_by(ListingWatch.created_at.desc())
        .limit(50)
    )
    return [_watch_to_response(w) for w in res.scalars().all()]


@router.delete("/extension/listing-watch/{watch_id}")
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def cancel_listing_watch(
    request: Request,
    watch_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_user_id),
):
    res = await db.execute(
        select(ListingWatch).where(ListingWatch.id == str(watch_id))
    )
    watch = res.scalar_one_or_none()
    if not watch or str(watch.user_id) != user_id:
        raise HTTPException(status_code=404, detail="Watch not found")
    watch.status = "paused"
    await db.commit()
    return {"status": "paused", "id": str(watch_id)}


# ---------------------------------------------------------------------------
# Reply Coach (conversational wrapper over /negotiate/chat)
# ---------------------------------------------------------------------------


def _tone_preamble(tone: str) -> str:
    tone = tone if tone in ALLOWED_TONES else DEFAULT_TONE
    return {
        "polite": "Reply in a warm, friendly tone — thank them and soften any pushback.",
        "firm": "Reply in a confident, no-nonsense tone. Be direct about the fair range.",
        "walk_away": (
            "Reply as a walk-away. Thank them for their time, mention the fair "
            "range one more time, and politely disengage."
        ),
        "friendly": "Reply in a natural, friendly tone.",
    }[tone]


@router.post("/extension/reply-coach", response_model=ReplyCoachResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def reply_coach(
    request: Request,
    req: ReplyCoachRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Conversational reply coach. Thin wrapper over /negotiate/chat — we
    prepend a tone directive to the user's message so the LLM adjusts
    voice without changing the upstream schema.
    """
    # Import here to avoid a circular import with the negotiate router.
    from app.routers.negotiate import negotiate_chat  # noqa: WPS433
    from app.models.schemas import NegotiationChatRequest

    tone = req.tone if req.tone in ALLOWED_TONES else DEFAULT_TONE
    user_message = req.user_message
    if user_message:
        user_message = f"[tone: {tone}] {user_message}".strip()
    elif req.seller_message:
        # When the user only pastes the seller reply, still inject tone as
        # a user-side hint so the coach knows how to respond.
        user_message = f"[tone: {tone}] {_tone_preamble(tone)}"

    chat_req = NegotiationChatRequest(
        query_id=str(req.query_id),
        session_id=req.session_id,
        seller_message=req.seller_message,
        user_message=user_message,
    )

    # Delegate — this returns a NegotiationChatResponse we can re-shape.
    chat_response = await negotiate_chat(
        request=request,
        req=chat_req,
        db=db,
        user_id=user_id,
    )

    # `chat_response` is a Pydantic model; dict() works on both v1 + v2.
    body = chat_response.model_dump() if hasattr(chat_response, "model_dump") else chat_response.dict()

    reply_text = body.get("reply") or body.get("coach_reply") or ""
    suggested = body.get("suggested_price_cents")
    messages_raw = body.get("messages") or []
    messages: list[ReplyCoachMessage] = []
    for m in messages_raw:
        messages.append(ReplyCoachMessage(
            role=m.get("role", "assistant"),
            content=m.get("content", ""),
            at=m.get("at"),
            tone=m.get("tone"),
        ))

    return ReplyCoachResponse(
        reply=reply_text,
        tone=tone,
        suggested_price_cents=suggested,
        messages=messages,
    )
