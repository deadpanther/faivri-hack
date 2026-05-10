import uuid as _uuid

def _uuid_str():
    """Return a UUID as string (SQLite-safe)."""
    return str(_uuid.uuid4())
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, Text, Numeric, Boolean, DateTime, ForeignKey, Index,
    UniqueConstraint, JSON, CHAR,
)
from sqlalchemy.dialects.postgresql import UUID as _PG_UUID, ENUM as PG_ENUM
from sqlalchemy.types import TypeDecorator


class _UUIDString(TypeDecorator):
    """SQLite-compatible UUID column.

    The SQLite driver (aiosqlite) can't bind a `uuid.UUID` parameter — it
    raises `type 'UUID' is not supported`. Callers in this codebase routinely
    pass UUID instances (e.g. `uuid.uuid4()`, `uuid.UUID(user_id)`), so we
    coerce on bind and surface the canonical 36-char string on read. This
    type is only used when DATABASE_URL points at SQLite; Postgres keeps
    using the native `UUID` type below.
    """

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, _uuid.UUID):
            return str(value)
        return str(value)

    def process_result_value(self, value, dialect):
        return value


# JSONB for Postgres, JSON for everything else (SQLite)
try:
    from sqlalchemy.dialects.postgresql import JSONB as _JSONB
    from app.config import settings
    _JSON = _JSONB if not settings.database_url.startswith("sqlite") else JSON
    if settings.database_url.startswith("sqlite"):
        def _UUID(**kwargs):
            """SQLite-compatible UUID: accepts UUID or str, stores as 36-char string."""
            return _UUIDString()
    else:
        _UUID = _PG_UUID
except Exception:
    _JSON = JSON
    def _UUID(**kwargs):
        return _UUIDString()
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


# Enums: PG_ENUM for Postgres, String for SQLite
from app.config import settings as _settings
_use_pg_enum = not _settings.database_url.startswith("sqlite")

if _use_pg_enum:
    domain_enum = PG_ENUM("auto", "medical", "home", "legal", "retail", name="domain_type", create_type=True)
    verdict_enum = PG_ENUM("fair", "high", "overcharge", name="verdict_type", create_type=True)
    currency_enum = PG_ENUM("INR", "USD", name="currency_type", create_type=True)
    country_enum = PG_ENUM("IN", "US", name="country_type", create_type=True)
else:
    domain_enum = String(16)
    verdict_enum = String(16)
    currency_enum = String(3)
    country_enum = String(2)


class Profile(Base):
    __tablename__ = "profiles"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    clerk_user_id = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=True)
    city = Column(String, nullable=True)
    country = Column(country_enum, nullable=True)
    queries_this_month = Column(Integer, default=0)
    total_saved = Column(Integer, default=0)
    # Plan key matches app/services/quota.PLAN_LIMITS. Users start on "scout"
    # until a Lemon Squeezy webhook upgrades them.
    plan = Column(String, nullable=False, default="scout")
    # When usage_reset_at is in the past, quota.check_and_consume() resets
    # queries_this_month to 0 before checking the cap. Set to the first of
    # next month on each reset so monthly quotas roll forward cleanly.
    usage_reset_at = Column(DateTime, nullable=True)
    # Set from the Lemon Squeezy webhook so we can look up a user by their
    # subscription when updates arrive (cancel / upgrade / renewal).
    # Kept for back-compat with any historical rows; new payments use Stripe.
    lemonsqueezy_subscription_id = Column(String, nullable=True, index=True)
    # Stripe identifiers — written by the Stripe webhook on
    # checkout.session.completed and customer.subscription.* events.
    # Either may be NULL: a Boost-only customer has a customer_id but no
    # subscription_id; a customer who cancels has the sub_id cleared.
    stripe_customer_id = Column(String, nullable=True, index=True)
    stripe_subscription_id = Column(String, nullable=True, index=True)
    # One-time "Boost Pack" credits. Decremented before hitting the monthly
    # plan cap so a user who tops up on a busy month isn't forced into a
    # plan upgrade. Webhook-credited; never expires.
    boost_credits = Column(Integer, nullable=False, default=0, server_default="0")
    # Set by the .edu OTP verification flow to now + 120 days. While in the
    # future, Lemon Squeezy checkout hands back a 50% off variant and the
    # pricing page shows the scholar price. Re-verify each semester to extend.
    student_discount_until = Column(DateTime, nullable=True)
    # Hash of the verified .edu email (sha256). Stored so we can detect a
    # single school address rotating through multiple Clerk accounts and
    # rate-limit repeat verifications.
    student_email_hash = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    queries = relationship("Query", back_populates="user")


