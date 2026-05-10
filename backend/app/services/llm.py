"""
Model factory — supports OpenAI (default) and Anthropic.
Provider can be switched per-request via `provider` param or globally via DEFAULT_PROVIDER env.

Includes a process-local circuit breaker: when one provider throws N
times in a row within the tripping window, subsequent calls auto-fall
back to the other provider for `COOLDOWN_SECONDS`. Prevents a regional
Anthropic outage from taking down every /analyze request while the
second provider is healthy.
"""

import json
import logging
import time
from typing import Optional

import anthropic
from openai import AsyncOpenAI

from app.config import settings

logger = logging.getLogger(__name__)

# Initialize clients (lazy — only fails if actually used without key)
_openai: Optional[AsyncOpenAI] = None
_anthropic: Optional[anthropic.AsyncAnthropic] = None


# ─── Provider circuit breaker ────────────────────────────────────────────────

_BREAKER_THRESHOLD = 3           # consecutive failures before tripping
_BREAKER_COOLDOWN_SECONDS = 60   # stay tripped this long before re-probing

# per-provider: {"failures": int, "tripped_until": float(epoch)}
_breaker: dict[str, dict[str, float]] = {
    "openai": {"failures": 0, "tripped_until": 0.0},
    "anthropic": {"failures": 0, "tripped_until": 0.0},
}


def _breaker_tripped(provider: str) -> bool:
    state = _breaker.get(provider) or {}
    return time.time() < (state.get("tripped_until") or 0.0)


def _breaker_record_success(provider: str) -> None:
    state = _breaker.get(provider)
    if not state:
        return
    state["failures"] = 0
    state["tripped_until"] = 0.0


def _breaker_record_failure(provider: str) -> None:
    state = _breaker.setdefault(provider, {"failures": 0, "tripped_until": 0.0})
    state["failures"] = (state.get("failures") or 0) + 1
    if state["failures"] >= _BREAKER_THRESHOLD:
        state["tripped_until"] = time.time() + _BREAKER_COOLDOWN_SECONDS
        logger.warning(
            "LLM breaker TRIPPED provider=%s cooldown=%ds failures=%s",
            provider, _BREAKER_COOLDOWN_SECONDS, state["failures"],
        )


def _pick_healthy_provider(requested: str) -> str:
    """Return `requested` if its breaker is closed and a key is set;
    otherwise fall back to the other provider when it's configured.
    Callers that truly can't fail over (voice transcription → OpenAI
    only) should bypass this and call clients directly."""
    def _configured(p: str) -> bool:
        return bool(settings.openai_api_key) if p == "openai" else bool(settings.anthropic_api_key)

    other = "openai" if requested == "anthropic" else "anthropic"
    if not _breaker_tripped(requested) and _configured(requested):
        return requested
    if _configured(other):
        logger.info("LLM breaker: routing requested=%s → %s", requested, other)
        return other
    # Both unavailable: return the requested and let the call fail loudly.
    return requested


def _get_openai() -> AsyncOpenAI:
    global _openai
    if _openai is None:
        _openai = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai


def _get_anthropic() -> anthropic.AsyncAnthropic:
    global _anthropic
    if _anthropic is None:
        _anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic


def _parse_json(text: str) -> dict | list:
    """Extract JSON from LLM response with robust fallback.

    Handles: code blocks, leading text, trailing text, partial JSON.
    Returns dict, list, or {"_parse_error": True} on failure.
    """
    import re

    text = text.strip()

    # Strip code blocks
    if "```" in text:
        parts = text.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("{") or part.startswith("["):
                try:
                    return json.loads(part)
                except json.JSONDecodeError:
                    continue

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find JSON array in text
    match_arr = re.search(r'\[[\s\S]*\]', text)
    if match_arr:
        try:
            return json.loads(match_arr.group())
        except json.JSONDecodeError:
            pass

    # Find JSON object in text
    match_obj = re.search(r'\{[\s\S]*\}', text)
    if match_obj:
        try:
            return json.loads(match_obj.group())
        except json.JSONDecodeError:
            pass

    # Parsing failed — return a transparent error rather than a fake verdict
    return {
        "_parse_error": True,
    }


# ─── Provider-agnostic chat completion ───

