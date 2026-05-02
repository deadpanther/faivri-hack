"""PixVerse — Video extraction adapter for Faivri.

Users film a quick clip of an invoice, a marketplace item, or a screen full
of line-items, and Faivri turns the video into a structured quote. PixVerse
handles the "video → ranked keyframes" hop; from there the existing image
vision pipeline (`app.services.llm.extract_from_image`) takes over.

This module is intentionally narrow: it keeps to the *capture-to-text* leg
of the pipeline so the orchestrator can stay video-agnostic. Everything
downstream (LLM classification, web search, verdict synthesis) is identical
whether the input came from text, image, voice, or video.

When `PIXVERSE_API_KEY` is unset, we fall back to local frame extraction
via OpenCV (best-effort grab of one mid-clip frame). The verdict still
ships, just without the multi-frame side-by-side comparison visual the
PixVerse pipeline produces.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


# ─── Configuration ──────────────────────────────────────────────────────────

PIXVERSE_API_KEY = os.environ.get("PIXVERSE_API_KEY", "")
PIXVERSE_BASE_URL = os.environ.get(
    "PIXVERSE_BASE_URL",
    "https://api.pixverse.ai/v1",
)
# Limits picked to keep the live demo under 10s end-to-end. Anything past
# this is rejected at the router boundary, so users get an honest error
# rather than a silently-truncated video.
MAX_VIDEO_BYTES = 25 * 1024 * 1024     # 25 MB
MAX_VIDEO_DURATION_S = 30              # Hard cap; longer clips rarely add signal.
ALLOWED_VIDEO_MIME = {
    "video/mp4", "video/quicktime", "video/webm", "video/x-m4v",
    # Some browsers post an empty content-type for MediaRecorder blobs;
    # the router allows that through and trusts the file extension.
    "", "application/octet-stream",
}


def is_configured() -> bool:
    return bool(PIXVERSE_API_KEY)


# ─── Result shape ───────────────────────────────────────────────────────────

@dataclass
class VideoExtractionResult:
    """Output of the video → keyframes hop.

    `keyframes` is one or more PNG-encoded byte strings, in the order
    PixVerse ranked them (highest signal first). The orchestrator runs the
    existing vision extractor over the top-ranked frame and uses the rest
    to render the side-by-side comparison visual on the verdict page.

    `comparison_visual_url` is a CDN URL produced by PixVerse showing the
    user's quote alongside the fair-market reference — it's the "side-by-
    side comparison visual in under ten seconds" advertised in the pitch.
    Empty string when running on the local fallback.
    """

    keyframes: list[bytes]
    duration_s: float
    served_by: str  # "pixverse" or "local_opencv"
    comparison_visual_url: str = ""
    warnings: list[str] = field(default_factory=list)


# ─── Public API ─────────────────────────────────────────────────────────────

async def extract_keyframes(
    video_bytes: bytes,
    *,
    content_type: Optional[str] = None,
    max_frames: int = 3,
) -> VideoExtractionResult:
    """Pull the most informative frames out of a user-submitted clip.

    Tries PixVerse first when configured; falls back to a local OpenCV
    mid-frame grab when not. Always returns at least one frame on a
    successful call — the orchestrator can rely on `keyframes[0]` being
    safe to feed into the image-vision extractor.
    """
    if not video_bytes:
        raise ValueError("empty video payload")
    if len(video_bytes) > MAX_VIDEO_BYTES:
        raise ValueError(
            f"video exceeds {MAX_VIDEO_BYTES // (1024 * 1024)} MB cap"
        )

    if is_configured():
        try:
            return await _pixverse_extract(
                video_bytes,
                content_type=content_type,
                max_frames=max_frames,
            )
        except _PixVerseUnavailable as exc:
            logger.info("pixverse extract fallback=local reason=%s", exc.reason)

    # Local fallback — best-effort single-frame grab.
    return _local_midframe_extract(video_bytes)


# ─── PixVerse HTTP client ───────────────────────────────────────────────────

class _PixVerseUnavailable(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


async def _pixverse_extract(
    video_bytes: bytes,
    *,
    content_type: Optional[str],
    max_frames: int,
) -> VideoExtractionResult:
    import base64

    import httpx

    payload = {
        "video_b64": base64.b64encode(video_bytes).decode("ascii"),
        "content_type": content_type or "video/mp4",
        "max_frames": max_frames,
        "render_comparison_visual": True,
        "comparison_layout": "side_by_side",
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{PIXVERSE_BASE_URL}/extract/keyframes",
                headers={
                    "Authorization": f"Bearer {PIXVERSE_API_KEY}",
                    "Content-Type": "application/json",
                    "X-Faivri-Source": "negotiation-agent",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise _PixVerseUnavailable(f"http:{exc.__class__.__name__}") from exc

    if res.status_code != 200:
        raise _PixVerseUnavailable(f"status:{res.status_code}")

    body = res.json()
    frames_b64 = body.get("frames") or []
    if not frames_b64:
        raise _PixVerseUnavailable("no_frames_returned")

    keyframes = [base64.b64decode(f) for f in frames_b64]
    return VideoExtractionResult(
        keyframes=keyframes,
        duration_s=float(body.get("duration_s") or 0.0),
        served_by="pixverse",
        comparison_visual_url=body.get("comparison_visual_url") or "",
        warnings=list(body.get("warnings") or []),
    )


# ─── Local fallback ─────────────────────────────────────────────────────────

def _local_midframe_extract(video_bytes: bytes) -> VideoExtractionResult:
    """OpenCV-backed mid-clip frame grab.

    Used when PIXVERSE_API_KEY is unset *or* PixVerse is down. Returns a
    single frame so callers always have something to feed the vision
    extractor. We deliberately don't try to render a comparison visual —
    that's the part that's hard without GPU compute.

    Imports OpenCV lazily so a missing OpenCV install doesn't break boot
    on slim deploys that don't take video uploads.
    """
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except ImportError:
        raise _PixVerseUnavailable("opencv_not_installed")

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=True) as tmp:
        tmp.write(video_bytes)
        tmp.flush()
        cap = cv2.VideoCapture(tmp.name)
        if not cap.isOpened():
            raise _PixVerseUnavailable("video_unreadable")
        try:
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
            mid = max(0, total_frames // 2)
            cap.set(cv2.CAP_PROP_POS_FRAMES, mid)
            ok, frame = cap.read()
            if not ok or frame is None:
                raise _PixVerseUnavailable("frame_grab_failed")
            ok, buf = cv2.imencode(".png", frame)
            if not ok:
                raise _PixVerseUnavailable("encode_failed")
            duration_s = (total_frames / fps) if fps > 0 else 0.0
            return VideoExtractionResult(
                keyframes=[bytes(buf)],
                duration_s=duration_s,
                served_by="local_opencv",
                comparison_visual_url="",
                warnings=["pixverse_unavailable"],
            )
        finally:
            cap.release()


def status() -> dict:
    return {
        "configured": is_configured(),
        "max_video_mb": MAX_VIDEO_BYTES // (1024 * 1024),
        "max_duration_s": MAX_VIDEO_DURATION_S,
    }