class Query(Base):
    __tablename__ = "queries"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    domain = Column(domain_enum, nullable=False)
    input_text = Column(Text, nullable=False)
    location_city = Column(String, nullable=False)
    location_country = Column(country_enum, nullable=False)
    currency = Column(currency_enum, nullable=False)
    quoted_price = Column(Integer, nullable=True)
    fair_price_low = Column(Integer, nullable=True)
    fair_price_high = Column(Integer, nullable=True)
    verdict = Column(verdict_enum, nullable=True)
    overcharge_multiplier = Column(Numeric(5, 2), nullable=True)
    confidence_score = Column(Integer, nullable=True)
    data_points_count = Column(Integer, nullable=True)
    explanation = Column(Text, nullable=True)
    red_flags = Column(_JSON, nullable=True)
    questions_to_ask = Column(_JSON, nullable=True)
    negotiation_script = Column(_JSON, nullable=True)
    sources_used = Column(_JSON, nullable=True)
    llm_model_used = Column(String, nullable=True)
    cost_cents = Column(Integer, nullable=True)
    feedback_final_price = Column(Integer, nullable=True)
    s2_token = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("Profile", back_populates="queries")

    __table_args__ = (
        Index("idx_queries_user_history", "user_id", "created_at"),
    )


class PricingKnowledge(Base):
    __tablename__ = "pricing_knowledge"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    domain = Column(domain_enum, nullable=False)
    category = Column(String, nullable=False)
    item_name = Column(String, nullable=False)
    item_description = Column(Text, nullable=True)
    price_low = Column(Integer, nullable=False)
    price_high = Column(Integer, nullable=False)
    currency = Column(currency_enum, nullable=False)
    city = Column(String, nullable=True)
    country = Column(country_enum, nullable=False)
    source = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    confidence = Column(Integer, default=80)
    extra_metadata = Column("metadata", _JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_pricing_lookup", "domain", "country", "city", "category"),
    )


class CommunityPrice(Base):
    __tablename__ = "community_prices"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    # Enforce one canonical community row per source query. Prevents feedback
    # double-submits from inflating community counts or distorting vendor
    # statistics (DATA-P1-01).
    query_id = Column(
        _UUID(as_uuid=True),
        ForeignKey("queries.id"),
        nullable=True,
        unique=True,
        index=True,
    )
    domain = Column(domain_enum, nullable=False)
    service_type = Column(String, nullable=False)
    # Canonical service keys (LIVE-P1-10). `canonical_service` is a human-ish
    # normalized string ("brake pads replacement civic"), `service_fingerprint`
    # is the sort-order-stable join key the community loader matches on.
    # Both are nullable so pre-existing rows don't need a backfill — the loader
    # falls back to token-overlap when fingerprint is null.
    canonical_service = Column(String, nullable=True)
    service_fingerprint = Column(String, nullable=True, index=True)
    description = Column(Text, nullable=True)
    price_paid = Column(Integer, nullable=False)
    currency = Column(currency_enum, nullable=False)
    city = Column(String, nullable=False)
    country = Column(country_enum, nullable=False)
    vendor_name = Column(String, nullable=True)
    s2_token = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_community_lookup", "domain", "city", "country"),
    )


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=False)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    year = Column(Integer, nullable=True)
    mileage_km = Column(Integer, nullable=True)
    nickname = Column(String, nullable=True)
    country = Column(country_enum, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_vehicles_user", "user_id"),
    )


class PurchaseAnalysis(Base):
    """Durable record of a used-car purchase analysis (FE-P1-02).

    The previous flow serialized the entire result into a URL query param on
    client-side navigation — one browser refresh away from losing the user's
    work. We persist the payload here and hand the frontend a UUID to fetch by.
    """
    __tablename__ = "purchase_analyses"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    year = Column(Integer, nullable=False)
    mileage_km = Column(Integer, nullable=False)
    asking_price = Column(Integer, nullable=False)
    vin = Column(String(17), nullable=True)
    city = Column(String, nullable=True)
    country = Column(country_enum, nullable=False)
    payload = Column(_JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_purchase_analyses_user", "user_id", "created_at"),
        Index("idx_purchase_analyses_vin", "vin"),
    )


class NegotiationConversation(Base):
    """Persistent chat log for the conversational negotiation coach.

    The extension + web app send a `session_id` (generated client-side) so a
    single verdict can have multiple parallel conversations (e.g. negotiating
    with two different sellers on the same listing type). The `messages`
    array is the full ordered history; each turn is appended server-side
    after the LLM responds. Anonymous rows (user_id IS NULL) are readable
    by anyone holding both query_id + session_id — an unguessable
    capability, same model as anonymous query verdict handles.
    """
    __tablename__ = "negotiation_conversations"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    query_id = Column(_UUID(as_uuid=True), ForeignKey("queries.id"), nullable=False, index=True)
    session_id = Column(String, nullable=False)
    # messages: [{"role": "user"|"assistant", "content": "...", "at": iso}]
    messages = Column(_JSON, nullable=False, default=list)
    # Last suggested price (cents) — kept at top-level for quick aggregates.
    last_suggested_price = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_negotiation_conversations_query", "query_id", "session_id", unique=True),
        Index("idx_negotiation_conversations_user", "user_id", "created_at"),
    )


