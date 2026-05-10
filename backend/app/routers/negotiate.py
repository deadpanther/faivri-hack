"""POST /api/v1/negotiate — Generate negotiation scripts + counter-offer."""

import logging
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from pydantic import BaseModel, Field, UUID4, ValidationError
from sqlalchemy.orm.attributes import flag_modified

from app.models.schemas import MAX_PRICE_SMALLEST_UNIT
from sqlalchemy import select

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.orchestrator import refresh_query_baseline
from app.models.schemas import (
    CounterOfferResponse, NegotiateRequest, NegotiateResponse,
    NegotiationChatMessage, NegotiationChatRequest, NegotiationChatResponse,
)
from app.models.db import (
    CounterOffer,
    NegotiationConversation,
    PurchaseAnalysis,
    Query as QueryModel,
)
from app.services.database import get_db
from app.services.auth import enforce_extension_auth, get_optional_user_id
from app.services.limiter import limiter, RATE_LIMIT_NEGOTIATE
from app.services.llm import (
    build_fallback_negotiation,
    continue_negotiation_chat,
    generate_counter_response,
    generate_negotiation,
)

# LIVE-P1-07: verdicts older than this get re-checked before scripts are built
# so the user isn't pitching last night's fair range to today's vendor.
STALE_VERDICT_THRESHOLD = timedelta(hours=2)

router = APIRouter()

# Anchor math is computed in Python, not the LLM. The LLM is free to write
# scripts and tactics, but it does NOT get to decide the two numbers that
# shape the whole negotiation — those come from the deterministic fair range.
#   target_price      — what the user opens with (anchor low, near fair floor)
#   walk_away_above   — the hard ceiling the user refuses to cross
NEGOTIATION_TARGET_MULTIPLIER = 1.12     # 12% above fair_low → credible anchor
NEGOTIATION_WALKAWAY_MULTIPLIER = 1.10   # 10% above fair_high → principled ceiling
# Haircut off the listing when the seller is already asking at-or-below fair.
# You never pitch *above* the listing — that would be negotiating up, not down.
NEGOTIATION_LISTING_HAIRCUT = 0.88       # 12% below listing → credible counter

# Counter-offer dedupe window. The same (query_id, counter_offer_cents) inside
# this window short-circuits the LLM call and returns the persisted response.
# Tuned to match the verdict freshness threshold so anchors don't drift under
# the cached counter-script.
COUNTER_OFFER_CACHE_TTL = timedelta(hours=2)

# Versioning for cached playbook payloads. Bump if the response shape changes
# in a way that older cached blobs would render incorrectly — the read path
# treats anything with a different version as a cache miss and regenerates.
PLAYBOOK_CACHE_VERSION = 1


def _is_stale(created_at: Optional[datetime]) -> bool:
    if created_at is None:
        return False
    return (datetime.utcnow() - created_at) > STALE_VERDICT_THRESHOLD


def _build_freshness(
    query: QueryModel, refresh_info: Optional[dict]
) -> dict:
    """Freshness block consumed by the frontend (LIVE-P1-07).

    `checked_at` is what the UI shows the user. It is:
      - the refresh timestamp when we re-ran synthesis, or
      - the original verdict time when we used stored data.
    `refreshed` tells the frontend whether to announce "prices re-checked".
    """
    if refresh_info is not None:
        return {
            "checked_at": refresh_info.get("refreshed_at"),
            "refreshed": True,
            "web_results_count": refresh_info.get("web_results_count"),
        }
    checked = query.created_at.isoformat() if query.created_at else None
    return {
        "checked_at": checked,
        "refreshed": False,
        "stale": _is_stale(query.created_at),
    }