async def _chat(
    messages: list[dict],
    system: str = "",
    provider: str | None = None,
    max_tokens: int = 1500,
    model_tier: str = "fast",  # "fast" or "strong"
) -> str:
    """Send a chat completion to the configured provider.

    The circuit breaker reroutes traffic to the healthy provider when the
    requested one has failed `_BREAKER_THRESHOLD` times in a row. Each call
    records success/failure so the breaker self-heals on the first good
    response after cooldown.
    """
    requested = provider or settings.default_provider
    provider = _pick_healthy_provider(requested)

    if provider == "openai":
        client = _get_openai()
        model = "gpt-4o-mini" if model_tier == "fast" else "gpt-4o"
        full_messages = []
        if system:
            full_messages.append({"role": "system", "content": system})
        full_messages.extend(messages)
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=full_messages,
                max_tokens=max_tokens,
                temperature=0.1,
            )
        except Exception:
            _breaker_record_failure(provider)
            raise
        _breaker_record_success(provider)
        choices = getattr(response, "choices", None) or []
        if not choices:
            return ""
        return (getattr(choices[0].message, "content", "") or "")

    else:  # anthropic
        client = _get_anthropic()
        model = "claude-haiku-4-5-20251001"  # use haiku for all tiers (sonnet not available on this key)
        kwargs = {"model": model, "max_tokens": max_tokens, "messages": messages}
        if system:
            kwargs["system"] = system
        try:
            response = await client.messages.create(**kwargs)
        except Exception:
            _breaker_record_failure(provider)
            raise
        _breaker_record_success(provider)
        blocks = getattr(response, "content", None) or []
        if not blocks:
            return ""
        return getattr(blocks[0], "text", "") or ""


# ─── Vision (image analysis) ───

_ALLOWED_IMAGE_MEDIA_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}


async def analyze_image(
    image_base64: str,
    prompt: str,
    provider: str | None = None,
    media_type: str = "image/jpeg",
) -> str:
    """Analyze an image using vision model.

    `media_type` must match the bytes the caller encoded — Anthropic's vision
    endpoint rejects mismatches (e.g. PNG payload declared as JPEG) with a 400.
    """
    requested = provider or settings.default_provider
    provider = _pick_healthy_provider(requested)
    if media_type not in _ALLOWED_IMAGE_MEDIA_TYPES:
        media_type = "image/jpeg"

    if provider == "openai":
        client = _get_openai()
        try:
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{image_base64}"}},
                    ],
                }],
                max_tokens=1500,
            )
        except Exception:
            _breaker_record_failure(provider)
            raise
        _breaker_record_success(provider)
        choices = getattr(response, "choices", None) or []
        if not choices:
            return ""
        return (getattr(choices[0].message, "content", "") or "")
    else:
        client = _get_anthropic()
        try:
            response = await client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1500,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                    ],
                }],
            )
        except Exception:
            _breaker_record_failure(provider)
            raise
        _breaker_record_success(provider)
        blocks = getattr(response, "content", None) or []
        if not blocks:
            return ""
        return getattr(blocks[0], "text", "") or ""


# ─── Voice transcription (always OpenAI Whisper) ───

async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe audio using OpenAI Whisper."""
    client = _get_openai()
    from io import BytesIO
    audio_file = BytesIO(audio_bytes)
    audio_file.name = filename
    response = await client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
    )
    return response.text


# ─── Domain-specific functions ───

CLASSIFY_SYSTEM = """Extract structured information from this consumer price query.
This system operates in the US market only. Always set country=US and currency=USD.

Return ONLY valid JSON with these fields:
{
  "domain": "auto|medical|home|legal|retail",
  "service": "brief service description",
  "make": "vehicle/brand make or null",
  "model": "vehicle/product model or null",
  "year": "year or null",
  "quoted_price": number_in_cents_or_null,
  "currency": "USD",
  "city": "US city name or null",
  "country": "US"
}

Convert all dollar prices to cents (multiply by 100). Example: $450 = 45000.