class CounterOffer(Base):
    """Persisted counter-offers from /negotiate/counter.

    Two reasons this table exists:

    - Cost: short-window dedupe on (query_id, counter_offer_cents) lets us skip
      the LLM call when a user re-tries the same hypothetical. The endpoint
      checks for a row younger than COUNTER_OFFER_CACHE_TTL and returns the
      stored payload verbatim.

    - History: every counter-offer the user explores is part of the
      negotiation transcript. Storing them powers the "what they said / what
      I countered" timeline on the verdict page.

    Anonymous queries are allowed (user_id NULL) — same shared-handle model
    as NegotiationConversation. The query_id is the capability.
    """
    __tablename__ = "counter_offers"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    query_id = Column(_UUID(as_uuid=True), ForeignKey("queries.id"), nullable=False)
    counter_offer_cents = Column(Integer, nullable=False)
    original_target_cents = Column(Integer, nullable=False)
    # Full CounterOfferResponse payload (should_accept, response_script,
    # reasoning, suggested_counter). Stored verbatim so reads avoid re-running
    # the LLM and the schema can evolve without a backfill.
    response_payload = Column(_JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_counter_offers_query_created", "query_id", "created_at"),
        Index(
            "idx_counter_offers_dedupe",
            "query_id", "counter_offer_cents", "created_at",
        ),
    )


class WaitlistEntry(Base):
    """Marketing-site waitlist signup. Email is the natural unique key."""
    __tablename__ = "waitlist_entries"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    email = Column(String, unique=True, nullable=False, index=True)
    source = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ShareToken(Base):
    """Public capability token for sharing a verdict on social platforms.

    A user clicks "Share" on `/result/[id]` or `/result/purchase/[slug]`; we
    mint an unguessable token that points at the underlying record and store
    it here. The public read route `GET /share/{token}` returns a sanitized
    payload (no receipt text, no user_id, no PII) — only the headline figures
    a reader needs to decide whether to try Faivri themselves.

    Either `query_id` OR `purchase_id` is populated, never both. Tokens default
    to a 30-day TTL so a forgotten share doesn't keep a stale verdict findable
    indefinitely. `view_count` is a cheap signal we surface back to the owner
    on the Vault page (out of scope for the initial ship but reserved here).
    """
    __tablename__ = "share_tokens"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    token = Column(String(40), nullable=False, unique=True, index=True)
    kind = Column(String(16), nullable=False)  # "query" | "purchase"
    query_id = Column(_UUID(as_uuid=True), ForeignKey("queries.id"), nullable=True)
    purchase_id = Column(_UUID(as_uuid=True), ForeignKey("purchase_analyses.id"), nullable=True)
    owner_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, nullable=False, default=0)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_share_tokens_query", "query_id"),
        Index("idx_share_tokens_purchase", "purchase_id"),
        Index("idx_share_tokens_owner", "owner_id", "created_at"),
    )


class ListingWatch(Base):
    """Extension Pro — stale-listing watch records.

    Each row is a single listing the user wants pinged on. A background worker
    (out of scope for the initial ship, tracked in docs/EXTENSION_PRO.md) will
    periodically scrape `listing_url` via Firecrawl, compare against
    `last_known_price`, and emit a push notification via the extension's
    service worker when the price drops or the listing crosses the domain
    median age.
    """
    __tablename__ = "listing_watches"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    query_id = Column(_UUID(as_uuid=True), ForeignKey("queries.id"), nullable=True)
    listing_url = Column(String, nullable=False)
    platform = Column(String, nullable=True)  # "ebay" | "facebook" | other
    fair_high_cents = Column(Integer, nullable=True)
    last_known_price_cents = Column(Integer, nullable=True)
    # Snapshot of seller risk at watch creation — used in notification copy.
    initial_risk_score = Column(Integer, nullable=True)
    status = Column(String, nullable=False, default="active")  # active | paused | triggered | expired
    next_check_at = Column(DateTime, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_listing_watches_user", "user_id", "created_at"),
        Index("idx_listing_watches_next_check", "status", "next_check_at"),
    )


