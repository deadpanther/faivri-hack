"""POST /api/v1/analyze — Core analysis endpoints (text, image, voice, purchase)."""

import base64
import logging
import uuid
from datetime import datetime

import anthropic
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import PurchaseAnalysis
from app.models.schemas import AnalyzeRequest, VerdictResponse
from app.services.anonymous_cap import (
    AnonymousCapExceeded,
    enforce as enforce_anon_cap,
    fingerprint as anon_fingerprint,
)
from app.services.auth import enforce_extension_auth, get_optional_user_id
from app.services.database import get_db
from app.services.limiter import limiter, RATE_LIMIT_ANALYZE
from app.services.net import client_ip
from app.services.llm import analyze_image as vision_analyze_image, extract_from_image, transcribe_audio
from app.services.llm import _parse_json
from app.services.market import (
    DEFAULT_COUNTRY,
    enforce_supported_country,
    is_supported_country,
)
from app.services.quota import QuotaExhausted, check as quota_check, consume as quota_consume
from app.intelligence.orchestrator import process_query

logger = logging.getLogger(__name__)

MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_AUDIO_SIZE = 15 * 1024 * 1024  # 15 MB — covers a minute of 24 kHz WAV
ALLOWED_IMAGE_MIME = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
}
# OpenAI Whisper's supported formats. Anything else is a fast reject —
# audio/webm defaults to Opus which Whisper handles via the shim.
ALLOWED_AUDIO_MIME = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/mp3",
    "audio/wav", "audio/x-wav", "audio/flac", "audio/m4a",
    # Safari sometimes posts audio blobs without a content-type; the router
    # allows an empty string through as a best-effort and hands Whisper the
    # filename hint so it can sniff the container.
    "", "application/octet-stream",
}

router = APIRouter()


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


async def _enforce_analyze_quota(
    request: Request, db: AsyncSession, user_id: str | None
) -> None:
    """Gate every /analyze entry point on quota before running the pipeline.

    - Anonymous: Redis daily cap per IP (429 over cap).
    - Signed-in: plan-based monthly quota (402 over cap).

    Pipeline authors call this exactly once, and (on success) `consume` is
    called from `_build_verdict_response` to tick the monthly counter.
    """
    if user_id is None:
        try:
            fp = anon_fingerprint(
                request.headers.get("user-agent"),
                request.headers.get("accept-language"),
                request.headers.get("accept-encoding"),
            )
            await enforce_anon_cap(client_ip(request), fp=fp)
        except AnonymousCapExceeded as exc:
            raise HTTPException(
                status_code=429,
                detail={
                    "message": (
                        f"Daily anonymous limit ({exc.cap}) reached. "
                        "Sign in to unlock more analyses."
                    ),
                    "cap": exc.cap,
                },
            )
        return

    try:
        await quota_check(db, user_id)
    except QuotaExhausted as exc:
        from app.config import settings as _settings
        raise HTTPException(
            status_code=402,
            detail={
                "message": (
                    f"You've used all {exc.limit} analyses on your {exc.plan} plan "
                    "this month. Grab a Boost Pack or upgrade to keep going."
                ),
                "plan": exc.plan,
                "limit": exc.limit,
                "reset_at": exc.reset_at.isoformat() if exc.reset_at else None,
                "boost_credits": exc.boost_credits,
                "boost": {
                    "credits_per_pack": _settings.boost_pack_credits,
                    "price_cents": _settings.boost_pack_price_cents,
                    "checkout_url": _settings.lemonsqueezy_boost_checkout_url or None,
                },
            },
        )


def _validate_country_or_400(country: str | None) -> str:
    """LIVE-P1-08: reject non-US country input at the API boundary.

    `None`/empty is allowed — the classifier will infer US downstream. A
    non-empty *unsupported* code is the user asking for a market we don't
    cover, so we fail fast with 400 rather than silently processing against
    US prices.
    """
    if not country:
        return DEFAULT_COUNTRY
    try:
        return enforce_supported_country(country)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _build_verdict_response(result: dict) -> VerdictResponse:
    return VerdictResponse(
        id=result["id"],
        verdict=result["verdict"],
        overcharge_multiplier=result["overcharge_multiplier"],
        fair_price_low=result["fair_price_low"],
        fair_price_mid=result.get("fair_price_mid", 0),
        fair_price_high=result["fair_price_high"],
        conservative_overpay=result.get("conservative_overpay", 0),
        expected_overpay=result.get("expected_overpay", 0),
        currency=result["currency"],
        confidence_score=result["confidence_score"],
        data_points_count=result["data_points_count"],
        explanation=result["explanation"],
        red_flags=result["red_flags"],
        questions_to_ask=result["questions_to_ask"],
        sources=result.get("sources", {}),
        evidence=result.get("evidence"),
        domain=result["domain"],
        location_city=result["location_city"],
        location_country=result["location_country"],
        quoted_price=result.get("quoted_price"),
        freshness=result.get("freshness"),
    )


