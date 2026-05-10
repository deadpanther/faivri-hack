# FairCheck Backend Documentation

## Overview

Python 3.13 FastAPI backend providing AI-powered consumer price analysis. Uses live web search (Tavily) as the primary pricing source, with PostgreSQL as a supplementary fallback. Supports dual LLM providers (Anthropic Claude + OpenAI) switchable per-request.

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | FastAPI | 0.115.0 |
| Server | Uvicorn | 0.30.0 |
| ORM | SQLAlchemy (async) | 2.0.35 |
| DB Driver | asyncpg | 0.30.0 |
| Migrations | Alembic | 1.14.0 |
| Validation | Pydantic | 2.9.0 |
| HTTP Client | httpx | 0.27.0 |
| LLM (Primary) | Anthropic SDK | 0.39.0 |
| LLM (Alt) | OpenAI SDK | >=1.30.0 |
| Cache | Redis (Upstash) | 5.1.0 |
| Auth | Clerk (JWT) | via PyJWT 2.9.0 |

## Directory Structure

```
backend/
├── app/
│   ├── main.py                     # FastAPI entry point, lifespan, CORS, router mounts
│   ├── config.py                   # Pydantic settings, env var definitions
│   ├── models/
│   │   ├── db.py                   # 5 SQLAlchemy ORM tables
│   │   ├── schemas.py             # Pydantic request/response models
│   │   └── enums.py               # Domain, Verdict, Country, Currency enums
│   ├── routers/                    # 7 API routers (mounted at /api/v1)
│   │   ├── analyze.py             # Text/image/voice analysis + provider list
│   │   ├── negotiate.py           # Negotiation scripts + counter-offers
│   │   ├── feedback.py            # User price feedback → community_prices
│   │   ├── history.py             # Query history + savings summary
│   │   ├── community.py           # Community prices, vendors, trends
│   │   ├── vehicles.py            # Vehicle CRUD + maintenance schedule
│   │   └── recommend.py           # Personalized recommendations
│   ├── intelligence/               # AI/ML pipeline
│   │   ├── orchestrator.py        # Main analysis pipeline coordinator
│   │   ├── classifier.py          # LLM-based domain/service extraction
│   │   ├── synthesizer.py         # Verdict synthesis from web data
│   │   ├── web_search.py          # Tavily dual-query search
│   │   ├── cache.py               # Redis baseline caching (4h TTL)
│   │   ├── knowledge.py           # PostgreSQL pricing_knowledge fallback
│   │   ├── nhtsa.py               # NHTSA vehicle recalls/complaints (US only)
│   │   ├── purchase_analyzer.py   # Used car purchase valuation
│   │   └── recommender.py         # Recommendation engine
│   ├── domains/                    # Domain-specific LLM prompt context
│   │   ├── auto.py                # Labor rates, scam patterns (IN + US)
│   │   ├── medical.py             # Prescription pricing context
│   │   ├── home.py                # Contractor rates, regional labor
│   │   └── legal.py               # Legal fee benchmarks
│   └── services/                   # External service integrations
│       ├── llm.py                 # Model factory (Anthropic/OpenAI), vision, audio
│       ├── database.py            # Async SQLAlchemy engine + session
│       ├── tavily.py              # Tavily web search client
│       ├── redis.py               # Redis cache client
│       ├── geo.py                 # S2 geohashing + reverse geocoding
│       └── auth.py                # Clerk JWT verification (optional)
├── tests/                          # Test directory (empty)
├── requirements.txt
├── .env.example
└── .env                            # gitignored
```

## Environment Variables