Domain guide:
- auto: mechanic / dealership / auto parts / vehicle services
- medical: prescriptions, procedures, dental, hospital bills, copays
- home: contractor / plumber / electrician / HVAC / roofing / remodel
- legal: attorney / law firm / retainer / legal services
- retail: physical products from Amazon / Walmart / Costco / Best Buy / Target /
  Newegg / Home Depot / Lowe's, and secondhand marketplaces like eBay, Facebook
  Marketplace, Craigslist, Swappa. Includes electronics (GPUs, laptops, phones,
  TVs), appliances, furniture, tools, and any boxed consumer good.
  Keywords that signal retail: "eBay", "Marketplace", "Amazon", "Walmart",
  "Costco", "Newegg", "Best Buy", a product model number (RTX 5090, MacBook Pro,
  iPhone 15), "new in box", "used", "refurb", "listing"."""


async def classify_query(query: str, provider: str | None = None) -> dict:
    """Extract structured fields from user query."""
    text = await _chat(
        messages=[{"role": "user", "content": query}],
        system=CLASSIFY_SYSTEM,
        provider=provider,
        model_tier="fast",
        max_tokens=500,
    )
    return _parse_json(text)


async def synthesize_explanation(
    query: str,
    classification: dict,
    fair_range: dict,
    verdict_math: dict,
    evidence_sources: list[dict],
    domain_context: str,
    provider: str | None = None,
) -> dict:
    """Narrative-only synthesis.

    The LLM does NOT invent prices. It receives the deterministic FairRange and
    verdict math as read-only ground truth, then writes explanation + red_flags
    + questions grounded in those numbers. If the LLM's response tries to
    override prices, the caller ignores those fields.
    """
    quoted = classification.get("quoted_price")
    sym = "$"

    fair_low = fair_range.get("fair_price_low", 0) / 100
    fair_mid = fair_range.get("fair_price_mid", 0) / 100
    fair_high = fair_range.get("fair_price_high", 0) / 100
    quoted_display = f"{sym}{quoted / 100:,.0f}" if quoted else "not specified"
    conservative = verdict_math.get("conservative_overpay", 0) / 100
    expected = verdict_math.get("expected_overpay", 0) / 100
    verdict_label = verdict_math.get("verdict", "fair")

    city = classification.get("city") or "Unknown"
    service = classification.get("service") or "service"

    prompt = f"""You are Faivri's consumer-protection analyst. Explain a pre-computed verdict
to the user in plain English. You are NOT allowed to change any prices — the
market range, overpay amounts, and verdict label below are FINAL.

=== WHAT THE USER ASKED ===
USER QUERY: {query}
SERVICE: {service}
LOCATION: {city}, US
QUOTED PRICE: {quoted_display}

=== DETERMINISTIC VERDICT (do not change) ===
FAIR MARKET RANGE: {sym}{fair_low:,.0f} – {sym}{fair_high:,.0f} (median {sym}{fair_mid:,.0f})
VERDICT LABEL: {verdict_label}
CONSERVATIVE OVERPAY (vs. high end): {sym}{conservative:,.0f}
EXPECTED OVERPAY (vs. median):      {sym}{expected:,.0f}

=== EVIDENCE ({len(evidence_sources)} cited sources) ===
{_format_evidence_sources(evidence_sources)}

=== DOMAIN EXPERTISE ===
{domain_context}

=== RULES ===
- Never state a fair price that is not inside the range above.
- Cite at least one source domain by name in the explanation.
- If verdict is "fair": congratulate, suggest asking for extras (warranty, timeline).
- If verdict is "high" or "overcharge": cite the conservative overpay amount as the
  number the user can defend. Do not exaggerate by using the expected overpay as the
  headline number.
- Red flags must each reference a specific {sym} number or source.
- Questions must each be something the user can literally say to the vendor.