class WebhookEvent(Base):
    """Idempotency log for subscription webhook deliveries.

    Providers (Lemon Squeezy today, Stripe next) retry on any non-2xx, so
    the handler must dedupe or a plan transition can apply twice (e.g. a
    retry after transient DB error re-downgrades a user who already
    re-subscribed). The (provider, event_id) unique constraint turns the
    second insert into an IntegrityError that we catch as "already
    processed, 204 immediately".
    """

    __tablename__ = "webhook_events"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    provider = Column(String, nullable=False)
    event_id = Column(String, nullable=False)
    event_name = Column(String, nullable=True)
    payload = Column(_JSON, nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_webhook_events_provider_event"),
        Index("idx_webhook_events_received", "provider", "received_at"),
    )


class WebhookFailure(Base):
    """Dead-letter landing for webhook deliveries that crashed mid-apply.

    If the handler raises past idempotency insert but before committing
    the plan transition, the event would normally vanish after LS's retry
    window closes. The failure row preserves the raw payload so an
    operator can replay manually or patch + retry. `resolved_at` is set
    once the ops job has dealt with the row.
    """

    __tablename__ = "webhook_failures"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    provider = Column(String, nullable=False)
    event_id = Column(String, nullable=True)
    event_name = Column(String, nullable=True)
    payload = Column(_JSON, nullable=True)
    error = Column(Text, nullable=False)
    received_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_webhook_failures_unresolved", "provider", "resolved_at"),
    )


class ProfileSession(Base):
    """Active Clerk sessions per profile. Used to enforce the
    MAX_ACTIVE_SESSIONS cap (2) — on new login, oldest session is revoked
    via the Clerk Backend API so a shared account can't balloon across
    every device on the street.

    `clerk_session_id` is the `sid` claim from the Clerk JWT. Rows are
    upserted on every authed request (touching `last_seen_at`) so "oldest"
    is measured by activity, not raw creation time — a long-idle session
    gets evicted before an actively-used one.
    """

    __tablename__ = "profile_sessions"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=False)
    clerk_session_id = Column(String, nullable=False, unique=True, index=True)
    user_agent = Column(String, nullable=True)
    first_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_profile_sessions_user_active", "user_id", "revoked_at", "last_seen_at"),
    )


class ExtensionDeviceToken(Base):
    """Long-lived bearer token issued to a specific browser install after the
    user pairs the extension from a signed-in faivri.com session.

    Raw token format: `fvt_<32 url-safe bytes>`. We only persist the sha256
    hash; the raw token is shown to the extension exactly once at pairing
    time. Tokens are scoped to a single Profile (`user_id`) and revocable
    independently of the user's Clerk session.
    """

    __tablename__ = "extension_device_tokens"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=False)
    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    label = Column(String(128), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_extension_tokens_user_active", "user_id", "revoked_at"),
    )


class NegotiationSession(Base):
    """HydraDB — durable negotiation memory header.

    Backs `app.services.hydradb`. One row per active negotiation (keyed
    by `query_id`). The `price_points` _JSON array is the append-only
    timeline of every counter-offer or seller message that landed on a
    number — the Memory dashboard renders the fluctuation curve directly
    off this column.

    `seller_tone` is set by Photon when it labels an inbound seller
    message (polite / firm / aggressive / flexible / unclear). Future
    reply drafts read it back to keep the user from sounding too soft
    against a hostile counterparty or too aggressive against a flexible
    one.
    """

    __tablename__ = "negotiation_sessions"

    id = Column(_UUID(as_uuid=True), primary_key=True, default=_uuid_str)
    user_id = Column(_UUID(as_uuid=True), ForeignKey("profiles.id"), nullable=True)
    query_id = Column(
        _UUID(as_uuid=True),
        ForeignKey("queries.id"),
        nullable=False,
        unique=True,
    )
    walk_away_cents = Column(Integer, nullable=True)
    target_offer_cents = Column(Integer, nullable=True)
    seller_tone = Column(String(32), nullable=True)
    price_points = Column(_JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("idx_negotiation_sessions_user_recent", "user_id", "last_seen_at"),
    )


class ExtensionPairCode(Base):
    """Short-lived rendezvous row used to hand off a device token from the
    web app to a Chrome extension install during pairing.

    Lifecycle:
      1. Extension generates a random `code`, POSTs to /extension/device/start.
      2. User opens https://faivri.com/extension/link?code=<code> in a tab.
      3. The signed-in web app POSTs /extension/device/pair which sets
         `user_id` and `paired_at` + mints a device token, storing its
         hash on the row as `device_token_hash`.
      4. The extension polls /extension/device/poll?code=<code> and, on
         seeing `paired_at`, exchanges the code for the raw token, after
         which we set `claimed_at` and the row is consumed.
    """

    __tablename__ = "extension_pair_codes"

    code = Column(String(64), primary_key=True)
    user_id = Column(_UUID(as_uuid=True), nullable=True)
    device_token_hash = Column(String(128), nullable=True)
    user_agent = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    paired_at = Column(DateTime, nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("idx_extension_pair_codes_expires", "expires_at"),
    )
