# FairCheck Architecture Documentation

## What FairCheck Is

An AI-powered consumer protection platform that eliminates information asymmetry. Users submit service quotes (text, image, or voice) and receive instant, data-backed verdicts on whether they're being overcharged — plus negotiation coaching and community intelligence.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 16 / React 19 / TypeScript)                  │
│  ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │AnalyzerStudio│ │ Verdict  │ │Negotiate │ │ Vault/Community│  │
│  │ Text/Img/Voice│ │ Result   │ │ Coach    │ │ History/Feed  │  │
│  └──────┬───────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│         │              │            │               │            │
│         └──────────────┴────────────┴───────────────┘            │
│                         │ REST API calls                         │
│                    ┌────┴────┐                                   │
│                    │ api.ts  │  Typed API client                  │
│                    └────┬────┘                                   │
│                    Clerk Auth                                    │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTP (NEXT_PUBLIC_API_URL)
                          │
┌─────────────────────────┴────────────────────────────────────────┐
│  BACKEND (FastAPI / Python 3.13)                                 │
│                                                                  │
│  ┌─────────── /api/v1 ──────────────────────────────────┐       │
│  │  analyze  negotiate  history  feedback  community     │       │
│  │  vehicles  recommend                                  │       │
│  └──────────────────────┬───────────────────────────────┘       │
│                         │                                        │
│  ┌──────── Intelligence Pipeline ───────────────────────┐       │
│  │                                                       │       │
│  │  1. Classifier (LLM fast)                            │       │
│  │       ↓                                               │       │
│  │  2. Cache Check (Redis 4h TTL)                       │       │
│  │       ↓ miss                                          │       │
│  │  3. Web Search (Tavily, 2 queries)                   │       │
│  │       ↓                                               │       │
│  │  4. Synthesizer (LLM strong + domain context)        │       │
│  │       ↓                                               │       │
│  │  5. Store (PostgreSQL) + Cache Baseline (Redis)      │       │
│  │                                                       │       │
│  └───────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌─── Services ──────────────────────────────────────────┐      │
│  │  LLM (Anthropic/OpenAI)  │  Tavily  │  Redis  │  Geo │      │
│  │  Database (asyncpg)      │  Auth (Clerk)              │      │
│  └───────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐  ┌───────────┐  ┌────────────┐
   │ PostgreSQL │  │   Redis   │  │ External   │
   │ 5 tables   │  │ (Upstash) │  │ APIs       │
   │ asyncpg    │  │ 4h TTL    │  │ Tavily     │
   └────────────┘  └───────────┘  │ Anthropic  │
                                  │ OpenAI     │
                                  │ Clerk      │
                                  │ NHTSA      │
                                  │ BigDataCloud│
                                  └────────────┘
```

## Core Design Principles

### 1. Live Data First
Tavily web search is the **PRIMARY** pricing source. PostgreSQL `pricing_knowledge` table is a **supplementary fallback**, not the main source. This ensures prices stay current without manual data maintenance.

### 2. Split Cache Architecture
Redis caches **fair-price baselines**, NOT per-quote verdicts. The overcharge multiplier is always computed fresh from the user's `quoted_price` against the cached baseline. Same service + different quotes = different multipliers.

### 3. Dual-Market from Day One
India (INR) and US (USD) supported simultaneously:
- Separate labor rate contexts per country
- City-specific price multipliers
- Country-appropriate vehicle makes and data sources
- Currency stored in smallest unit (paise/cents) for precision

### 4. Multi-Provider LLM
Anthropic Claude and OpenAI are interchangeable per-request:
- **Fast tasks** (classification): Haiku / GPT-4o-mini
- **Strong tasks** (synthesis, negotiation): Sonnet / GPT-4o
- **Voice transcription**: Always OpenAI Whisper
- **Image analysis**: Either provider's vision model

### 5. Optional Authentication
Clerk auth is non-blocking. Anonymous users can analyze quotes. Authenticated users get history, savings tracking, vehicle profiles, and community attribution.

## Data Flow: Analysis Request

```
User submits "Mechanic quoted ₹14,000 for brake pads on Honda City 2019 in Pune"
    │
    ▼
[AnalyzerStudio] → POST /api/v1/analyze
    │                { query, lat, lng, city, country, domain, provider }
    ▼
[Classifier] → LLM extracts:
    │   domain: "auto", service: "brake pads replacement"
    │   make: "Honda", model: "City", year: 2019
    │   quoted_price: 1400000 (paise), currency: "INR"
    │   city: "Pune", country: "IN"
    ▼
[Cache] → Redis lookup: "auto:brake_pads_replacement:pune:in"
    │   ├── HIT: baseline = {low: 400000, high: 700000}
    │   │         → compute multiplier fresh: 1400000/550000 = 2.5x
    │   │         → verdict: "overcharge" → RETURN
    │   └── MISS: continue to web search
    ▼
[Web Search] → Tavily:
    │   Query 1: "brake pads replacement Honda City 2019 cost Pune India"
    │   Query 2: "brake pads replacement average cost India"
    │   → 8 results with pricing data
    ▼
[Synthesizer] → LLM merges web results + auto domain context:
    │   fair_price_low: 400000, fair_price_high: 700000
    │   verdict: "overcharge", overcharge_multiplier: 2.55
    │   confidence: 85, data_points_count: 6
    │   red_flags: ["Price 2.5x above market rate", ...]
    │   questions_to_ask: ["Ask for itemized breakdown", ...]
    ▼
[Store] → PostgreSQL: save to queries table
         Redis: cache baseline {low: 400000, high: 700000} for 4h
    │
    ▼