Return ONLY valid JSON — no other fields, no preamble:
{{
  "explanation": "2-3 sentence summary. Mention range, cite one source domain, state overpay if any.",
  "red_flags": ["up to 4 strings, each referencing a specific number or source"],
  "questions_to_ask": ["up to 4 strings, each an actual question the user can ask the vendor"]
}}"""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="strong",
        max_tokens=900,
    )
    parsed = _parse_json(text)
    if not isinstance(parsed, dict) or parsed.get("_parse_error"):
        return {
            "explanation": _fallback_explanation(verdict_label, fair_low, fair_high, conservative),
            "red_flags": [],
            "questions_to_ask": [],
        }

    return {
        "explanation": parsed.get("explanation") or _fallback_explanation(
            verdict_label, fair_low, fair_high, conservative
        ),
        "red_flags": [s for s in (parsed.get("red_flags") or []) if isinstance(s, str)][:4],
        "questions_to_ask": [s for s in (parsed.get("questions_to_ask") or []) if isinstance(s, str)][:4],
    }


def _fallback_explanation(verdict_label: str, fair_low: float, fair_high: float, conservative: float) -> str:
    """Deterministic fallback copy when the LLM narrative fails to parse."""
    range_str = f"${fair_low:,.0f}–${fair_high:,.0f}"
    if verdict_label == "fair":
        return f"Your quote falls within the fair market range of {range_str}. This looks reasonable."
    if verdict_label == "high":
        return (
            f"Your quote is above the fair market range of {range_str}. "
            f"You may be overpaying by ${conservative:,.0f}."
        )
    return (
        f"Your quote is significantly above the fair market range of {range_str}. "
        f"You could save ${conservative:,.0f} by negotiating or shopping around."
    )


DOMAIN_TACTICS = {
    "auto": [
        "Ask for OBD-II Diagnostic Printout",
        "Request OEM vs Aftermarket Breakdown",
        "Mention RepairPal/KBB Estimates",
        "Ask About Warranty on Parts & Labor",
    ],
    "medical": [
        "Ask for Generic Alternatives",
        "Reference GoodRx/CostPlusDrugs Prices",
        "Request Itemized Bill Breakdown",
        "Ask About Cash Pay Discount",
    ],
    "home": [
        "Request Itemized Material vs Labor",
        "Ask for Contractor License Number",
        "Reference HomeAdvisor/Angi Estimates",
        "Get 2 More Written Quotes",
    ],
    "legal": [
        "Ask for Flat-Fee Option",
        "Request Billing Increment Details",
        "Reference Avvo/LegalMatch Fee Ranges",
        "Ask About Pro Bono or Sliding Scale",
    ],
    "retail": [
        "Cite Amazon/Walmart/Newegg Current Price",
        "Reference eBay Recent SOLD Listings (not active)",
        "Request Exact Model Number / SKU Match",
        "Ask for Condition Breakdown (New / Open-Box / Refurb / Used)",
        "Check CamelCamelCamel Price History Before Agreeing",
        "Offer Pickup-Only to Unlock Lower Price (local marketplaces)",
    ],
}


async def generate_negotiation(
    query_text: str,
    verdict_data: dict,
    currency: str,
    provider: str | None = None,
) -> dict:
    """Generate negotiation scripts and tactics with psychological framework."""
    fair_low = verdict_data.get("fair_price_low", 0) / 100
    fair_mid = verdict_data.get("fair_price_mid", 0) / 100
    fair_high = verdict_data.get("fair_price_high", 0) / 100
    quoted = verdict_data.get("quoted_price", 0)
    if quoted:
        quoted = quoted / 100

    sym = "$"
    domain = verdict_data.get("domain", "auto")
    domain_tactics = DOMAIN_TACTICS.get(domain, DOMAIN_TACTICS["auto"])
    explanation = verdict_data.get("explanation", "")
    red_flags = verdict_data.get("red_flags", [])
    questions = verdict_data.get("questions_to_ask", [])
    data_points = verdict_data.get("data_points_count", 0)
    multiplier = verdict_data.get("overcharge_multiplier", 1.0)
    conservative_overpay = verdict_data.get("conservative_overpay", 0) / 100
    expected_overpay = verdict_data.get("expected_overpay", 0) / 100
    anchor_target = verdict_data.get("target_price", 0) / 100
    anchor_walkaway = verdict_data.get("walk_away_above", 0) / 100
    evidence_sources = verdict_data.get("evidence_sources") or []
    evidence_block = _format_evidence_sources(evidence_sources) if evidence_sources else (
        "No structured evidence available — stick to the fair range; do NOT invent source names."
    )

    prompt = f"""You are Faivri's expert negotiation coach, trained in behavioral psychology
and consumer advocacy. Generate a battle-tested negotiation playbook for this situation.

=== SITUATION BRIEFING ===
ORIGINAL QUERY: {query_text}
DOMAIN: {domain}
VERDICT: {verdict_data.get('verdict', 'overcharge')} — charged {multiplier}x fair market price
FAIR MARKET RANGE: {sym}{fair_low:,.0f} – {sym}{fair_high:,.0f} (median {sym}{fair_mid:,.0f}, {data_points} data points)
QUOTED PRICE: {sym + f"{quoted:,.0f}" if quoted else "not specified"}
CONSERVATIVE OVERPAY (defensible in negotiation): {sym}{conservative_overpay:,.0f}
EXPECTED OVERPAY (vs. median): {sym}{expected_overpay:,.0f}
ANCHOR TARGET (opener — FIXED, do NOT change): {sym}{anchor_target:,.0f}
WALK-AWAY CEILING (FIXED, do NOT change): {sym}{anchor_walkaway:,.0f}
ANALYSIS: {explanation}
RED FLAGS: {red_flags}
KEY QUESTIONS: {questions}
DOMAIN TACTICS AVAILABLE: {domain_tactics}