def _compute_anchors(
    fair_low: int, fair_high: int, quoted_price: int = 0,
) -> tuple[int, int]:
    """Deterministic target / walk-away from the fair range (cents in, cents out).

    When the seller is already asking at-or-below the fair range (e.g. a used
    Marketplace listing below MSRP), the anchor is a haircut off *their*
    listing price — never above it. Otherwise the anchor is pinned to the
    fair floor. Walk-away is always capped at the listing price: if they're
    already asking less, you'd just accept rather than "walk away" above.

    Fallbacks when the range is missing or zero return (0, 0) so the caller
    can decide whether to surface the negotiation at all.
    """
    if not fair_low or not fair_high or fair_high < fair_low:
        return 0, 0
    target = int(round(fair_low * NEGOTIATION_TARGET_MULTIPLIER))
    walk_away = int(round(fair_high * NEGOTIATION_WALKAWAY_MULTIPLIER))
    if quoted_price and quoted_price > 0:
        listing_anchor = int(round(quoted_price * NEGOTIATION_LISTING_HAIRCUT))
        target = min(target, listing_anchor)
        walk_away = min(walk_away, quoted_price)
    if walk_away <= target:
        walk_away = int(round(target * 1.05))
    return target, walk_away


def _build_cached_response(
    cached: dict,
    query: QueryModel,
) -> Optional["NegotiateResponse"]:
    """Materialize a NegotiateResponse from a stored cache blob.

    Returns None if the cached blob is missing required fields or carries an
    older schema version, in which case the caller regenerates from scratch.
    """
    if not isinstance(cached, dict):
        return None
    if cached.get("version") != PLAYBOOK_CACHE_VERSION:
        return None
    scripts = cached.get("scripts")
    if not scripts or not isinstance(scripts, list):
        return None

    freshness = dict(cached.get("freshness") or {})
    # Mark the response so the frontend can label it "restored from cache" if
    # it wants to. We also re-stamp `checked_at` from the persisted verdict
    # creation time so the UI's "checked X minutes ago" stays honest.
    freshness["cached"] = True
    if query.created_at and not freshness.get("checked_at"):
        freshness["checked_at"] = query.created_at.isoformat()

    try:
        return NegotiateResponse(
            target_price=int(cached.get("target_price") or 0),
            walk_away_above=int(cached.get("walk_away_above") or 0),
            currency=cached.get("currency") or query.currency,
            scripts=scripts,
            tactics=cached.get("tactics") or [],
            evidence_summary=cached.get("evidence_summary") or "",
            quoted_price=cached.get("quoted_price"),
            domain=cached.get("domain") or query.domain or "auto",
            freshness=freshness,
        )
    except (TypeError, ValueError, ValidationError):
        return None


def _serialize_playbook_for_cache(response: "NegotiateResponse") -> dict:
    """Render the response into the JSONB blob persisted on Query."""
    return {
        "version": PLAYBOOK_CACHE_VERSION,
        "target_price": response.target_price,
        "walk_away_above": response.walk_away_above,
        "currency": response.currency,
        "scripts": response.scripts,
        "tactics": response.tactics,
        "evidence_summary": response.evidence_summary or "",
        "quoted_price": response.quoted_price,
        "domain": response.domain,
        "freshness": response.freshness or {},
        "cached_at": datetime.utcnow().isoformat(),
    }


def _authorize_query_access(query: QueryModel, user_id: Optional[str]) -> None:
    """Enforce ownership on follow-up actions against a verdict.

    Rules:
    - A row with an owner (`query.user_id`) is accessible only to that owner.
      Callers without auth or with a mismatched profile UUID get 404 — same
      shape as "doesn't exist" so we don't leak which IDs are real.
    - A row without an owner is a shared handle. The anonymous caller already
      got the verdict inline from /analyze, so letting the same ID produce
      scripts doesn't expose anything new. (Signed-in users whose /analyze
      request raced the AuthTokenBridge mount also land here and would
      otherwise see a false "Query not found" on their own verdict.)

    Both IDs are normalized to str before comparison because the auth dep
    returns a str (`str(profile.id)`) while SQLAlchemy hands back a uuid.UUID
    from the column — a raw `!=` between those never matches even for the owner.
    """
    if query.user_id is None:
        return
    if not user_id or str(user_id) != str(query.user_id):
        raise HTTPException(status_code=404, detail="Query not found")


