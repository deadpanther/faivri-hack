import re

from pydantic import BaseModel, Field, UUID4, field_validator
from typing import Literal, Optional
from datetime import datetime


# Upper bound on any user-supplied monetary value (in smallest currency unit).
# 1e10 = ₹1 crore / $100M in cents — comfortably above any real quote, well
# below int32 overflow so arithmetic in the savings pipeline can't wrap.
MAX_PRICE_SMALLEST_UNIT = 10_000_000_000

FeedbackOutcome = Literal[
    "negotiated_down", "paid_full", "walked_away", "found_alternative"
]

# Control characters except TAB/LF/CR. Stripping these defends LLM prompts
# against smuggled NUL bytes, bidi overrides, and terminal escape sequences.
_CTRL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_user_text(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    cleaned = _CTRL_CHARS.sub("", raw).strip()
    # Collapse any run of whitespace > 3 newlines to 2 — prevents prompt
    # injection via "\n\n\n\nASSISTANT:" style hijack attempts.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


class AnalyzeRequest(BaseModel):
    query: str = Field(..., min_length=10, max_length=2000)
    lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    lng: Optional[float] = Field(None, ge=-180.0, le=180.0)
    city: Optional[str] = Field(None, max_length=120)
    country: Optional[str] = Field(None, max_length=8)
    domain: Optional[str] = Field(None, max_length=32)
    quoted_price: Optional[int] = Field(None, ge=0, le=MAX_PRICE_SMALLEST_UNIT)
    provider: Optional[str] = Field(None, max_length=32)

    @field_validator("query")
    @classmethod
    def _clean_query(cls, v: str) -> str:
        cleaned = _clean_user_text(v) or ""
        if len(cleaned) < 10:
            raise ValueError("query must contain at least 10 non-whitespace characters")
        return cleaned


class VerdictResponse(BaseModel):
    id: str
    verdict: str
    overcharge_multiplier: float
    fair_price_low: int
    fair_price_mid: int = 0
    fair_price_high: int
    conservative_overpay: int = 0
    expected_overpay: int = 0
    currency: str
    confidence_score: int
    data_points_count: int
    explanation: str
    red_flags: list[str]
    questions_to_ask: list[str]
    sources: dict
    evidence: Optional[dict] = None
    domain: str
    location_city: str
    location_country: str
    quoted_price: Optional[int] = None
    freshness: Optional[dict] = None  # {source, live_search, fetched_at, web_results_count}
    created_at: Optional[datetime] = None


class NegotiateRequest(BaseModel):
    query_id: UUID4


class NegotiateResponse(BaseModel):
    target_price: int
    walk_away_above: int
    currency: str
    scripts: list[dict]
    tactics: list[dict]
    evidence_summary: Optional[str] = ""
    quoted_price: Optional[int] = None
    domain: Optional[str] = "auto"
    # Freshness block (LIVE-P1-07) — tells the frontend when the prices
    # driving the scripts were last verified so it can render "checked X
    # minutes ago" and signal a refresh happened server-side.
    freshness: Optional[dict] = None


class NegotiationChatMessage(BaseModel):
    """Single turn in the conversational negotiation chat.

    `user` = the buyer (our customer), `seller` = the counterparty's quoted
    message, `assistant` = the AI coach's suggested reply. Clients render
    the three differently — collapsing seller and coach to one role left
    the timeline ambiguous.
    """
    role: str = Field(..., pattern="^(user|seller|assistant)$")
    content: str
    at: Optional[str] = None


class NegotiationChatRequest(BaseModel):
    """Extension / web chat turn.

    `session_id` is generated client-side (UUID) so one verdict can host many
    parallel chats (one per seller). `seller_message` is optional because the
    first turn is frequently a user-side prompt like "what do I open with" —
    the LLM handles both cases.
    """
    query_id: UUID4
    session_id: str = Field(..., min_length=6, max_length=128)
    seller_message: Optional[str] = Field(None, max_length=4000)
    user_message: Optional[str] = Field(None, max_length=4000)

    @field_validator("seller_message", "user_message")
    @classmethod
    def _clean_messages(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _clean_user_text(v)
        return cleaned or None


class NegotiationChatResponse(BaseModel):
    reply: str
    suggested_price_cents: Optional[int] = None
    should_accept: bool = False
    tone: Optional[str] = None
    session_id: str
    messages: list[NegotiationChatMessage]


class CounterOfferResponse(BaseModel):
    """Counter-offer shape contract (API-P1-03).

    Previously the LLM's raw JSON was returned as-is; if the model forgot
    `suggested_counter` or `response_script`, the frontend rendered `NaN`.
    We now require all four fields at the API boundary. When the LLM
    produces a partial response the router catches ValidationError and
    returns 502 instead of a broken payload.
    """
    should_accept: bool
    response_script: str = Field(..., min_length=1)
    reasoning: str = Field(..., min_length=1)
    suggested_counter: int = Field(..., ge=0)


class FeedbackRequest(BaseModel):
    query_id: UUID4
    final_price: int = Field(..., ge=0, le=MAX_PRICE_SMALLEST_UNIT)
    outcome: FeedbackOutcome
    vendor_name: Optional[str] = Field(None, max_length=200)


class HistoryItem(BaseModel):
    id: str
    domain: str
    input_text: str
    location_city: str
    location_country: str
    currency: str
    verdict: Optional[str] = None
    overcharge_multiplier: Optional[float] = None
    fair_price_low: Optional[int] = None
    fair_price_high: Optional[int] = None
    quoted_price: Optional[int] = None
    feedback_final_price: Optional[int] = None
    created_at: Optional[datetime] = None


class SavingsSummary(BaseModel):
    total_saved: int
    total_queries: int
    overcharges_found: int
    currency: str


class StreakBlock(BaseModel):
    """Streak payload returned by POST /feedback — drives the celebration UI."""
    monthly_dodged: int
    lifetime_saved: int
    level: str
    milestone_unlocked: Optional[str] = None


class FeedbackResponse(BaseModel):
    status: str
    message: str
    savings: int
    currency: str
    streak: Optional[StreakBlock] = None


class SavingsProfile(BaseModel):
    """Full shape consumed by the vault/profile page (API-P1-01)."""
    lifetime_saved: int
    potential_saved: int
    monthly_streak: int
    total_queries: int
    overcharges_found: int
    level: str
    level_label: str
    next_level: Optional[str] = None
    next_level_label: Optional[str] = None
    next_level_threshold: int
    progress_to_next: int
    currency: str