=== CITABLE EVIDENCE (use these domains + prices by name — do NOT invent others) ===
{evidence_block}

=== PSYCHOLOGICAL FRAMEWORK ===
Apply these proven negotiation principles:

1. **ANCHORING**: Open with a number BELOW your target (near fair_low). The first number
   spoken becomes the psychological anchor. Never let their inflated quote be the anchor.

2. **BATNA (Best Alternative to Negotiated Agreement)**: Always have and mention alternatives.
   "I have quotes from two other shops at {sym}{fair_low:,.0f}–{sym}{fair_high:,.0f}" gives you power.

3. **THE FLINCH**: React visibly to their price. Silence + surprise = pressure to justify.
   Script a moment where you pause and say "That's... significantly above what I was expecting."

4. **RECIPROCITY**: If they won't budge on price, ask for extras (warranty, free follow-up,
   expedited service, waived fees). They're psychologically primed to give SOMETHING.

5. **DEADLINE PRESSURE**: "I need to make a decision by [tomorrow/end of week] — I'm comparing
   options." Urgency without desperation.

6. **SOCIAL PROOF**: "Other customers in {verdict_data.get('location_city', 'this area')} are
   paying {sym}{fair_low:,.0f}–{sym}{fair_high:,.0f} for this exact service."

Return ONLY valid JSON with all prices in cents:
{{
  "target_price": int (aim for 10-15% above fair_low — aggressive but credible anchor),
  "walk_away_above": int (~10% above fair_high — your hard ceiling),
  "scripts": [
    {{"role": "you_opening", "text": "Confident opener: state you've researched, drop your anchor price near fair_low. Sound informed, not aggressive."}},
    {{"role": "them_pushback", "text": "Their likely defense: 'quality parts', 'complexity', 'our expertise'. Script their exact words so user isn't caught off guard."}},
    {{"role": "you_evidence", "text": "Data-backed counter: cite SPECIFIC sources — '{sym}X on RepairPal', '{sym}Y average in [city]'. Use silence after delivering data."}},
    {{"role": "them_partial", "text": "They offer a partial discount but still above fair range. Script their likely concession amount."}},
    {{"role": "you_final_offer", "text": "Final offer at target_price. Invoke BATNA: 'I appreciate your time, but I have a competing quote at {sym}X. Can you match it?'"}},
    {{"role": "them_accepts_or_stalls", "text": "Two branches: if they accept, confirm in writing. If they stall, use deadline pressure."}},
    {{"role": "you_walkaway", "text": "Polite but firm exit: 'Thank you for your time. I'll be going with [specific alternative] at {sym}X.' Leave the door open — they often call back."}},
    {{"role": "you_followup", "text": "If they call back with a better offer: how to respond. Always get it in writing."}}
  ],
  "tactics": [
    {{"name": "tactic name", "description": "Specific step-by-step with {sym} amounts from THIS analysis. Not generic advice."}}
  ],
  "evidence_summary": "2-3 sentence evidence brief the user can TEXT or EMAIL to the vendor. Include specific data points and sources."
}}

