from pydantic import ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://localhost:5432/faircheck"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    tavily_api_key: str = ""
    # Firecrawl powers the Extension Pro add-on (Seller Risk Score + Stale-Listing
    # watch). Tavily stays primary for price comps; Firecrawl is used where we
    # need structured extraction from a specific URL the user is viewing.
    firecrawl_api_key: str = ""

    # ─── Hackathon sponsor integrations (Nozomio AI Nexus) ──────────────
    # Nia: agentic search for pricing context (mandatory for all tracks).
    nia_api_key: str = ""
    nia_api_url: str = "https://apigcp.trynia.ai/v2"
    # Hyperspell: durable negotiation memory across sessions (Company Brain track).
    hyperspell_api_key: str = ""
    hyperspell_api_url: str = "https://api.hyperspell.com"
    # Tensorlake: background price monitoring sandbox (Always-On track).
    tensorlake_api_key: str = ""
    tensorlake_api_url: str = "https://api.tensorlake.ai"

    # ─── LLM inference ─────────────────────────────────────────────────
    # The legacy GPU adapter (now wraps Anthropic/OpenAI directly).
    gmi_cloud_api_key: str = ""
    # Negotiation memory feature flag (backed by Postgres).
    hydradb_enabled: bool = True

    upstash_redis_url: str = ""
    clerk_publishable_key: str = ""
    # Comma-separated extra hostname suffixes trusted as Clerk JWT issuers.
    # Prod Clerk signs tokens with `iss=https://clerk.<your-domain>`, so the
    # custom domain suffix (e.g. ".faivri.com") must be listed here.
    clerk_allowed_issuer_hosts: str = ""
    cors_origins: str = "http://localhost:3000"
    default_provider: str = "anthropic"
    admin_api_key: str = ""

    # Lemon Squeezy webhook signing secret + variant→plan mapping.
    # Variants are the Lemon Squeezy variant IDs (stringified int) from the
    # store dashboard; missing entries keep a user on the Scout (free) plan.
    lemonsqueezy_signing_secret: str = ""
    lemonsqueezy_variant_signal: str = ""
    lemonsqueezy_variant_signal_scholar: str = ""
    lemonsqueezy_variant_command: str = ""
    lemonsqueezy_variant_command_scholar: str = ""
    # Boost Pack = one-time top-up that adds 10 analyses to the buyer's
    # profile regardless of which plan they're on. Fired as `order_created`
    # on the LS webhook rather than a subscription event.
    lemonsqueezy_variant_boost: str = ""
    boost_pack_credits: int = 10
    boost_pack_price_cents: int = 499
    # Public Lemon Squeezy checkout URL for the Boost Pack. Built once in
    # the dashboard; frontend and extension both open it in a new tab
    # with the signed-in user's Clerk id in custom_data.
    lemonsqueezy_boost_checkout_url: str = ""

    # Resend API key for transactional email (student OTP, session-evict
    # notifications). Empty = email sending is disabled and routes that need
    # it return 503.
    resend_api_key: str = ""
    resend_from_email: str = "Faivri <onboarding@faivri.com>"

    # Clerk Backend API secret (sk_live_... / sk_test_...) — used to revoke
    # the oldest session when a user exceeds the MAX_ACTIVE_SESSIONS cap.
    # Different from the JWT issuer hosts; that one's for inbound token
    # verification. Empty = session cap is enforced DB-side but revoke
    # calls are skipped (the stale session will simply 401 once it tries
    # to hit us again).
    clerk_secret_key: str = ""
    max_active_sessions: int = 2

    # Hard daily ceiling for anonymous /analyze traffic. The slowapi default
    # of 120/min per IP still applies, but real abuse is metered in requests
    # per day, not per minute. Redis-backed so it works across replicas.
    anonymous_analyze_daily_cap: int = 20

    # Global monthly ceiling on Tavily searches. Tavily's dev tier is 1000/mo;
    # we cap at 800 to leave 200-call headroom for spikes / retries between
    # the cap firing and an operator intervening. Set 0 to disable.
    tavily_monthly_search_cap: int = 800

    # Number of trusted reverse proxies (edge + internal LBs) between the
    # internet and this process. Used to peel spoofable leftmost values off
    # X-Forwarded-For. Railway's single edge = 1. Local dev = 0.
    trusted_proxy_hops: int = 1

    # Reject Lemon Squeezy webhook deliveries whose `data.attributes.created_at`
    # is older than this many minutes. Bounds the replay window even if the
    # webhook_events idempotency log is ever cleared.
    webhook_max_age_minutes: int = 15

    # ─── Stripe ───────────────────────────────────────────────────────────
    # Stripe replaces Lemon Squeezy for payments. Live keys go in Railway prod;
    # signing secret is set after the webhook endpoint is created in Stripe
    # Dashboard. Empty signing secret = webhook handler 401s every delivery.
    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_signing_secret: str = ""
    stripe_price_signal_monthly: str = ""
    stripe_price_signal_yearly: str = ""
    stripe_price_signal_scholar_monthly: str = ""
    stripe_price_signal_scholar_yearly: str = ""
    stripe_price_command_monthly: str = ""
    stripe_price_command_yearly: str = ""
    stripe_price_command_scholar_monthly: str = ""
    stripe_price_command_scholar_yearly: str = ""
    stripe_price_boost: str = ""
    # Public site origin used for Stripe Checkout success_url + cancel_url.
    public_site_url: str = "https://faivri.com"

    @property
    def cors_origin_list(self) -> list[str]:
        # Filter out empty entries so a trailing comma in CORS_ORIGINS doesn't
        # add "" as a matchable origin (some bots send Origin: "").
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    model_config = ConfigDict(env_file=".env")


settings = Settings()