```env
DATABASE_URL=postgresql+asyncpg://user:pass@host:port/dbname   # Required
ANTHROPIC_API_KEY=sk-ant-...        # Required if default_provider=anthropic
OPENAI_API_KEY=sk-...               # Required if using OpenAI or Whisper
TAVILY_API_KEY=tvly-...             # Required for live web search
FIRECRAWL_API_KEY=fc-...            # Optional — powers Extension Pro (seller risk + listing watch)
UPSTASH_REDIS_URL=rediss://...      # Optional (graceful degradation without it)
CLERK_SECRET_KEY=sk_...             # Optional (anonymous access allowed)
CLERK_PUBLISHABLE_KEY=pk_...        # Frontend only, not used in backend
CORS_ORIGINS=http://localhost:3000  # CSV of allowed origins
DEFAULT_PROVIDER=anthropic          # "anthropic" or "openai"
```

## Database Schema

### 5 Tables

**profiles** — Clerk-linked user profiles
- `id` UUID PK, `clerk_user_id` (unique, indexed), `display_name`, `city`, `country` (enum), `queries_this_month`, `total_saved`, `created_at`, `updated_at`

**queries** — Every analysis result (primary table)
- `id` UUID PK, `user_id` FK→profiles (nullable), `domain` (enum: auto/medical/home/legal)
- `input_text`, `location_city`, `location_country`, `currency` (INR/USD)
- `quoted_price`, `fair_price_low`, `fair_price_high` (integers, smallest currency unit)
- `verdict` (enum: fair/high/overcharge), `overcharge_multiplier` (Numeric 5,2)
- `confidence_score` (0-100), `data_points_count`
- `explanation`, `red_flags` (JSONB), `questions_to_ask` (JSONB)
- `negotiation_script` (JSONB), `sources_used` (JSONB)
- `llm_model_used` ("anthropic"/"openai"/"cache"), `cost_cents`
- `feedback_final_price` (nullable — user's actual paid price)
- Index: `idx_queries_user_history` (user_id, created_at)

**pricing_knowledge** — Seeded fair-price reference data (supplementary fallback)
- `id` UUID PK, `domain`, `category`, `item_name`, `item_description`
- `price_low`, `price_high`, `currency`, `city`, `country`
- `source`, `source_url`, `confidence` (default 80), `metadata` (JSONB)
- Index: `idx_pricing_lookup` (domain, country, city, category)

**community_prices** — Crowdsourced user-reported transactions
- `id` UUID PK, `user_id` FK (nullable), `domain`, `service_type`, `description`
- `price_paid`, `currency`, `city`, `country`, `vendor_name` (nullable)
- Index: `idx_community_lookup` (domain, city, country)

**vehicles** — User car profiles for purchase/maintenance analysis
- `id` UUID PK, `user_id` FK (required), `make`, `model`, `year`, `mileage_km`, `nickname`, `country` (enum)
- Index: `idx_vehicles_user` (user_id)

### Enums
- **Domain:** auto, medical, home, legal
- **Verdict:** fair, high, overcharge
- **Currency:** INR, USD
- **Country:** IN, US

## API Endpoints

All mounted at `/api/v1` prefix.

### Analysis (`analyze.py`)
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/analyze` | Text query analysis — auto-detects domain/location, returns verdict |
| POST | `/analyze/image` | Upload bill/receipt photo → OCR → analysis |
| POST | `/analyze/voice` | Upload audio → Whisper transcription → analysis |
| POST | `/analyze/purchase` | Used car purchase analysis (form data) |
| POST | `/analyze/purchase/json` | Used car purchase analysis (JSON body) |
| GET | `/providers` | Available LLM providers + current default |

### Negotiation (`negotiate.py`)
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/negotiate` | Generate negotiation scripts, tactics, target price |
| POST | `/negotiate/counter` | Counter-offer response strategy |

### History (`history.py`)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/history` | Paginated user query history (page, limit) |
| GET | `/history/{query_id}` | Full verdict details for a specific query |
| GET | `/savings/summary` | Aggregate savings (total_saved, total_queries, overcharges_found) |

### Feedback (`feedback.py`)
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/feedback` | Report final price paid → writes to community_prices |

### Community (`community.py`)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/community/prices` | Browse crowdsourced prices (filterable by domain/city/country) |
| GET | `/community/vendors` | Vendor transparency scores (3+ reports required) |
| GET | `/community/trends` | Daily price trend aggregates |

### Vehicles (`vehicles.py`)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/vehicles` | List user's vehicles |
| POST | `/vehicles` | Register new vehicle |
| GET | `/vehicles/{id}/maintenance` | Predictive maintenance schedule with alerts |

### Recommendations (`recommend.py`)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/recommend/{query_id}` | Personalized next-step recommendations |

### Extension Pro (`extension.py`)
All three endpoints power the paid Chrome add-on features. See
`docs/EXTENSION_PRO.md` for the product plan.

| Method | Route | Description |
|--------|-------|-------------|
| POST   | `/extension/seller-risk` | Hybrid Firecrawl + Tavily lookup — returns a 0–100 risk score with reasons for the seller on the current listing |
| POST   | `/extension/reply-coach` | Conversational reply coach with tone toggle. Delegates to `/negotiate/chat` under the hood so chat history stays in one table |
| POST   | `/extension/listing-watch` | Register a listing for stale-price watching (user auth required) |
| GET    | `/extension/listing-watch` | List the caller's active watches |
| DELETE | `/extension/listing-watch/{id}` | Pause a watch |

Firecrawl is **optional** — if `FIRECRAWL_API_KEY` is unset, seller-risk
falls back to a Tavily-only heuristic and returns degraded data with
`data_sources: ["heuristic"]`.

### Health
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Health check |

## Intelligence Pipeline

The core analysis flow in `orchestrator.py`:

```
User Query
    │
    ▼
1. CLASSIFY (LLM: Haiku/GPT-4o-mini)
   Extract: domain, service, make/model, city, country, price, currency
    │
    ▼
2. CACHE CHECK (Redis, 4h TTL)
   Key: normalized(domain + service + city + country)
   ├── HIT → Compute fresh verdict from cached baseline + quoted_price → Return
    │
    ▼ (MISS)
3. WEB SEARCH (Tavily)
   Two parallel queries:
   - Specific: "{service} {vehicle} cost {city}"
   - Broad: "{service} average cost {country}"
   Returns: top 8 results with title, content, URL, score
    │
    ▼
4. SYNTHESIZE (LLM: Sonnet/GPT-4o)
   Input: classification + web results + domain context
   Output: fair_price_low/high, verdict, overcharge_multiplier,
           confidence, red_flags[], questions_to_ask[]
    │
    ▼
5. CACHE BASELINE → Store fair price range in Redis (4h TTL)
   STORE QUERY → Persist full result to PostgreSQL
    │
    ▼
6. RETURN verdict with freshness metadata
```

**Key design decision:** Baselines are cached, NOT per-quote verdicts. The overcharge_multiplier is always computed fresh from the user's quoted_price against the baseline. Same service + different quotes = different multipliers.

## LLM Configuration

| Task | Anthropic | OpenAI |
|------|-----------|--------|
| Classification (fast) | claude-haiku-4-5-20251001 | gpt-4o-mini |
| Synthesis (strong) | claude-sonnet-4-5-20241022 | gpt-4o |
| Image analysis | Claude Vision | gpt-4o Vision |
| Voice transcription | — (uses OpenAI always) | whisper-1 |

Provider is switchable per-request via `provider` field or globally via `DEFAULT_PROVIDER` env var.

## Authentication

- **Provider:** Clerk
- **Approach:** Optional, non-blocking — anonymous requests are allowed
- **Flow:** Bearer token in Authorization header → verified against Clerk API → returns user_id or None
- **Usage:** Routes use `Depends(get_optional_user_id)` for optional user attribution

## Running the Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Fill in required values
uvicorn app.main:app --reload --port 8000
```

On startup: async engine connects, all tables auto-created via `Base.metadata.create_all`.

## Seeding Data

```bash
python scripts/seed_auto_repair.py
```

Seeds 392 items across India (Maruti, Honda, Hyundai, Toyota, Tata) and US (Honda, Toyota, Ford, Chevrolet, Nissan) markets with city-specific multipliers for 25 auto repair categories.