=== RULES ===
- Use {sym} for all prices. Be SPECIFIC — "{sym}{fair_low:,.0f}" not "the fair price".
- Scripts must sound like real human conversation — not robotic or confrontational.
- Include 6-8 tactics mixing psychology (anchoring, BATNA, flinch, reciprocity) + domain-specific.
- Every tactic must reference SPECIFIC {sym} amounts from this analysis.
- The evidence_summary must be copy-pasteable — something the user can send to the vendor verbatim.
- If verdict is "fair", focus tactics on getting extras/warranty rather than price reduction.
- CITATION RULE: when scripts or tactics reference a source domain, you MUST pick from
  the CITABLE EVIDENCE list above. Do NOT fabricate domain names, prices, or quotes
  that are not in that list. If no evidence is available, speak in ranges only."""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="strong",
        max_tokens=3500,
    )
    parsed = _parse_json(text)
    if not isinstance(parsed, dict) or parsed.get("_parse_error") or not parsed.get("scripts"):
        logger.warning(
            "Negotiation LLM produced unusable response (len=%d). Head: %s",
            len(text or ""), (text or "")[:400].replace("\n", " "),
        )
    return parsed


async def continue_negotiation_chat(
    *,
    query_text: str,
    verdict_data: dict,
    history: list[dict],
    seller_message: Optional[str],
    user_message: Optional[str],
    currency: str = "USD",
    provider: str | None = None,
) -> dict:
    """Conversational negotiation coach (overnight launch feature).

    Takes the full ordered message history plus the latest seller message (or
    user question) and returns a single coaching turn: what to say next, the
    price to suggest, whether to accept, and a tone tag the UI can render.

    The model is constrained by the same fair-range ground truth used for the
    initial playbook so it can't drift into "just pay whatever they said".
    """
    fair_low = verdict_data.get("fair_price_low", 0) / 100
    fair_mid = verdict_data.get("fair_price_mid", 0) / 100
    fair_high = verdict_data.get("fair_price_high", 0) / 100
    anchor_target = verdict_data.get("target_price", 0) / 100
    anchor_walkaway = verdict_data.get("walk_away_above", 0) / 100
    quoted = (verdict_data.get("quoted_price") or 0) / 100
    domain = verdict_data.get("domain", "retail")
    verdict_label = verdict_data.get("verdict", "high")

    history_lines: list[str] = []
    for turn in history[-14:]:  # keep prompt bounded
        role = turn.get("role", "user")
        content = (turn.get("content") or "").strip()
        if not content:
            continue
        label = "SELLER / COUNTERPARTY" if role == "assistant" else "YOU (the user)"
        history_lines.append(f"{label}: {content}")
    history_block = "\n".join(history_lines) or "(no prior turns — this is the opener)"

    latest_parts: list[str] = []
    if seller_message:
        latest_parts.append(f"SELLER JUST SAID: {seller_message.strip()}")
    if user_message:
        latest_parts.append(f"USER ASKS YOU: {user_message.strip()}")
    latest_block = "\n".join(latest_parts) or "USER WANTS THE OPENING MESSAGE."

    prompt = f"""You are Faivri's live negotiation co-pilot. You sit over the user's
shoulder while they text / chat a seller on Marketplace, eBay, or a service
provider. Generate ONE single message the user can send right now.

=== GROUND TRUTH (do NOT change) ===
ITEM / QUERY: {query_text}
DOMAIN: {domain}
VERDICT: {verdict_label}
FAIR MARKET RANGE: ${fair_low:,.0f} – ${fair_high:,.0f} (median ${fair_mid:,.0f})
QUOTED / LISTED PRICE: ${quoted:,.0f}
IDEAL OPENING ANCHOR: ${anchor_target:,.0f}
HARD WALK-AWAY CEILING: ${anchor_walkaway:,.0f}

=== CONVERSATION SO FAR ===
{history_block}

=== WHAT JUST HAPPENED ===
{latest_block}

=== YOUR JOB ===
Return ONE short reply the user can copy-paste and send. It should:
- Sound like a real person texting, not a form letter.
- Stay polite and non-confrontational.
- If the seller is already at or below fair_high, lean ACCEPT and ask for written
  confirmation / condition details / pickup logistics.
- If the seller is still above fair_high, counter with a specific number between
  target and fair_high. Cite "similar listings" or "comparable asks" rather than
  naming an exact website unless the user mentioned one.
- If the user asked a question (no seller message yet), write the opener.

Return ONLY valid JSON (no code fences, no commentary):
{{
  "reply": "string — the exact text to send the seller (<=320 chars, natural tone)",
  "suggested_price_cents": int or null — the concrete price you're offering in this turn,
  "should_accept": boolean — true only if user should take the seller's last offer as-is,
  "tone": "friendly|firm|walk-away|accept" — one of these four,
  "next_move_hint": "string — 1 short sentence of private coaching the UI shows under the reply"
}}

