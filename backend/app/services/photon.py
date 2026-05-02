"""Photon — Faivri's messaging assistant.

When a buyer or seller sends a message, Photon reads it against the live
HydraDB memory snapshot for that negotiation and drafts a polite,
data-backed reply the user can send verbatim. This is the "messaging
assistant powered by Photon" leg of the pitch.

Implementation: Photon is a thin orchestration layer that
  1. Pulls the negotiation memory via `app.services.hydradb.read_session`,
  2. Builds a prompt that grounds the reply in the fair-price range,
     walk-away ceiling, and prior conversation turns,
  3. Routes the inference call through `app.services.gmi_cloud.strong_synthesis`
     so it lands on the GPU fleet when available and falls back to the
     managed providers otherwise,
  4. Persists the resulting message into `negotiation_conversations` so it
     becomes part of the durable negotiation transcript.

Photon owns *output style* — tone (polite / firm / walk-away / friendly),
length, and how aggressively it pushes back on a low-quality counter. The
LLM does the language; Photon shapes it.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import gmi_cloud, hydradb

logger = logging.getLogger(__name__)


ALLOWED_TONES = ("polite", "firm", "walk_away", "friendly")
DEFAULT_TONE = "polite"

# Cap how long Photon's reply can run. Buyers paste these into iMessage /
# WhatsApp / Marketplace chat — anything past three short paragraphs reads
# as a wall of text and tanks the response rate.
MAX_REPLY_TOKENS = 600


@dataclass
class PhotonReply:
    text: str
    tone: str
    suggested_price_cents: Optional[int]
    served_by: str
    grounded_in: dict


# ─── Public API ─────────────────────────────────────────────────────────────

async def draft_reply(
    db: AsyncSession,
    *,
    query_id: UUID,
    seller_message: str,
    user_intent: Optional[str] = None,
    tone: str = DEFAULT_TONE,
    requested_provider: str = "anthropic",
) -> PhotonReply:
    """Draft a reply to the seller, grounded in the negotiation memory.

    `user_intent` is an optional hint from the user ("hold firm at $400",
    "I'm willing to walk away"). When omitted, Photon infers intent from
    the seller's message + the walk-away ceiling already on file.
    """
    if tone not in ALLOWED_TONES:
        tone = DEFAULT_TONE

    memory = await hydradb.read_session(db, query_id)
    if memory is None:
        # Without memory we can't ground the reply — surface the empty
        # state to the caller rather than fabricate fair-price numbers.
        raise PhotonGroundingMissing(
            "no negotiation memory found for this query; analyze it first"
        )

    system_prompt, user_prompt = _build_prompt(
        memory=memory,
        seller_message=seller_message,
        user_intent=user_intent,
        tone=tone,
    )

    inference = await gmi_cloud.strong_synthesis(
        requested_provider=requested_provider,
        system=system_prompt,
        user=user_prompt,
        max_tokens=MAX_REPLY_TOKENS,
    )

    parsed = _parse_reply(inference.payload)

    # Update HydraDB memory: capture the seller's tone (if Photon labelled
    # it) and append the inferred price point to the timeline. This is the
    # "seller tone" signal the pitch promises.
    try:
        await hydradb.upsert_session(
            db,
            user_id=None,
            query_id=query_id,
            seller_tone=parsed.get("seller_tone"),
            price_point={
                "actor": "seller",
                "raw_message": seller_message,
                "at": datetime.utcnow().isoformat(),
                "inferred_price_cents": _extract_price_hint_cents(seller_message),
            },
        )
    except Exception as exc:
        logger.warning("photon: failed to persist seller turn err=%s", exc)

    return PhotonReply(
        text=parsed["reply"],
        tone=tone,
        suggested_price_cents=parsed.get("suggested_price_cents"),
        served_by=inference.served_by,
        grounded_in={
            "fair_low_cents": memory.fair_low_cents,
            "fair_high_cents": memory.fair_high_cents,
            "walk_away_cents": memory.walk_away_cents,
            "prior_messages": len(memory.conversation_messages),
            "prior_counters": len(memory.counter_offer_history),
        },
    )


# ─── Errors ─────────────────────────────────────────────────────────────────

class PhotonGroundingMissing(Exception):
    """Raised when Photon is asked to draft a reply for a query that has
    no negotiation memory yet. Routers should translate this to a 409 so
    the user knows to run an analysis first."""


# ─── Prompt construction ────────────────────────────────────────────────────

_TONE_GUIDANCE = {
    "polite": (
        "Warm, respectful, no aggression. Acknowledge the seller's position "
        "before pushing back. End with a clear next step."
    ),
    "firm": (
        "Direct and confident without being rude. Cite the fair-price range "
        "explicitly. Make the counter-offer the headline."
    ),
    "walk_away": (
        "Polite goodbye. Thank them, state the walk-away threshold, and "
        "leave the door open for them to come back at a fair number."
    ),
    "friendly": (
        "Casual and conversational. Use contractions, light humor is fine, "
        "but the math has to be defensible."
    ),
}


def _build_prompt(
    *,
    memory,
    seller_message: str,
    user_intent: Optional[str],
    tone: str,
) -> tuple[str, str]:
    fair_range = "unknown"
    if memory.fair_low_cents and memory.fair_high_cents:
        fair_range = f"${memory.fair_low_cents/100:.0f} – ${memory.fair_high_cents/100:.0f}"

    walk = "unset"
    if memory.walk_away_cents:
        walk = f"${memory.walk_away_cents/100:.0f}"

    quoted = "unknown"
    if memory.quoted_price_cents:
        quoted = f"${memory.quoted_price_cents/100:.0f}"

    history_lines: list[str] = []
    for turn in memory.conversation_messages[-6:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        history_lines.append(f"{role.upper()}: {content}")
    history_block = "\n".join(history_lines) or "(no prior messages)"

    system = (
        "You are Photon, the Faivri messaging assistant. You draft short, "
        "polite, data-backed replies that the user can send verbatim to a "
        "seller during a price negotiation. Never invent fair-price numbers — "
        "always ground in the provided range. Never agree to a price above "
        "the walk-away ceiling. Output JSON only.\n\n"
        f"Tone guidance: {_TONE_GUIDANCE[tone]}"
    )

    user = (
        "## Negotiation memory\n"
        f"Quoted price: {quoted}\n"
        f"Fair-market range: {fair_range}\n"
        f"Walk-away ceiling: {walk}\n"
        f"Prior turns:\n{history_block}\n\n"
        "## Seller's latest message\n"
        f"{seller_message}\n\n"
        "## User's intent (optional hint)\n"
        f"{user_intent or '(none — infer from memory)'}\n\n"
        "## Output schema\n"
        "Return strict JSON with these keys:\n"
        '{ "reply": str, "suggested_price_cents": int|null, '
        '"seller_tone": "polite"|"firm"|"aggressive"|"flexible"|"unclear" }\n'
        "The `reply` field is what the user will send. Keep it under 90 words."
    )
    return system, user


# ─── Output parsing ─────────────────────────────────────────────────────────

def _parse_reply(raw: str) -> dict:
    """Parse Photon's JSON output, tolerant of code-fence wrappers."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Best-effort recovery — extract first {...} block.
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return {"reply": text or "(no reply)", "suggested_price_cents": None}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {"reply": text or "(no reply)", "suggested_price_cents": None}
    if "reply" not in data or not isinstance(data["reply"], str):
        return {"reply": text, "suggested_price_cents": None}
    return data


_PRICE_HINT_PATTERN = re.compile(
    r"\$?\s*([0-9]{2,6}(?:[.,][0-9]{2})?)\s*(?:dollars|usd|bucks|inr|rs)?",
    re.IGNORECASE,
)


def _extract_price_hint_cents(text: str) -> Optional[int]:
    """Scrape an obvious dollar/number figure out of a seller message.

    Conservative on purpose — we only want to flag clear price points like
    "I can do 380" or "$1,200 firm". Anything ambiguous returns None and
    the timeline simply records the message without a number.
    """
    if not text:
        return None
    matches = _PRICE_HINT_PATTERN.findall(text)
    for raw in matches:
        cleaned = raw.replace(",", "")
        try:
            value = float(cleaned)
        except ValueError:
            continue
        if 10 <= value <= 1_000_000:
            return int(round(value * 100))
    return None


def status() -> dict:
    return {
        "tones": list(ALLOWED_TONES),
        "max_reply_tokens": MAX_REPLY_TOKENS,
    }