@router.post("/analyze", response_model=VerdictResponse)
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze(
    request: Request,
    req: AnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a consumer price query (text input).

    Location is resolved in this priority:
    1. lat/lng → S2 geohash + reverse-geocode (silent, automatic)
    2. city/country from request (if explicitly provided)
    3. LLM classifier extracts from query text ("in Pune" → city=Pune, country=IN)
    """
    await _enforce_analyze_quota(request, db, user_id)

    city = req.city
    country = _validate_country_or_400(req.country)
    s2_token = None

    # Auto-resolve location from lat/lng via S2
    if req.lat is not None and req.lng is not None:
        from app.services.geo import lat_lng_to_s2_token, reverse_geocode
        s2_token = lat_lng_to_s2_token(req.lat, req.lng)
        if not city or not req.country:
            geo = await reverse_geocode(req.lat, req.lng)
            city = city or geo["city"]
            # Reverse-geocoded country only overrides when we don't have a
            # validated value from the request. If the browser resolves to a
            # non-supported country, drop the hint and let the pipeline
            # default to US rather than 400-ing a valid US query.
            if not req.country and is_supported_country(geo["country_code"]):
                country = enforce_supported_country(geo["country_code"])

    try:
        result = await process_query(
            db=db,
            query_text=req.query,
            city=city,
            country=country,
            domain=req.domain,
            quoted_price=req.quoted_price,
            provider=req.provider,
            s2_token=s2_token,
            user_id=user_id,
        )
        if user_id:
            await quota_consume(db, user_id)
        return _build_verdict_response(result)
    except (RuntimeError, ValueError) as e:
        logger.error("Analysis pipeline error [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        # Never log the raw query — it may contain PII (medical, legal, or
        # personal context the user typed). The traceback plus request_id is
        # enough to debug without persisting the user's text to log storage.
        logger.exception(
            "Analysis failed [request_id=%s] domain=%s country=%s",
            _request_id(request), req.domain, country,
        )
        raise HTTPException(status_code=500, detail="Analysis failed. Please try again.")


@router.post("/analyze/image", response_model=VerdictResponse)
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_image(
    request: Request,
    image: UploadFile = File(...),
    city: str = Form(None),
    country: str = Form(None),
    lat: float = Form(None),
    lng: float = Form(None),
    provider: str = Form("openai"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a bill/invoice/receipt image."""
    await _enforce_analyze_quota(request, db, user_id)
    raw_country = country
    country = _validate_country_or_400(country)
    s2_token = None
    if lat is not None and lng is not None:
        from app.services.geo import lat_lng_to_s2_token, reverse_geocode
        s2_token = lat_lng_to_s2_token(lat, lng)
        if not city:
            geo = await reverse_geocode(lat, lng)
            city = geo["city"]
            if not raw_country and is_supported_country(geo["country_code"]):
                country = enforce_supported_country(geo["country_code"])

    try:
        mime = (image.content_type or "").lower().split(";")[0].strip()
        if mime and mime not in ALLOWED_IMAGE_MIME:
            # Reject instead of silently coercing to JPEG — SVG / HEIC /
            # PDF-disguised-as-image all end up here, and the vision API
            # will either reject or hallucinate on them.
            raise HTTPException(
                status_code=415,
                detail="Unsupported image type. Use JPG, PNG, WEBP, or GIF.",
            )
        image_bytes = await image.read()
        if len(image_bytes) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 10 MB.")
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        # Anthropic rejects media-type mismatches between declared and actual
        # bytes, so forward whatever the browser uploaded (defaults to JPEG).
        media_type = mime or "image/jpeg"
        extracted_text = await extract_from_image(
            image_b64, provider=provider, media_type=media_type,
        )
        result = await process_query(
            db=db,
            query_text=extracted_text,
            city=city,
            country=country,
            provider=provider,
            s2_token=s2_token,
            user_id=user_id,
        )
        if user_id:
            await quota_consume(db, user_id)
        return _build_verdict_response(result)
    except (RuntimeError, ValueError) as e:
        logger.error("Image analysis error [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except anthropic.BadRequestError as e:
        # Vision endpoint rejected the image (too small, corrupt, unsupported
        # format). Surface a user-actionable 400 instead of the generic 500.
        logger.warning("Vision rejected image [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(
            status_code=400,
            detail="We couldn't read that image. Try a clearer photo of the bill or invoice.",
        )
    except Exception:
        logger.exception("Image analysis failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Image analysis failed. Please try again.")


@router.post("/analyze/voice", response_model=VerdictResponse)
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_voice(
    request: Request,
    audio: UploadFile = File(...),
    city: str = Form(None),
    country: str = Form(None),
    lat: float = Form(None),
    lng: float = Form(None),
    provider: str = Form("openai"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a voice recording (transcribe then analyze)."""
    await _enforce_analyze_quota(request, db, user_id)
    raw_country = country
    country = _validate_country_or_400(country)
    s2_token = None
    if lat is not None and lng is not None:
        from app.services.geo import lat_lng_to_s2_token, reverse_geocode
        s2_token = lat_lng_to_s2_token(lat, lng)
        if not city:
            geo = await reverse_geocode(lat, lng)
            city = geo["city"]
            if not raw_country and is_supported_country(geo["country_code"]):
                country = enforce_supported_country(geo["country_code"])

    try:
        mime = (audio.content_type or "").lower().split(";")[0].strip()
        if mime not in ALLOWED_AUDIO_MIME:
            raise HTTPException(
                status_code=415,
                detail="Unsupported audio type. Record from the web app or extension.",
            )
        audio_bytes = await audio.read()
        if len(audio_bytes) > MAX_AUDIO_SIZE:
            raise HTTPException(
                status_code=413,
                detail="Recording too long. Keep clips under 60 seconds.",
            )
        transcript = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
        result = await process_query(
            db=db,
            query_text=transcript,
            city=city,
            country=country,
            provider=provider,
            s2_token=s2_token,
            user_id=user_id,
        )
        if user_id:
            await quota_consume(db, user_id)
        return _build_verdict_response(result)
    except (RuntimeError, ValueError) as e:
        logger.error("Voice analysis error [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Voice analysis failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Voice analysis failed. Please try again.")


@router.get("/providers")
async def get_providers():
    """Return available LLM providers and current default."""
    from app.config import settings
    return {
        "default": settings.default_provider,
        "available": [
            {"id": "openai", "name": "OpenAI GPT-4o", "available": bool(settings.openai_api_key)},
            {"id": "anthropic", "name": "Anthropic Claude", "available": bool(settings.anthropic_api_key)},
        ],
    }


def _coerce_profile_uuid(user_id: str | None) -> uuid.UUID | None:
    """The auth dependency hands back the Clerk `sub` (e.g. `user_abc123`),
    but `profiles.id` is a UUID. Until the codebase-wide sub→UUID lookup
    lands, we only persist `user_id` when it's already a UUID; otherwise
    the row is recorded as anonymous. Keeps the endpoint from crashing on
    a signed-in request while still attributing any UUID-shaped callers.
    """
    if not user_id:
        return None
    try:
        return uuid.UUID(user_id)
    except ValueError:
        return None


async def _persist_purchase_analysis(
    db: AsyncSession,
    *,
    user_id: str | None,
    make: str,
    model: str,
    year: int,
    mileage_km: int,
    asking_price: int,
    city: str | None,
    country: str | None,
    result: dict,
    vin: str | None = None,
) -> str:
    """Store the analyzer result so the frontend can fetch by id (FE-P1-02).

    Attaches `id` onto `result` in-place for the response body and returns it.
    Persistence errors are re-raised; the caller handles them as a 500 so a
    silent DB failure can't strand the client with an un-linkable result.
    """
    analysis_id = uuid.uuid4()
    row = PurchaseAnalysis(
        id=analysis_id,
        user_id=_coerce_profile_uuid(user_id),
        make=make,
        model=model,
        year=year,
        mileage_km=mileage_km,
        asking_price=asking_price,
        vin=(vin or None),
        city=city,
        country=country or DEFAULT_COUNTRY,
        payload=result,
    )
    db.add(row)
    await db.commit()
    result["id"] = str(analysis_id)
    return str(analysis_id)


@router.post("/analyze/purchase")
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_purchase_endpoint(
    request: Request,
    make: str = Form(...),
    model: str = Form(...),
    year: int = Form(...),
    mileage_km: int = Form(...),
    asking_price: int = Form(...),
    city: str = Form(...),
    country: str = Form(...),
    provider: str = Form("openai"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a used car purchase — maintenance audit, fair price, cost projection."""
    from app.intelligence.purchase_analyzer import analyze_purchase
    await _enforce_analyze_quota(request, db, user_id)
    country = _validate_country_or_400(country)
    # Form-body siblings of PurchaseAnalyzeRequest bounds — same validation,
    # surfaced as 400 instead of a Pydantic 422 so the frontend error UI
    # treats both entrypoints consistently.
    if not (1900 <= year <= _NEXT_YEAR):
        raise HTTPException(status_code=400, detail="year must be between 1900 and next year")
    if not (0 <= mileage_km <= 2_000_000):
        raise HTTPException(status_code=400, detail="mileage_km must be 0–2,000,000")
    if not (0 <= asking_price <= 10_000_000_000):
        raise HTTPException(status_code=400, detail="asking_price is out of range")
    try:
        result = await analyze_purchase(
            db=db, make=make, model=model, year=year,
            mileage_km=mileage_km, asking_price=asking_price,
            city=city, country=country, provider=provider,
        )
        await _persist_purchase_analysis(
            db, user_id=user_id, make=make, model=model, year=year,
            mileage_km=mileage_km, asking_price=asking_price,
            city=city, country=country, result=result,
        )
        if user_id:
            await quota_consume(db, user_id)
        return result
    except (RuntimeError, ValueError) as e:
        logger.error("Purchase analysis error [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Purchase analysis failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Purchase analysis failed. Please try again.")


_NEXT_YEAR = datetime.utcnow().year + 1


class PurchaseAnalyzeRequest(BaseModel):
    """Used car purchase request with strict bounds on every numeric.

    Unbounded ints flowed into `asking_price - fair_price` arithmetic and
    vehicle-year calculations, so a `year=3000` or `mileage_km=-1` would
    propagate cleanly through the synthesizer and end up as a funhouse
    mirror verdict. Bounds pick the widest plausible range for real cars.

    `vin` and `diligence` are optional Used-Cars-mode extensions: VIN is
    used to anchor the Tavily price search on the exact listing where
    available, and `diligence` is the buyer's answers to the inspection
    questionnaire (fed into the deterministic adjustment table).
    """
    make: str = Field(..., min_length=1, max_length=80)
    model: str = Field(..., min_length=1, max_length=80)
    year: int = Field(..., ge=1900, le=_NEXT_YEAR)
    mileage_km: int = Field(..., ge=0, le=2_000_000)
    asking_price: int = Field(..., ge=0, le=10_000_000_000)
    city: str | None = Field(None, max_length=120)
    country: str | None = Field(None, max_length=8)
    lat: float | None = Field(None, ge=-90.0, le=90.0)
    lng: float | None = Field(None, ge=-180.0, le=180.0)
    provider: str | None = Field(None, max_length=32)
    vin: str | None = Field(None, min_length=11, max_length=17)
    diligence: dict | None = Field(None)


@router.post("/analyze/purchase/json")
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_purchase_json(
    request: Request,
    req: PurchaseAnalyzeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a used car purchase (JSON body)."""
    from app.intelligence.purchase_analyzer import analyze_purchase
    await _enforce_analyze_quota(request, db, user_id)

    city = req.city
    country = _validate_country_or_400(req.country)

    # Resolve from lat/lng if no city/country
    if req.lat is not None and req.lng is not None and not city:
        from app.services.geo import reverse_geocode
        geo = await reverse_geocode(req.lat, req.lng)
        city = geo["city"]
        if not req.country and is_supported_country(geo["country_code"]):
            country = enforce_supported_country(geo["country_code"])

    try:
        result = await analyze_purchase(
            db=db, make=req.make, model=req.model, year=req.year,
            mileage_km=req.mileage_km, asking_price=req.asking_price,
            city=city, country=country, provider=req.provider,
            vin=req.vin, diligence=req.diligence,
        )
        await _persist_purchase_analysis(
            db, user_id=user_id, make=req.make, model=req.model, year=req.year,
            mileage_km=req.mileage_km, asking_price=req.asking_price,
            city=city, country=country, result=result, vin=req.vin,
        )
        if user_id:
            await quota_consume(db, user_id)
        return result
    except (RuntimeError, ValueError) as e:
        logger.error("Purchase analysis error [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(status_code=503, detail=str(e))
    except Exception:
        logger.exception("Purchase analysis failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Purchase analysis failed. Please try again.")


@router.post("/analyze/purchase/screenshot")
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_purchase_screenshot(
    request: Request,
    image: UploadFile = File(...),
    provider: str = Form("openai"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Extract used-car listing fields from a screenshot.

    Used Cars mode: instead of typing make/model/year/mileage by hand, the
    user can drop a screenshot of an AutoTrader / Carvana / Carfax / Facebook
    Marketplace listing and we OCR the structured fields. Returns the extracted
    values so the frontend can pre-fill the form. The actual analysis still
    runs through `/analyze/purchase/json` after the user reviews + adjusts the
    auto-filled values — this avoids spending a quota credit on bad OCR.
    """
    try:
        mime = (image.content_type or "").lower().split(";")[0].strip()
        if mime and mime not in ALLOWED_IMAGE_MIME:
            raise HTTPException(
                status_code=415,
                detail="Unsupported image type. Use JPG, PNG, WEBP, or GIF.",
            )
        image_bytes = await image.read()
        if len(image_bytes) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail="Image too large. Maximum size is 10 MB.")
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")
        media_type = mime or "image/jpeg"

        prompt = """You are extracting used-car listing data from a screenshot.

Return ONLY valid JSON with these fields (use null when a field isn't visible — never guess):
{
  "vin": "17-character VIN or null",
  "year": int year (1900-2030) or null,
  "make": "manufacturer (e.g. Honda) or null",
  "model": "model name (e.g. Civic) or null",
  "trim": "trim/edition (e.g. EX-L, Touring) or null",
  "mileage_miles": int miles on odometer or null,
  "mileage_km": int km on odometer or null (only if explicitly shown in km),
  "asking_price_dollars": int asking price in whole dollars or null,
  "city": "listing city or null",
  "state": "US state code (e.g. TX) or null",
  "title_status": "clean | salvage | rebuilt | lemon | unknown",
  "seller_type": "private | dealer | unknown",
  "raw_notes": "1-2 sentences summarizing anything else relevant (color, accidents shown, owner count, etc.)"
}

Return ONLY the JSON object, no preamble."""

        text = await vision_analyze_image(
            image_base64=image_b64, prompt=prompt,
            provider=provider, media_type=media_type,
        )
        parsed = _parse_json(text)
        if not isinstance(parsed, dict) or parsed.get("_parse_error"):
            raise HTTPException(
                status_code=422,
                detail="Couldn't extract listing details from that image. Try a clearer screenshot or enter details manually.",
            )

        # Normalize mileage to km — pipeline canonical unit. If only miles
        # are present, convert (mile = 1.609 km). If neither is present,
        # the frontend prompts the user to fill it in.
        mileage_km = parsed.get("mileage_km")
        miles = parsed.get("mileage_miles")
        if not mileage_km and miles:
            try:
                mileage_km = int(round(int(miles) * 1.609))
            except (TypeError, ValueError):
                mileage_km = None

        # Asking price → cents
        asking_cents = None
        ap = parsed.get("asking_price_dollars")
        if ap is not None:
            try:
                asking_cents = int(round(float(ap) * 100))
            except (TypeError, ValueError):
                asking_cents = None

        vin = parsed.get("vin")
        if isinstance(vin, str):
            vin = vin.strip().upper()
            if len(vin) < 11 or len(vin) > 17:
                vin = None
        else:
            vin = None

        return {
            "vin": vin,
            "year": parsed.get("year"),
            "make": parsed.get("make"),
            "model": parsed.get("model"),
            "trim": parsed.get("trim"),
            "mileage_km": mileage_km,
            "mileage_miles": miles,
            "asking_price_cents": asking_cents,
            "city": parsed.get("city"),
            "state": parsed.get("state"),
            "title_status": parsed.get("title_status"),
            "seller_type": parsed.get("seller_type"),
            "raw_notes": parsed.get("raw_notes"),
        }
    except HTTPException:
        raise
    except anthropic.BadRequestError as e:
        logger.warning("Vision rejected listing screenshot [request_id=%s]: %s", _request_id(request), str(e))
        raise HTTPException(
            status_code=400,
            detail="We couldn't read that screenshot. Try a clearer image.",
        )
    except Exception:
        logger.exception("Listing screenshot extraction failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Couldn't process screenshot. Please try again.")


@router.get("/analyze/purchase/{analysis_id}")
async def get_purchase_analysis(
    analysis_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Retrieve a stored purchase analysis by id (FE-P1-02).

    Anonymous rows (user_id IS NULL) are readable by anyone who holds the
    UUID — that's an unguessable capability. Signed-in rows are restricted
    to their owner.
    """
    try:
        parsed_id = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = await db.execute(
        select(PurchaseAnalysis).where(PurchaseAnalysis.id == str(parsed_id))
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if row.user_id is not None and (not user_id or str(row.user_id) != user_id):
        # Owner-bound row — don't leak existence.
        raise HTTPException(status_code=404, detail="Analysis not found")

    payload = dict(row.payload or {})
    payload["id"] = str(row.id)
    return payload