If you cannot help (e.g. off-topic message), still return the JSON shape with a
safe, generic de-escalation reply and tone="friendly"."""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="fast",
        max_tokens=600,
    )
    parsed = _parse_json(text)
    if not isinstance(parsed, dict) or parsed.get("_parse_error"):
        return _fallback_chat_turn(
            fair_low=fair_low, fair_high=fair_high,
            anchor_target=anchor_target, seller_message=seller_message,
        )

    reply = (parsed.get("reply") or "").strip()
    if not reply:
        return _fallback_chat_turn(
            fair_low=fair_low, fair_high=fair_high,
            anchor_target=anchor_target, seller_message=seller_message,
        )
    return {
        "reply": reply[:600],
        "suggested_price_cents": parsed.get("suggested_price_cents"),
        "should_accept": bool(parsed.get("should_accept")),
        "tone": parsed.get("tone") or "friendly",
        "next_move_hint": (parsed.get("next_move_hint") or "")[:240],
    }


def _fallback_chat_turn(
    *, fair_low: float, fair_high: float,
    anchor_target: float, seller_message: Optional[str],
) -> dict:
    """Deterministic coaching reply used when the LLM response fails to parse.

    Keeps the chat flow alive during provider hiccups — the user still gets a
    sensible line to send rather than a red error banner.
    """
    anchor = anchor_target or fair_low or 0
    range_str = (
        f"${fair_low:,.0f}–${fair_high:,.0f}"
        if fair_low and fair_high else "the going rate"
    )
    if seller_message:
        reply = (
            f"Thanks for getting back to me. Based on comparable listings I'm seeing at "
            f"{range_str}, could you do ${anchor:,.0f}? Happy to move quickly if we're close."
        )
    else:
        reply = (
            f"Hi — still available? I've been comparing similar listings and they're running around "
            f"{range_str}. Would you be open to ${anchor:,.0f}?"
        )
    return {
        "reply": reply,
        "suggested_price_cents": int(round(anchor * 100)) if anchor else None,
        "should_accept": False,
        "tone": "friendly",
        "next_move_hint": "Wait for their counter — stay friendly and patient.",
    }


def build_fallback_negotiation(verdict_data: dict) -> dict:
    """Deterministic playbook for when the negotiation LLM returns garbage.

    Keeps the /negotiate endpoint useful during provider outages by serving a
    structurally correct playbook built from the deterministic anchors rather
    than 502'ing the extension / web app.
    """
    fair_low = verdict_data.get("fair_price_low", 0) / 100
    fair_high = verdict_data.get("fair_price_high", 0) / 100
    fair_mid = verdict_data.get("fair_price_mid", 0) / 100
    anchor_target = verdict_data.get("target_price", 0) / 100
    anchor_walkaway = verdict_data.get("walk_away_above", 0) / 100
    quoted = (verdict_data.get("quoted_price") or 0) / 100
    domain = verdict_data.get("domain", "retail")
    tactics_for_domain = DOMAIN_TACTICS.get(domain, DOMAIN_TACTICS["auto"])
    tactics = [
        {"name": name, "description": f"Use this alongside the ${anchor_target:,.0f} anchor — keep the fair range (${fair_low:,.0f}–${fair_high:,.0f}) in every message."}
        for name in tactics_for_domain[:6]
    ]
    scripts = [
        {"role": "you_opening", "text": f"Hi! I'm interested — I've been comparing similar listings around ${fair_low:,.0f}–${fair_high:,.0f}. Would ${anchor_target:,.0f} work for you?"},
        {"role": "them_pushback", "text": f"Likely reply: 'price is firm' / 'others offered more'. Don't engage the anchor battle — acknowledge and return to comps."},
        {"role": "you_evidence", "text": f"Totally fair, and I get that. I'm seeing comparable ones listed between ${fair_low:,.0f} and ${fair_high:,.0f}. I can do ${anchor_target:,.0f} today — cash / pickup / however works."},
        {"role": "them_partial", "text": f"They come down partway — often to ${fair_high:,.0f} or just above. Pause before replying."},
        {"role": "you_final_offer", "text": f"Appreciate you moving. My best is ${anchor_target:,.0f}. If that doesn't work I totally understand — I have another option lined up."},
        {"role": "them_accepts_or_stalls", "text": "If they accept: confirm pickup time + condition in writing. If they stall overnight: message the alternative."},
        {"role": "you_walkaway", "text": f"Thanks for the back-and-forth. Going to pass at ${quoted:,.0f} — best of luck with the sale!"},
        {"role": "you_followup", "text": "If they message back later: politely re-open at your original anchor, not higher."},
    ]
    return {
        "scripts": scripts,
        "tactics": tactics,
        "evidence_summary": (
            f"Fair range is ${fair_low:,.0f}–${fair_high:,.0f} (median ${fair_mid:,.0f}). "
            f"Anchor at ${anchor_target:,.0f}, walk away above ${anchor_walkaway:,.0f}."
        ),
        "_fallback": True,
    }


async def generate_counter_response(
    query_text: str,
    verdict_data: dict,
    counter_offer: int,
    original_negotiation: dict,
    currency: str = "USD",
    provider: str | None = None,
) -> dict:
    """Generate a response to a vendor's counter-offer."""
    fair_low = verdict_data.get("fair_price_low", 0) / 100
    fair_high = verdict_data.get("fair_price_high", 0) / 100
    counter_display = counter_offer / 100
    target = original_negotiation.get("target_price", 0) / 100
    # Calculate where the counter sits relative to fair range
    fair_mid = (fair_low + fair_high) / 2
    counter_vs_fair = "below" if counter_display <= fair_high else "above"
    gap = abs(counter_display - target)

    prompt = f"""You are a negotiation coach analyzing a vendor's counter-offer in real-time.

SITUATION: {query_text}
FAIR MARKET RANGE: ${fair_low:,.0f} – ${fair_high:,.0f}
YOUR TARGET PRICE: ${target:,.0f}
THEIR COUNTER-OFFER: ${counter_display:,.0f} ({counter_vs_fair} fair range, ${gap:,.0f} gap from your target)

DECISION FRAMEWORK:
- Counter ≤ fair_high (${fair_high:,.0f})? → ACCEPT. You won. Lock it in writing.
- Counter ≤ 10% above fair_high? → ACCEPT with conditions (warranty, timeline, extras).
- Counter > 10% above fair_high? → REJECT. Counter with ${fair_mid:,.0f}–${fair_high:,.0f}.
- They haven't moved from original? → Signal willingness to walk. Mention specific alternative.

Return ONLY valid JSON:
{{
  "should_accept": boolean,
  "response_script": "Exact words to say — 2-3 sentences, confident and natural. If accepting, ask for written confirmation and warranty details. If rejecting, make a specific counter-offer with reasoning.",
  "reasoning": "Brief analysis: where does their counter sit vs fair range? Is the gap worth fighting over?",
  "suggested_counter": int (in cents — your next offer if rejecting, or 0 if accepting),
  "extras_to_request": ["if accepting or close to accepting, list 2-3 extras to negotiate: warranty, timeline, free follow-up, etc."]
}}

Use $ for all prices. Be practical — a deal within 10% of fair_high is often worth taking
to avoid the hassle of starting over elsewhere."""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="fast",
        max_tokens=800,
    )
    return _parse_json(text)