[Response] → VerdictResponse with id, verdict, fair range, confidence,
             red_flags, questions_to_ask, freshness metadata
    │
    ▼
[Frontend] → Navigate to /result/{id} → display verdict
```

## Data Flow: Multimodal Input

```
TEXT:  query string → Classifier → Pipeline
IMAGE: photo upload → LLM Vision extract text → Classifier → Pipeline
VOICE: audio blob → OpenAI Whisper transcribe → Classifier → Pipeline
```

All three modes converge at the same Classifier → Pipeline flow.

## Data Flow: Negotiation

```
User clicks "Negotiate" on verdict page
    │
    ▼
POST /api/v1/negotiate
    { query_id, verdict_data }
    │
    ▼
[LLM Strong] → Generates:
    - scripts[]: conversation dialog (You/Them roles)
    - tactics[]: named strategies with descriptions
    - target_price: recommended negotiation target
    - walk_away_above: maximum acceptable price
    │
    ▼
[Frontend] → Displays scripts, practice mode, evidence sidebar
    │
    ▼
User submits vendor's counter-offer
    │
    ▼
POST /api/v1/negotiate/counter
    │
    ▼
[LLM] → Counter-response strategy
```

## Data Flow: Community Feedback Loop

```
User completes negotiation → reports final price
    │
    ▼
POST /api/v1/feedback
    { query_id, final_price, outcome, vendor_name }
    │
    ▼
[Backend] → Writes to community_prices table
            Updates query.feedback_final_price
    │
    ▼
Future queries benefit from community data:
    GET /api/v1/community/prices → hyperlocal price intelligence
    GET /api/v1/community/vendors → vendor transparency scores
    GET /api/v1/community/trends → price trend aggregates
```

## External Service Dependencies

| Service | Purpose | Required? | Fallback |
|---------|---------|-----------|----------|
| **PostgreSQL** | Primary data store (5 tables) | Yes | None |
| **Tavily** | Live web search for pricing data | Yes | pricing_knowledge DB fallback |
| **Firecrawl** | Structured extraction from specific URLs (seller profiles, listing pages). Powers Extension Pro add-on. | No | Heuristic fallback on seller risk; listing-watch accepts creates but skips stale checks |
| **Anthropic Claude** | Default LLM (classify + synthesize) | If default provider | Switch to OpenAI |
| **OpenAI** | Alt LLM + Whisper (voice) + Vision | If using voice/image | Anthropic for text-only |
| **Redis (Upstash)** | Baseline caching (4h TTL) | No | Graceful degradation (no cache) |
| **Clerk** | User authentication | No | Anonymous access allowed |
| **NHTSA** | Vehicle recalls/complaints (US only) | No | Skipped for non-US |
| **BigDataCloud** | Reverse geocoding (lat/lng → city) | No | Manual city/country input |

## Domain Support

4 supported domains, each with dedicated prompt context:

| Domain | Context File | Key Data |
|--------|-------------|----------|
| **Auto** | `domains/auto.py` | Labor rates (₹300-1200/hr IN, $80-180/hr US), OEM markup scams, common unnecessary repairs |
| **Medical** | `domains/medical.py` | Prescription pricing, generic vs brand, hospital markup patterns |
| **Home** | `domains/home.py` | Contractor rates, material costs, regional labor differences |
| **Legal** | `domains/legal.py` | Legal fee benchmarks, hourly rates, retainer patterns |

## Database Design Decisions

1. **Prices in smallest unit** — All prices stored as integers in paise (INR) or cents (USD). No floating-point rounding errors.
2. **JSONB for flexible data** — `red_flags`, `questions_to_ask`, `sources_used`, `metadata` use JSONB for schema flexibility.
3. **Optional user linkage** — `user_id` is nullable on queries and community_prices, supporting anonymous usage.
4. **Composite indexes** — Optimized for the most common query patterns (user history, pricing lookups, community browsing).
5. **No soft deletes** — Clean schema, no `deleted_at` columns.

## Caching Strategy

```
Redis Key Format: "baseline:{domain}:{normalized_service}:{city}:{country}"
TTL: 4 hours (14,400 seconds)

Cached Value: { fair_price_low, fair_price_high, currency, data_points }

What's cached:    Fair-price BASELINES (the range)
What's NOT cached: Per-quote verdicts or multipliers
Why:              Same baseline + different quoted_price = different verdict
```

## Deployment Architecture (Planned)

| Component | Platform | Tier |
|-----------|----------|------|
| Frontend | Vercel | Free tier (auto-deploy from git) |
| Backend | Railway | Hobby ($5/mo, Python runtime) |
| PostgreSQL | Railway / Supabase | Included with Railway |
| Redis | Upstash | Free tier (10K commands/day) |
| Auth | Clerk | Free tier (10K MAUs) |

No Docker or CI/CD configured yet.

## Project Stats

| Metric | Value |
|--------|-------|
| Backend Python files | ~37 |
| Frontend TypeScript files | ~12 |
| Total source lines | ~2,900 |
| Database tables | 5 |
| API endpoints | 21 |
| LLM providers | 2 |
| Supported domains | 4 |
| Supported markets | 2 (India, US) |

## Phase Roadmap

- **Phase 0 (Complete):** Foundation — dual-market auto repair, multimodal input, live web search, negotiation coach, community feed
- **Phase 1 (Planned):** Price Memory Network, WhatsApp/SMS bot, medical + home domain expansion
- **Phase 2 (Planned):** Ambient Price Scanner (AR), predictive maintenance, group negotiation
- **Phase 3 (Planned):** Vendor transparency marketplace, batch processing, API for third-party integration
