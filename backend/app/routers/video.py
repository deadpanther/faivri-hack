"""POST /api/v1/analyze/video — Video-clip analysis powered by PixVerse + GMI Cloud.

Users film a quick clip of an invoice, an item on a shelf, or a marketplace
listing on their phone screen, and Faivri turns the video into a fair-price
verdict in under 10 seconds. PixVerse handles the video → keyframes hop;
the existing image-vision pipeline takes it from there.

This router is a sibling of `/analyze/image` and `/analyze/voice` — same
quota gating, same orchestrator call, same `VerdictResponse` shape so the
frontend can reuse the verdict page without modification. The only new
piece on the response is `video.served_by` and `video.comparison_visual_url`,
which the frontend exposes via the freshness badge and the side-by-side
comparison tile.
"""

import base64
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.orchestrator import process_query
from app.models.schemas import VerdictResponse
from app.routers.analyze import (
    _build_verdict_response,
    _enforce_analyze_quota,
    _request_id,
    _validate_country_or_400,
)
from app.services.auth import enforce_extension_auth
from app.services.database import get_db
from app.services.limiter import RATE_LIMIT_ANALYZE, limiter
from app.services.llm import extract_from_image
from app.services.market import enforce_supported_country, is_supported_country
from app.services.pixverse import (
    ALLOWED_VIDEO_MIME,
    MAX_VIDEO_BYTES,
    extract_keyframes,
)
from app.services.quota import consume as quota_consume

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/analyze/video", response_model=VerdictResponse)
@limiter.limit(RATE_LIMIT_ANALYZE)
async def analyze_video(
    request: Request,
    video: UploadFile = File(...),
    city: str = Form(None),
    country: str = Form(None),
    lat: float = Form(None),
    lng: float = Form(None),
    provider: str = Form("anthropic"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(enforce_extension_auth),
):
    """Analyze a video clip of an invoice / item / receipt.

    Pipeline:
      1. Validate size + MIME at the edge.
      2. PixVerse (or local OpenCV fallback) returns ranked keyframes.
      3. Top-ranked frame goes through the existing image extractor.
      4. The orchestrator (live web search → synthesis) produces a verdict.
      5. Quota is consumed, response includes the comparison-visual URL when
         PixVerse rendered one.
    """
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

    mime = (video.content_type or "").lower().split(";")[0].strip()
    if mime and mime not in ALLOWED_VIDEO_MIME:
        raise HTTPException(
            status_code=415,
            detail="Unsupported video type. Use MP4, WebM, or MOV.",
        )

    try:
        video_bytes = await video.read()
    except Exception as exc:
        logger.warning("video read failed [request_id=%s]: %s", _request_id(request), exc)
        raise HTTPException(
            status_code=400,
            detail="Could not read the uploaded video. Try recording again.",
        )

    if len(video_bytes) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Video too large. Keep clips under {MAX_VIDEO_BYTES // (1024*1024)} MB.",
        )
    if not video_bytes:
        raise HTTPException(
            status_code=400,
            detail="Empty video upload — re-record and try again.",
        )

    try:
        extraction = await extract_keyframes(
            video_bytes, content_type=mime or None, max_frames=3,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("PixVerse keyframe extraction failed [request_id=%s]", _request_id(request))
        raise HTTPException(
            status_code=503,
            detail=(
                "We couldn't process that video right now. Try a shorter clip "
                "or upload a still photo instead."
            ),
        )

    if not extraction.keyframes:
        raise HTTPException(
            status_code=422,
            detail=(
                "No usable frames in that clip. Hold the camera steady on the "
                "invoice / item for a couple of seconds."
            ),
        )

    primary_frame_b64 = base64.b64encode(extraction.keyframes[0]).decode("utf-8")

    try:
        extracted_text = await extract_from_image(
            primary_frame_b64,
            provider=provider,
            media_type="image/png",
        )
    except Exception:
        logger.exception(
            "video frame vision extraction failed [request_id=%s] served_by=%s",
            _request_id(request), extraction.served_by,
        )
        raise HTTPException(
            status_code=503,
            detail="We couldn't read the video frame. Try retaking the clip.",
        )

    try:
        result = await process_query(
            db=db,
            query_text=extracted_text,
            city=city,
            country=country,
            provider=provider,
            s2_token=s2_token,
            user_id=user_id,
        )
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("video analysis failed [request_id=%s]", _request_id(request))
        raise HTTPException(status_code=500, detail="Video analysis failed. Please try again.")

    if user_id:
        await quota_consume(db, user_id)

    response = _build_verdict_response(result)
    # Tack on PixVerse-specific metadata so the verdict page can render the
    # side-by-side comparison visual if PixVerse produced one. We append to
    # the dict via response_model_exclude_none-friendly attribute (the
    # response_model is a Pydantic class, so use model_dump + reconstruct).
    payload = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    payload["video"] = {
        "served_by": extraction.served_by,
        "duration_s": extraction.duration_s,
        "comparison_visual_url": extraction.comparison_visual_url,
        "keyframes_extracted": len(extraction.keyframes),
        "warnings": extraction.warnings,
    }
    return payload