async def extract_from_image(
    image_base64: str,
    provider: str | None = None,
    media_type: str = "image/jpeg",
) -> str:
    """Extract text/prices from a bill/invoice/receipt photo."""
    return await analyze_image(
        image_base64=image_base64,
        prompt="""Analyze this bill, invoice, receipt, or quote image.
Extract all relevant information: services listed, prices, totals, vendor name, date.
Return the extracted information as a natural language description that a consumer
could use to get a price check. Include all prices and service descriptions.""",
        provider=provider,
        media_type=media_type,
    )


def _format_knowledge(data: list[dict]) -> str:
    if not data:
        return "No knowledge base data available."
    lines = []
    for item in data[:10]:
        low = item.get("price_low", 0) / 100
        high = item.get("price_high", 0) / 100
        sym = "$"
        meta = item.get("metadata", {}) or {}
        lines.append(
            f"- {item['item_name']}: {sym}{low:,.0f}–{sym}{high:,.0f} "
            f"({item.get('city', 'national')}, {item.get('country')}) "
            f"[source: {item.get('source', 'unknown')}] "
            f"[{meta.get('type', 'general')}]"
        )
    return "\n".join(lines)


def _format_web_results(results: list[dict]) -> str:
    if not results:
        return "No web search results available — verdict will have low confidence."
    lines = []
    for r in results[:8]:
        content = r.get('content', '')[:400]
        url = r.get('url', '')
        parts = url.split('/') if url else []
        source = parts[2] if len(parts) > 2 and parts[2] else 'unknown'
        lines.append(f"- [{source}] {r.get('title', 'untitled')}: {content}")
    return "\n".join(lines)


def _format_evidence_sources(sources: list[dict]) -> str:
    """Format structured ExtractedPrice records for the narrative LLM prompt.

    Shows the LLM *only* the per-source evidence that feeds the range — domain,
    the exact price, locality, trust, and the snippet. This is what the LLM is
    allowed to cite; anything outside this list is fabrication.
    """
    if not sources:
        return "No structured evidence — narrative will be generic."
    lines = []
    for s in sources[:12]:
        price_cents = s.get("price_cents", 0) or 0
        price_dollars = price_cents / 100
        local_tag = " [local]" if s.get("is_local") else ""
        trust = s.get("trust_weight", 0)
        kind = s.get("price_type", "unknown")
        snippet = (s.get("snippet") or "")[:200]
        lines.append(
            f"- {s.get('domain', '?')} (trust={trust}){local_tag}: "
            f"${price_dollars:,.0f} [{kind}] — {snippet}"
        )
    return "\n".join(lines)