@router.post("/negotiate", response_model=NegotiateResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def negotiate(
    request: Request,
    req: NegotiateRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Generate negotiation script for a given verdict."""
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(req.query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    _authorize_query_access(query, user_id)

    # Cache short-circuit. We persist the fully-rendered playbook on the Query
    # row after the first successful generation; subsequent calls return that
    # blob verbatim instead of paying for another LLM round-trip. We only
    # honor the cache when the verdict itself is still fresh — staleness
    # triggers a baseline refresh below, and refreshed anchors invalidate
    # the script we previously built.
    if not _is_stale(query.created_at):
        cached_response = _build_cached_response(
            query.negotiation_script or {}, query,
        )
        if cached_response is not None:
            return cached_response

    # LIVE-P1-07: re-check live prices if the verdict is stale before scripts
    # get built. Failure falls back to the original numbers — better to coach
    # with slightly-old data than to 5xx the user out of a working feature.
    refresh_info: Optional[dict] = None
    if _is_stale(query.created_at):
        try:
            refresh_info = await refresh_query_baseline(db, query)
        except Exception:
            logger.warning(
                "Stale-refresh failed for query %s; coaching on original verdict",
                req.query_id,
            )

    # `sources_used` now stores the evidence dict from the evidence-first pipeline.
    # Pull the per-source records so the negotiation LLM cites real domains, not
    # generic "average price" claims.
    evidence_blob = query.sources_used or {}
    evidence_sources = (
        evidence_blob.get("sources")
        if isinstance(evidence_blob, dict) else []
    ) or []

    fair_low = query.fair_price_low or 0
    fair_high = query.fair_price_high or 0
    fair_mid = (fair_low + fair_high) // 2 if (fair_low and fair_high) else 0
    conservative_overpay = (
        max(0, (query.quoted_price or 0) - fair_high)
        if query.quoted_price and fair_high else 0
    )
    expected_overpay = (
        max(0, (query.quoted_price or 0) - fair_mid)
        if query.quoted_price and fair_mid else 0
    )
    target_price, walk_away_above = _compute_anchors(
        fair_low, fair_high, query.quoted_price or 0,
    )

    verdict_data = {
        "verdict": query.verdict,
        "overcharge_multiplier": float(query.overcharge_multiplier or 1.0),
        "fair_price_low": fair_low,
        "fair_price_mid": fair_mid,
        "fair_price_high": fair_high,
        "conservative_overpay": conservative_overpay,
        "expected_overpay": expected_overpay,
        "quoted_price": query.quoted_price,
        "red_flags": query.red_flags or [],
        "questions_to_ask": query.questions_to_ask or [],
        "explanation": query.explanation or "",
        "domain": query.domain or "auto",
        "data_points_count": query.data_points_count or 0,
        "evidence_sources": evidence_sources,
        # Pre-computed anchors. The LLM must script around these; the router
        # overrides the final response regardless of what the LLM returns.
        "target_price": target_price,
        "walk_away_above": walk_away_above,
    }

    # Retry + deterministic fallback. Previously a single flaky LLM call
    # would either 500 or 502 and the extension's playbook never rendered.
    # Now we try twice, then serve the deterministic fallback so users always
    # get actionable scripts even during provider hiccups.
    negotiation: dict = {}
    last_exc: Optional[Exception] = None
    for attempt in range(2):
        try:
            negotiation = await generate_negotiation(
                query_text=query.input_text,
                verdict_data=verdict_data,
                currency=query.currency,
            )
            if isinstance(negotiation, dict) and negotiation.get("scripts"):
                break
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Negotiation LLM attempt %d failed for query %s: %s",
                attempt + 1, req.query_id, exc,
            )

    scripts = (negotiation or {}).get("scripts") or []
    used_fallback = False
    if not scripts:
        if last_exc is not None:
            logger.exception(
                "Negotiation generation failed for query %s; serving fallback",
                req.query_id, exc_info=last_exc,
            )
        else:
            logger.warning(
                "Negotiation returned empty scripts for query %s; serving fallback",
                req.query_id,
            )
        negotiation = build_fallback_negotiation(verdict_data)
        scripts = negotiation["scripts"]
        used_fallback = True

    freshness = _build_freshness(query, refresh_info)
    if used_fallback:
        freshness["fallback"] = True
    response = NegotiateResponse(
        # Deterministic anchors override whatever the LLM returned.
        target_price=target_price,
        walk_away_above=walk_away_above,
        currency=query.currency,
        scripts=scripts,
        tactics=negotiation.get("tactics", []),
        evidence_summary=negotiation.get("evidence_summary", ""),
        quoted_price=query.quoted_price,
        domain=query.domain or "auto",
        freshness=freshness,
    )

    # Persist the fully-rendered playbook so a follow-up call hits the cache
    # short-circuit at the top of this handler. We skip caching the
    # deterministic fallback — those are placeholder scripts emitted when
    # the LLM provider fails, not material we want pinned to the row.
    if not used_fallback:
        try:
            query.negotiation_script = _serialize_playbook_for_cache(response)
            flag_modified(query, "negotiation_script")
            await db.commit()
        except Exception:
            logger.exception(
                "Failed to persist playbook cache for query %s; serving "
                "uncached response", req.query_id,
            )
            await db.rollback()

    return response


class CounterOfferRequest(BaseModel):
    query_id: UUID4
    counter_offer: int = Field(..., ge=0, le=MAX_PRICE_SMALLEST_UNIT)
    original_target: int = Field(..., ge=0, le=MAX_PRICE_SMALLEST_UNIT)


@router.post("/negotiate/counter", response_model=CounterOfferResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def counter_offer(
    request: Request,
    req: CounterOfferRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Generate a response to a vendor's counter-offer.

    Persists every counter-offer to the `counter_offers` table so the verdict
    page can render the negotiation transcript, and short-circuits to the
    cached payload when the same number is re-submitted inside
    COUNTER_OFFER_CACHE_TTL — without that dedupe, double-clicks and "let me
    try $X again" repeats would each pay for a fresh LLM call.
    """
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(req.query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    _authorize_query_access(query, user_id)

    # Cache lookup. We key on (query_id, counter_offer_cents) and accept any
    # row newer than the TTL — the actual response_payload is what we return,
    # so even if `original_target` changes between calls the LLM-grade reply
    # is still valid for the same hypothetical counter.
    cache_cutoff = datetime.utcnow() - COUNTER_OFFER_CACHE_TTL
    cached_result = await db.execute(
        select(CounterOffer)
        .where(
            CounterOffer.query_id == req.query_id,
            CounterOffer.counter_offer_cents == req.counter_offer,
            CounterOffer.created_at >= cache_cutoff,
        )
        .order_by(CounterOffer.created_at.desc())
        .limit(1)
    )
    cached_row = cached_result.scalar_one_or_none()
    if cached_row is not None:
        try:
            return CounterOfferResponse.model_validate(cached_row.response_payload)
        except ValidationError:
            # Persisted blob no longer matches the response shape (schema
            # drift). Fall through and regenerate; the new row replaces the
            # stale one for future cache hits.
            logger.warning(
                "Cached counter-offer payload failed validation for query %s; "
                "regenerating", req.query_id,
            )

    verdict_data = {
        "fair_price_low": query.fair_price_low,
        "fair_price_high": query.fair_price_high,
    }

    original_negotiation = {
        "target_price": req.original_target,
    }

    try:
        raw = await generate_counter_response(
            query_text=query.input_text,
            verdict_data=verdict_data,
            counter_offer=req.counter_offer,
            original_negotiation=original_negotiation,
            currency=query.currency,
        )
    except Exception:
        logger.exception("Counter-offer analysis failed for query %s", req.query_id)
        raise HTTPException(status_code=500, detail="Counter-offer analysis failed. Please try again.")

    # API-P1-03: the LLM sometimes drops `suggested_counter` or returns a null
    # `response_script`. Previously we forwarded the raw dict and the frontend
    # printed `$NaN`. Pydantic validates the contract before we reply.
    try:
        response = CounterOfferResponse.model_validate(raw)
    except ValidationError as exc:
        logger.warning(
            "Counter-offer LLM response failed validation for query %s: %s",
            req.query_id, exc.errors(),
        )
        raise HTTPException(
            status_code=502,
            detail="Counter-offer analysis returned an incomplete response. Please retry.",
        )

    # Persist the validated response. We store the model_dump so any future
    # field additions to CounterOfferResponse continue to deserialize cleanly.
    try:
        db.add(CounterOffer(
            user_id=query.user_id,
            query_id=query.id,
            counter_offer_cents=req.counter_offer,
            original_target_cents=req.original_target,
            response_payload=response.model_dump(),
        ))
        await db.commit()
    except Exception:
        logger.exception(
            "Failed to persist counter-offer for query %s; serving response "
            "without history row", req.query_id,
        )
        await db.rollback()

    return response


# Max turns we keep in the persisted transcript. Older turns are trimmed so
# the JSONB column + the LLM prompt stay bounded — users can still see them
# client-side if they held the UI open.
_CHAT_HISTORY_CAP = 50


def _messages_to_schema(raw: list) -> list[NegotiationChatMessage]:
    """Coerce a persisted JSONB messages array into the response schema.

    Tolerates legacy rows that might be missing `at` or have mixed casing on
    the role; anything unparseable is skipped rather than 500'ing the fetch.
    """
    out: list[NegotiationChatMessage] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").lower()
        # Legacy rows persisted seller messages as role="assistant"; remap
        # them to "seller" so the UI doesn't conflate seller turns with the
        # AI coach's replies. assistant_coach is the coach's persisted role.
        if role == "assistant_coach":
            role = "assistant"
        if role not in ("user", "seller", "assistant"):
            continue
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        out.append(NegotiationChatMessage(
            role=role, content=content, at=item.get("at"),
        ))
    return out


@router.post("/negotiate/chat", response_model=NegotiationChatResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def negotiate_chat(
    request: Request,
    req: NegotiationChatRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Conversational negotiation coach (overnight launch feature).

    Lives alongside /negotiate; /negotiate gives the opening playbook, /chat
    continues the back-and-forth after the user hears from the seller. State
    persists per (query_id, session_id) so the same conversation can be
    resumed from the extension or the web app.
    """
    if not req.seller_message and not req.user_message:
        raise HTTPException(
            status_code=400,
            detail="Send at least one of `seller_message` or `user_message`.",
        )

    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(req.query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")
    _authorize_query_access(query, user_id)

    # Load or create the conversation row. Unique index on (query_id, session_id)
    # guarantees we always act on the same conversation thread — two
    # simultaneous requests from the extension would otherwise race to insert.
    conv_result = await db.execute(
        select(NegotiationConversation).where(
            NegotiationConversation.query_id == req.query_id,
            NegotiationConversation.session_id == req.session_id,
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        conversation = NegotiationConversation(
            user_id=query.user_id,
            query_id=query.id,
            session_id=req.session_id,
            messages=[],
        )
        db.add(conversation)
        await db.flush()

    history: list[dict] = list(conversation.messages or [])

    # Persist whatever the caller sent before asking the LLM so we don't lose
    # a turn if the model call dies mid-flight.
    now_iso = datetime.utcnow().isoformat()
    if req.seller_message:
        history.append({
            "role": "seller",
            "content": req.seller_message.strip(),
            "at": now_iso,
        })
    if req.user_message:
        history.append({
            "role": "user",
            "content": req.user_message.strip(),
            "at": now_iso,
        })

    fair_low = query.fair_price_low or 0
    fair_high = query.fair_price_high or 0
    fair_mid = (fair_low + fair_high) // 2 if (fair_low and fair_high) else 0
    target_price, walk_away_above = _compute_anchors(
        fair_low, fair_high, query.quoted_price or 0,
    )
    verdict_data = {
        "verdict": query.verdict,
        "overcharge_multiplier": float(query.overcharge_multiplier or 1.0),
        "fair_price_low": fair_low,
        "fair_price_mid": fair_mid,
        "fair_price_high": fair_high,
        "quoted_price": query.quoted_price,
        "target_price": target_price,
        "walk_away_above": walk_away_above,
        "domain": query.domain or "retail",
    }

    try:
        coach = await continue_negotiation_chat(
            query_text=query.input_text,
            verdict_data=verdict_data,
            history=history,
            seller_message=req.seller_message,
            user_message=req.user_message,
            currency=query.currency,
        )
    except Exception:
        logger.exception(
            "Chat LLM failed for query=%s session=%s; persisting fallback reply",
            req.query_id, req.session_id,
        )
        coach = {
            "reply": (
                f"Thanks for the message — let me get back to you with a number "
                f"in a few minutes."
            ),
            "suggested_price_cents": target_price or None,
            "should_accept": False,
            "tone": "friendly",
        }

    reply_text = (coach.get("reply") or "").strip()
    if not reply_text:
        reply_text = "Thanks — let me think on that and get back to you shortly."
    history.append({
        "role": "assistant_coach",  # coach's suggestion, NOT the seller
        "content": reply_text,
        "at": datetime.utcnow().isoformat(),
        "suggested_price_cents": coach.get("suggested_price_cents"),
        "tone": coach.get("tone"),
    })

    # Trim to bounded history so the JSONB column doesn't grow unbounded and
    # the next LLM prompt stays inside the context window.
    if len(history) > _CHAT_HISTORY_CAP:
        history = history[-_CHAT_HISTORY_CAP:]

    conversation.messages = history
    if coach.get("suggested_price_cents") is not None:
        try:
            conversation.last_suggested_price = int(coach["suggested_price_cents"])
        except (TypeError, ValueError):
            pass
    await db.commit()

    # Storage roles → API roles:
    #   user            → user      (buyer)
    #   seller          → seller    (counterparty, new convention)
    #   assistant       → seller    (legacy; we never wrote coach as
    #                                "assistant", only "assistant_coach")
    #   assistant_coach → assistant (the AI coach's reply)
    visible: list[NegotiationChatMessage] = []
    for item in history:
        role = item.get("role")
        if role == "assistant_coach":
            api_role = "assistant"
        elif role == "assistant":
            api_role = "seller"
        elif role in ("user", "seller"):
            api_role = role
        else:
            continue
        visible.append(NegotiationChatMessage(
            role=api_role,
            content=item.get("content", ""),
            at=item.get("at"),
        ))

    return NegotiationChatResponse(
        reply=reply_text,
        suggested_price_cents=coach.get("suggested_price_cents"),
        should_accept=bool(coach.get("should_accept")),
        tone=coach.get("tone") or "friendly",
        session_id=req.session_id,
        messages=visible,
    )


class NegotiationChatHistoryResponse(BaseModel):
    session_id: str
    messages: list[NegotiationChatMessage]
    last_suggested_price: Optional[int] = None


@router.get(
    "/negotiate/chat/{query_id}/{session_id}",
    response_model=NegotiationChatHistoryResponse,
)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def get_chat_history(
    request: Request,
    query_id: UUID,
    session_id: str = Path(..., min_length=6, max_length=128),
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Return the persisted chat transcript for a (query, session) pair.

    Authorization mirrors /negotiate — owner-only for owned verdicts, shared
    handle for anonymous verdicts. Returning an empty messages array instead
    of 404 when the conversation hasn't started keeps the extension UI simple.
    """
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")
    _authorize_query_access(query, user_id)

    conv_result = await db.execute(
        select(NegotiationConversation).where(
            NegotiationConversation.query_id == str(query_id),
            NegotiationConversation.session_id == session_id,
        )
    )
    conversation = conv_result.scalar_one_or_none()
    if conversation is None:
        return NegotiationChatHistoryResponse(
            session_id=session_id, messages=[], last_suggested_price=None,
        )

    visible: list[NegotiationChatMessage] = []
    for item in conversation.messages or []:
        role = item.get("role")
        if role == "assistant_coach":
            api_role = "assistant"
        elif role == "assistant":
            api_role = "seller"  # legacy — see chat handler comment
        elif role in ("user", "seller"):
            api_role = role
        else:
            continue
        visible.append(NegotiationChatMessage(
            role=api_role,
            content=item.get("content", ""),
            at=item.get("at"),
        ))

    return NegotiationChatHistoryResponse(
        session_id=session_id,
        messages=visible,
        last_suggested_price=conversation.last_suggested_price,
    )


class CounterOfferHistoryItem(BaseModel):
    counter_offer_cents: int
    original_target_cents: int
    response: CounterOfferResponse
    created_at: datetime


class CounterOfferHistoryResponse(BaseModel):
    query_id: UUID4
    items: list[CounterOfferHistoryItem]


@router.get(
    "/negotiate/counters/{query_id}",
    response_model=CounterOfferHistoryResponse,
)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def get_counter_history(
    request: Request,
    query_id: UUID,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Return all persisted counter-offers for a query, newest first.

    Authorization mirrors /negotiate — owner-only for owned verdicts, shared
    handle for anonymous verdicts. Empty list (not 404) when nothing has been
    submitted yet, so the frontend can render the section without branching.
    """
    result = await db.execute(
        select(QueryModel).where(QueryModel.id == str(query_id))
    )
    query = result.scalar_one_or_none()
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")
    _authorize_query_access(query, user_id)

    rows_result = await db.execute(
        select(CounterOffer)
        .where(CounterOffer.query_id == str(query_id))
        .order_by(CounterOffer.created_at.desc())
        .limit(50)
    )
    rows = rows_result.scalars().all()

    items: list[CounterOfferHistoryItem] = []
    for row in rows:
        try:
            payload = CounterOfferResponse.model_validate(row.response_payload)
        except ValidationError:
            # Tolerate schema drift on read — skip rather than 500.
            continue
        items.append(CounterOfferHistoryItem(
            counter_offer_cents=row.counter_offer_cents,
            original_target_cents=row.original_target_cents,
            response=payload,
            created_at=row.created_at,
        ))

    return CounterOfferHistoryResponse(query_id=query_id, items=items)


# ─────────────────────────────────────────────────────────────────────────────
# /negotiate/purchase-chat — live negotiation coach for used-car analyses.
#
# Mirrors /negotiate/chat but keyed on a `purchase_analyses.id` (not a Query).
# Stateless on the server side: the caller passes the prior `messages` array
# verbatim every turn (persisted client-side in localStorage). Deferring DB
# persistence keeps this overnight-launch shippable without a second migration
# — chat history survives page refresh in the same browser, which covers the
# demo path; cross-device replay can be a follow-up.
# ─────────────────────────────────────────────────────────────────────────────


class PurchaseChatTurn(BaseModel):
    """One persisted turn in the car-side coach. Roles map to /negotiate/chat:
    `user` = buyer (the customer), `seller` = counterparty's quoted message,
    `assistant` = the AI coach's reply.
    """
    role: str = Field(..., pattern="^(user|seller|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)
    at: Optional[str] = None
    suggested_price_cents: Optional[int] = None
    tone: Optional[str] = None


class PurchaseChatRequest(BaseModel):
    purchase_id: UUID4
    history: list[PurchaseChatTurn] = Field(default_factory=list, max_length=64)
    seller_message: Optional[str] = Field(None, max_length=2000)
    user_message: Optional[str] = Field(None, max_length=2000)


class PurchaseChatResponse(BaseModel):
    reply: str
    suggested_price_cents: Optional[int] = None
    should_accept: bool = False
    tone: Optional[str] = None
    next_move_hint: Optional[str] = None


def _purchase_authorize(row: PurchaseAnalysis, user_id: Optional[str]) -> None:
    """Mirror of `_authorize_query_access` for purchase rows.

    Anonymous purchase analyses (user_id IS NULL) act as shared handles — the
    UUID is the capability. Owned rows require the same Clerk profile that
    created them.
    """
    if row.user_id is None:
        return
    if not user_id or str(user_id) != str(row.user_id):
        raise HTTPException(status_code=404, detail="Analysis not found")


def _purchase_to_verdict_data(row: PurchaseAnalysis) -> tuple[dict, str]:
    """Project a PurchaseAnalysis into the verdict_data dict shape the chat LLM
    helper expects, plus a `query_text` describing the listing in one line.

    The car payload uses different keys (`fair_price_range`, `adjusted_pricing`)
    than the general verdict (`fair_price_low/high`, `target_price`,
    `walk_away_above`), so the mapping here is the contract between the two
    sides — keep it tight.
    """
    payload = row.payload or {}
    fair_range = payload.get("fair_price_range") or {}
    adjusted = payload.get("adjusted_pricing") or {}
    fair_low = int(fair_range.get("low") or 0)
    fair_high = int(fair_range.get("high") or 0)
    fair_mid = (fair_low + fair_high) // 2 if fair_low and fair_high else 0
    target = int(adjusted.get("target_offer") or 0) or int(round(fair_low * 1.02)) if fair_low else 0
    walk_away = int(adjusted.get("walk_away_above") or 0) or int(round(fair_high * 1.05)) if fair_high else 0

    verdict_data = {
        "verdict": payload.get("asking_price_verdict") or "high",
        "overcharge_multiplier": float(payload.get("overcharge_multiplier") or 1.0),
        "fair_price_low": fair_low,
        "fair_price_mid": fair_mid,
        "fair_price_high": fair_high,
        "quoted_price": int(row.asking_price or 0),
        "target_price": target,
        "walk_away_above": walk_away,
        "domain": "used_cars",
    }
    query_text = (
        f"{row.year} {row.make} {row.model} · "
        f"{row.mileage_km or 0:,} km · "
        f"asking ${(row.asking_price or 0)/100:,.0f}"
    )
    return verdict_data, query_text


@router.post("/negotiate/purchase-chat", response_model=PurchaseChatResponse)
@limiter.limit(RATE_LIMIT_NEGOTIATE)
async def negotiate_purchase_chat(
    request: Request,
    req: PurchaseChatRequest,
    db: AsyncSession = Depends(get_db),
    user_id: Optional[str] = Depends(enforce_extension_auth),
):
    """Conversational negotiation coach for /result/purchase/[slug].

    Takes the latest seller / user message plus the full prior history and
    returns ONE coaching turn — the next message the buyer should send, the
    price to offer, and whether to accept. Anchored on the deterministic
    fair range stored on the PurchaseAnalysis row so the LLM can't drift
    into "just pay sticker".
    """
    if not req.seller_message and not req.user_message:
        raise HTTPException(
            status_code=400,
            detail="Send at least one of `seller_message` or `user_message`.",
        )

    result = await db.execute(
        select(PurchaseAnalysis).where(PurchaseAnalysis.id == req.purchase_id)
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    _purchase_authorize(row, user_id)

    verdict_data, query_text = _purchase_to_verdict_data(row)

    # Convert client history into the [{role, content, at}] dicts the LLM
    # helper consumes. assistant_coach is the legacy persisted name; the API
    # uses "assistant" for the coach's reply, which the helper maps to its
    # SELLER label — we want it labeled YOU (the user) in the prompt because
    # the coach's prior messages ARE the user's prior outgoing texts. Hence
    # the deliberate role flip below.
    history_for_llm: list[dict] = []
    for turn in req.history:
        # In our purchase-chat convention:
        #   user        → "what the buyer typed in their own words" (rare; coach drives)
        #   seller      → counterparty
        #   assistant   → coach-generated reply that the buyer sent
        # The LLM helper labels role=="assistant" as SELLER, so map our
        # assistant turns into role="user" (buyer side) for the prompt.
        if turn.role == "assistant":
            history_for_llm.append({"role": "user", "content": turn.content})
        elif turn.role == "seller":
            history_for_llm.append({"role": "assistant", "content": turn.content})
        else:
            history_for_llm.append({"role": "user", "content": turn.content})

    try:
        coach = await continue_negotiation_chat(
            query_text=query_text,
            verdict_data=verdict_data,
            history=history_for_llm,
            seller_message=req.seller_message,
            user_message=req.user_message,
            currency="USD",
        )
    except Exception:
        logger.exception(
            "Purchase chat LLM failed for analysis=%s; serving fallback reply",
            req.purchase_id,
        )
        coach = {
            "reply": (
                "Thanks for the message — let me check a few comps and get "
                "back to you in a bit."
            ),
            "suggested_price_cents": verdict_data.get("target_price"),
            "should_accept": False,
            "tone": "friendly",
            "next_move_hint": "Buy time while you re-anchor on the fair range.",
        }

    reply_text = (coach.get("reply") or "").strip()
    if not reply_text:
        reply_text = "Thanks — let me think on that and get back to you shortly."

    return PurchaseChatResponse(
        reply=reply_text,
        suggested_price_cents=coach.get("suggested_price_cents"),
        should_accept=bool(coach.get("should_accept")),
        tone=coach.get("tone") or "friendly",
        next_move_hint=coach.get("next_move_hint"),
    )
