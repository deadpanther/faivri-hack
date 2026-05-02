# FairCheck — Technical Design Specification

**Version:** 1.0
**Date:** 2026-04-09
**Status:** Approved for Implementation
**Author:** Rudra + Claude

---

## 1. Overview

FairCheck is an AI-powered second opinion platform that eliminates information asymmetry between consumers and experts (mechanics, doctors, contractors, lawyers) by providing instant, data-backed price analysis with negotiation guidance.

**Target Markets:** India and US (dual-market from day 1)
**Platform:** Web app (responsive, mobile-web friendly) — native mobile later
**North Star Metric:** Total money saved by users per month

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js + TypeScript + Tailwind CSS | Existing team expertise, SSR for SEO, responsive |
| Backend | FastAPI (Python) | Async-native, great for AI/ML pipelines |
| Database | Supabase (PostgreSQL + pgvector + Auth + Storage) | Free tier, built-in auth/RLS, vector search |
| Cache/Queue | Redis via Upstash (free tier) | Task queue (ARQ), response cache, rate limiting |
| LLM | Claude API (tiered: Haiku/Sonnet/Opus) | Strong reasoning, structured output, cost-tiered |
| Web Search | Tavily (primary) + SerpAPI (fallback) | Tavily: AI-optimized, cheap. SerpAPI: reliable fallback |
| Deep Scraping | Firecrawl | On-demand for new vendor sites, batch scheduled |
| Image Analysis | GPT-4o Vision / Claude Vision | Invoice/bill/damage photo extraction |
| Deployment | Vercel (frontend) + Railway/Render (backend) | Simple, free tiers available |

---

## 3. Architecture — Modular Monolith

Single FastAPI server with domain routers + ARQ background workers. Clean internal boundaries, easy to extract into microservices at scale.

```
┌─────────────────────────────────────────────────────┐
│                 NEXT.JS FRONTEND                     │
│  Home/Pulse │ Verdict │ Negotiate │ Vault │ Profile  │
│  Glassmorphism + Framer Motion + WebSocket           │
└─────────────────────┬───────────────────────────────┘
                      │ REST + WebSocket
                      ▼
┌─────────────────────────────────────────────────────┐
│                  FASTAPI GATEWAY                     │
│                                                      │
│  Domain Routers:                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│  │  Auto  │ │Medical │ │  Home  │ │ Legal  │       │
│  │ Repair │ │Prescr. │ │Services│ │  (P1)  │       │
│  └────────┘ └────────┘ └────────┘ └────────┘       │
│                                                      │
│  API Endpoints:                                      │
│  /api/v1/analyze      (text/voice/image)            │
│  /api/v1/negotiate    (scripts + roleplay)          │
│  /api/v1/feedback     (price confirmations)         │
│  /api/v1/community    (crowdsourced prices)         │
│  /api/v1/history      (user queries + savings)      │
│  /api/v1/vendors      (verified vendors)            │
│  /ws/analyze          (real-time verdict streaming)  │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│           INTELLIGENCE ENGINE (ARQ Workers)          │
│                                                      │
│  Orchestrator → fans out to 4 layers in parallel:   │
│  1. Knowledge Base (Supabase + pgvector)            │
│  2. Community Data (pgvector similarity)            │
│  3. Web Search (Tavily → SerpAPI fallback)          │
│  4. LLM Reasoning (Claude tiered)                   │
│                                                      │
│  Merges results → LLM synthesis → structured output │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│                   DATA LAYER                         │
│  Supabase (Postgres + pgvector + Auth + Storage)    │
│  Redis/Upstash (cache + task queue + rate limiting) │
└─────────────────────────────────────────────────────┘
```

---

## 4. Cost-Optimal Data Extraction Strategy

Every query follows a cascading cost ladder — cheapest source first:

| Tier | Sources | Cost | % of Queries |
|------|---------|------|-------------|
| 1 — Free | Redis cache, Supabase cache, static knowledge base, Claude Haiku (classification) | ~₹0 | 80% |
| 2 — Low | Tavily search, Claude Sonnet (analysis), community pgvector similarity | ~₹0.15 | 15% |
| 3 — Medium | SerpAPI fallback, GPT-4o Vision (photos), Claude Opus (complex reasoning) | ~₹2-5 | 4% |
| 4 — Expensive | Firecrawl deep scrape, Whisper voice transcription, batch jobs (scheduled) | ~₹5-15 | 1% |

**Cache strategy:**
- Redis TTL: 24 hours for query results
- Cache key format: `{domain}:{service_normalized}:{make_model}:{city}:{country}`
- Community data: pgvector similarity search (cosine, threshold 0.85)
- Static knowledge: refreshed weekly via batch scraping jobs

**Estimated operational cost:** ~₹0.50-2.00 per typical query. At 10K queries/day = ~₹5,000-15,000/day.

---

## 5. Database Schema (Supabase)

### 5.1 Tables

**profiles**
- `id` (FK → auth.users, PK)
- `display_name` (text)
- `city` (text)
- `country` (text, IN/US)
- `preferred_language` (text, default 'en')
- `subscription_tier` (enum: free/pro/family)
- `total_saved` (integer, cents)
- `queries_this_month` (integer)
- `created_at`, `updated_at` (timestamptz)

**queries**
- `id` (uuid PK)
- `user_id` (FK → profiles)
- `domain` (enum: auto/medical/home/legal)
- `input_type` (enum: text/voice/image)
- `input_text` (text)
- `input_image_url` (text, nullable)
- `location_city` (text)
- `location_country` (text)
- `currency` (enum: INR/USD)
- `quoted_price` (integer, nullable)
- `fair_price_low` (integer)
- `fair_price_high` (integer)
- `verdict` (enum: fair/high/overcharge)
- `overcharge_multiplier` (numeric)
- `confidence_score` (integer 0-100)
- `data_points_count` (integer)
- `explanation` (text)
- `red_flags` (jsonb[])
- `questions_to_ask` (jsonb[])
- `negotiation_script` (text)
- `sources_used` (jsonb)
- `llm_model_used` (text)
- `cost_cents` (integer — query processing cost)
- `feedback_final_price` (integer, nullable)
- `feedback_outcome` (text, nullable)
- `created_at` (timestamptz)

**community_prices**
- `id` (uuid PK)
- `user_id` (FK → profiles)
- `domain` (enum)
- `service_type` (text)
- `description` (text)
- `price_paid` (integer)
- `currency` (enum: INR/USD)
- `city` (text)
- `country` (text)
- `vendor_name` (text, nullable)
- `verified` (boolean, default false)
- `embedding` (vector(1536))
- `created_at` (timestamptz)

**pricing_knowledge**
- `id` (uuid PK)
- `domain` (enum)
- `category` (text)
- `item_name` (text)
- `item_description` (text)
- `price_low` (integer)
- `price_high` (integer)
- `currency` (enum: INR/USD)
- `city` (text, nullable — null = national)
- `country` (text)
- `source` (text)
- `source_url` (text)
- `last_verified` (timestamptz)
- `confidence` (integer 0-100)
- `embedding` (vector(1536))
- `metadata` (jsonb — domain-specific: OEM/aftermarket, generic/branded, etc.)
- `created_at`, `updated_at` (timestamptz)

**vendors**
- `id` (uuid PK)
- `name` (text)
- `domain` (enum)
- `city` (text)
- `country` (text)
- `address` (text, nullable)
- `phone` (text, nullable)
- `is_verified` (boolean)
- `transparency_score` (numeric 0-5)
- `total_reviews` (integer)
- `avg_price_fairness` (numeric)
- `verified_until` (timestamptz, nullable)
- `created_at` (timestamptz)

**vendor_reviews**
- `id` (uuid PK)
- `user_id` (FK → profiles)
- `vendor_id` (FK → vendors)
- `query_id` (FK → queries)
- `rating` (integer 1-5)
- `transparency_rating` (integer 1-5)
- `comment` (text, nullable)
- `created_at` (timestamptz)

**subscriptions**
- `id` (uuid PK)
- `user_id` (FK → profiles)
- `tier` (enum: free/pro/family)
- `status` (enum: active/cancelled/past_due)
- `stripe_customer_id` (text, nullable)
- `current_period_end` (timestamptz)
- `created_at` (timestamptz)

### 5.2 Indexes

```sql
-- Fast lookups
CREATE INDEX idx_pricing_knowledge_lookup ON pricing_knowledge(domain, country, city, category);
CREATE INDEX idx_community_prices_lookup ON community_prices(domain, city, country, created_at DESC);
CREATE INDEX idx_queries_user_history ON queries(user_id, created_at DESC);
CREATE INDEX idx_vendors_search ON vendors(domain, city, country, is_verified);

-- Vector similarity (pgvector)
CREATE INDEX idx_pricing_knowledge_embedding ON pricing_knowledge
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_community_prices_embedding ON community_prices
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 5.3 Row-Level Security

- **profiles:** Users read/write only their own row
- **queries:** Users read/write only their own queries
- **community_prices:** Read = public, Write = authenticated users only
- **pricing_knowledge:** Read = public, Write = admin only
- **vendors:** Read = public, Write = admin only
- **vendor_reviews:** Read = public, Write = authenticated (own reviews only)
- **subscriptions:** Users read/write only their own

---

## 6. API Design

### 6.1 Core Analysis

```
POST /api/v1/analyze
  Body: { query: string, domain?: string, city: string, country: string, quoted_price?: number }
  Returns: { verdict, price_range, confidence, explanation, red_flags[], questions[], negotiation_script, sources }

POST /api/v1/analyze/image
  Body: multipart { image, domain?, city, country }
  Returns: { extracted_text, ...same as /analyze }

POST /api/v1/analyze/voice
  Body: multipart { audio, language? }
  Returns: { transcript, ...same as /analyze }

WS /ws/analyze
  Send: { query, domain?, city, country, quoted_price? }
  Receive: stream of { step, data } events (classifying → searching → analyzing → verdict)
```

### 6.2 Negotiation

```
POST /api/v1/negotiate
  Body: { query_id: string }
  Returns: { scripts[], tactics[], walk_away_signals[] }

POST /api/v1/negotiate/roleplay
  Body: { query_id: string, user_message: string }
  Returns: SSE stream of AI expert responses
```

### 6.3 Feedback & Community

```
POST /api/v1/feedback
  Body: { query_id, final_price, outcome, vendor_name? }

GET  /api/v1/community/prices?domain=&city=&country=&category=&limit=
POST /api/v1/community/submit
  Body: { domain, service, price, city, country, vendor? }
```

### 6.4 User & History

```
GET  /api/v1/history?page=&limit=&domain=&verdict=
GET  /api/v1/history/:id
GET  /api/v1/savings/summary
GET  /api/v1/profile
PUT  /api/v1/profile
```

### 6.5 Vendors

```
GET  /api/v1/vendors?domain=&city=&country=&verified_only=
POST /api/v1/vendors/:id/review
  Body: { query_id, rating, transparency, comment? }
```

### 6.6 Admin

```
POST /api/v1/admin/scrape    (trigger batch pricing scrape)
GET  /api/v1/admin/stats     (system stats)
POST /api/v1/admin/knowledge (bulk upload pricing data)
```

---

## 7. Query Processing Pipeline

```
User Input
    │
    ▼
STEP 1: CLASSIFY (Claude Haiku, ~0.2s, ~₹0.01)
    Extract: domain, service, make/model/year, city, country, quoted_price, currency
    │
    ▼
STEP 2: CACHE CHECK (Redis + Supabase, ~0.1s, ₹0)
    Key: "{domain}:{service_normalized}:{specifics}:{city}:{country}"
    Hit? → Return cached result
    Miss? → Continue
    │
    ▼
STEP 3: PARALLEL DATA FETCH (fan-out, ~2-5s)
    ├── Knowledge Base Query (Supabase: domain + city + category)
    ├── Community pgvector Similarity (embedding cosine search)
    └── Web Search (Tavily → SerpAPI fallback)
    │
    ▼
STEP 4: MERGE + SYNTHESIZE (Claude Sonnet, ~2s, ~₹0.15)
    Receives: all data sources + domain-specific prompt template
    Produces: structured verdict JSON
    │
    ▼
STEP 5: OUTPUT + CACHE
    Return verdict, cache for 24h, store in queries table
```

**Domain-specific prompt templates:**
- **Auto Repair:** OEM vs aftermarket, labor rate by city, VIN-specific pricing, wear item classification
- **Medical:** Generic vs branded (NPPA), standard-of-care validation, drug interactions, CGHS rates
- **Home Services:** Material cost breakdown, labor by skill/city, scope validation, seasonal adjustments
- **Legal (P1):** Bar Council guidelines, matter type, free legal aid eligibility, fee schedule comparison

---

## 8. Frontend Design

### 8.1 Design System

- **Aesthetic:** Glassmorphism dark mode with frosted glass cards, animated gradient orbs, 3D layered navigation
- **Color Palette:**
  - Primary: Insight Blue (#0052FF)
  - Success/Fair: Verified Green (#00C853)
  - Warning: Caution Amber (#FFD600)
  - Danger/Overcharge: Alert Red (#FF3D00)
  - Background: Deep Slate (#050A18 → #0A0F1E)
  - Glass: rgba(255,255,255,0.03-0.07) with backdrop-filter: blur(20px)
- **Typography:** Inter (variable weights 300-900)
- **Motion:** Framer Motion — smooth orb floating, step reveals, pulse rings, shimmer gradients
- **Interactions:** Haptic-style visual feedback, adaptive density (big verdict first, details on scroll)

### 8.2 Core Screens

**Screen 1: Home / "The Pulse"**
- Full-width hero: "Know if you're being cheated — in 30 seconds"
- Glassmorphic input area: text field + camera + file + mic (shimmer gradient on mic)
- Domain chips: Car Repair, Prescription, Contractor, Invoice, Legal
- Live savings ticker (green pulse dot)
- Social proof stats: queries checked, money saved, cities, accuracy

**Screen 2: Verdict / "The Money Shot"**
- Two-column: main verdict card + sidebar
- Giant overcharge multiplier (2.8x) with red glow and animated reveal
- Price gauge bar: green (fair range) vs red marker (quoted price)
- Confidence ring (87%) with data point count
- Explanation card with analysis
- Sidebar: red flags, 3 questions to ask, action buttons (Negotiate, Share, Report)

**Screen 3: Negotiation Lab**
- Chat-bubble script: color-coded (blue=you, amber=if-they-say, green=response, red=walk-away)
- Conditional branching for different expert responses
- Sidebar: tactics (Anchor Low, Ask for Proof, Remove Urgency, Mention Alternatives)
- Target price card with walk-away threshold
- Evidence kit: PDF report, WhatsApp share, Twitter share

**Screen 4: Vault / History**
- Savings hero: total saved with green gradient, stats (queries, overcharges, negotiations, community helps)
- History list: domain icon, description, city, time, savings amount, verdict badge
- Community contribution badge

### 8.3 Responsive Behavior

- **Desktop (>1024px):** Two-column layouts, full nav bar, side-by-side cards
- **Tablet (768-1024px):** Single column with stacked cards, collapsible sidebar
- **Mobile web (<768px):** Full mobile layout, sticky bottom nav, sheet-style drawers for sidebar content

---

## 9. Data Seeding Strategy (US + India)

### 9.1 India — Priority Data Sources

| Domain | Source | Data Type | Method |
|--------|--------|-----------|--------|
| Auto | CarDekho, CarWale | Part prices, service costs | Firecrawl batch scrape |
| Auto | GoMechanic, MyTVS | Labor rates by city | Tavily + manual |
| Medical | NPPA database (nppa.gov.in) | Government regulated drug prices | Public API/CSV |
| Medical | 1mg, PharmEasy | Generic vs branded prices | Firecrawl |
| Medical | CGHS rate schedule | Hospital procedure rates | Public PDF → parsed |
| Home | Urban Company | Service category pricing | Tavily search |
| Home | IndiaMART | Material costs (cement, tiles, pipes) | Firecrawl |
| Legal | Bar Council of India | Fee guidelines | Public documents |

### 9.2 US — Priority Data Sources

| Domain | Source | Data Type | Method |
|--------|--------|-----------|--------|
| Auto | RepairPal, KBB | Part + labor estimates by zip | Tavily + Firecrawl |
| Auto | NHTSA, OEM bulletins | Service bulletins, recall data | Public API |
| Medical | GoodRx | Drug price comparison | Tavily search |
| Medical | Medicare fee schedule | Procedure pricing | Public CSV |
| Medical | FDA drug database | Drug info, generics | Public API |
| Home | HomeAdvisor, Angi | Contractor pricing by zip | Tavily + Firecrawl |
| Home | Home Depot, Lowe's | Material costs | Firecrawl |
| Legal | Avvo, LegalMatch | Attorney fee ranges | Tavily search |

### 9.3 Seeding Schedule

- **Week 1-2:** Scrape and load top 500 auto repair items (India: Mumbai, Pune, Bangalore, Delhi; US: top 10 metros)
- **Week 2-3:** Load NPPA drug database + GoodRx top 200 drugs
- **Week 3-4:** Home services baseline for top 5 cities per country
- **Ongoing:** Community data enrichment from user feedback loop

---

## 10. Authentication & Authorization

- **Auth provider:** Supabase Auth (email/password + Google OAuth + phone OTP for India)
- **Session management:** Supabase JWT → passed to FastAPI for validation
- **Free tier limits:** 5 queries/month (enforced via `queries_this_month` counter on profiles)
- **Pro tier:** Unlimited queries, voice input, recording, history
- **RLS:** All data access governed by Supabase Row-Level Security policies
- **API auth:** Bearer token (Supabase JWT) on all authenticated endpoints
- **Rate limiting:** Redis-based, 10 req/min for free, 60 req/min for pro

---

## 11. Error Handling

- **Low confidence (<50%):** Show result with prominent warning: "Limited data for this query — treat as a rough estimate"
- **No data found:** Never say "we cannot determine" — show broader category/city/national average with confidence level
- **API failures:** Graceful degradation — if Tavily fails, use SerpAPI; if both fail, use cached/knowledge base data only
- **Voice transcription errors:** Show transcript for user correction before analysis
- **Image extraction failures:** Fall back to text input with "We couldn't read this clearly — can you type the key details?"

---

## 12. Testing Strategy

- **Backend:** pytest for all domain routers, mock LLM responses for unit tests, integration tests against Supabase
- **Frontend:** Vitest + React Testing Library for components, Playwright for E2E flows
- **Critical paths to test:**
  1. Text query → verdict (happy path)
  2. Image upload → extraction → verdict
  3. Cache hit returns instantly
  4. Fallback chain (Tavily fail → SerpAPI → knowledge base only)
  5. Free tier limit enforcement
  6. Feedback submission updates community data

---

## 13. Project Structure

```
FairCheck/
├── frontend/                    # Next.js app
│   ├── src/
│   │   ├── app/                 # Next.js app router
│   │   │   ├── page.tsx         # Home / Pulse
│   │   │   ├── result/[id]/     # Verdict screen
│   │   │   ├── negotiate/[id]/  # Negotiation Lab
│   │   │   ├── vault/           # History / Savings
│   │   │   ├── community/       # Community prices
│   │   │   └── layout.tsx       # Root layout + nav
│   │   ├── components/
│   │   │   ├── ui/              # Glass cards, buttons, inputs
│   │   │   ├── verdict/         # Verdict card, gauge, confidence
│   │   │   ├── negotiate/       # Chat bubbles, tactics
│   │   │   └── layout/          # Nav, sidebar, footer
│   │   ├── lib/
│   │   │   ├── supabase.ts      # Supabase client
│   │   │   ├── api.ts           # Backend API client
│   │   │   └── hooks/           # Custom React hooks
│   │   └── styles/
│   │       └── globals.css      # Tailwind + glassmorphism utilities
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                     # FastAPI app
│   ├── app/
│   │   ├── main.py              # FastAPI app + CORS + lifespan
│   │   ├── config.py            # Settings (env vars)
│   │   ├── routers/
│   │   │   ├── analyze.py       # /analyze endpoints
│   │   │   ├── negotiate.py     # /negotiate endpoints
│   │   │   ├── feedback.py      # /feedback endpoints
│   │   │   ├── community.py     # /community endpoints
│   │   │   ├── history.py       # /history + /savings
│   │   │   ├── vendors.py       # /vendors endpoints
│   │   │   └── admin.py         # /admin endpoints
│   │   ├── domains/
│   │   │   ├── auto.py          # Auto repair domain logic
│   │   │   ├── medical.py       # Medical/prescription domain
│   │   │   ├── home.py          # Home services domain
│   │   │   └── legal.py         # Legal domain (P1)
│   │   ├── intelligence/
│   │   │   ├── orchestrator.py  # Query pipeline orchestrator
│   │   │   ├── classifier.py    # Intent + domain classification
│   │   │   ├── knowledge.py     # Layer 2: knowledge base queries
│   │   │   ├── community.py     # Layer 3: community data search
│   │   │   ├── web_search.py    # Layer 1: Tavily + SerpAPI
│   │   │   ├── synthesizer.py   # Layer 4: LLM synthesis
│   │   │   └── cache.py         # Redis cache layer
│   │   ├── services/
│   │   │   ├── supabase.py      # Supabase client
│   │   │   ├── redis.py         # Redis/Upstash client
│   │   │   ├── llm.py           # Claude API client (tiered)
│   │   │   ├── tavily.py        # Tavily search client
│   │   │   ├── serpapi.py       # SerpAPI client
│   │   │   ├── firecrawl.py     # Firecrawl client
│   │   │   └── vision.py        # GPT-4o/Claude Vision
│   │   ├── models/
│   │   │   ├── schemas.py       # Pydantic request/response models
│   │   │   └── enums.py         # Domain, Verdict, Tier enums
│   │   └── workers/
│   │       ├── tasks.py         # ARQ task definitions
│   │       └── scraper.py       # Batch scraping jobs
│   ├── tests/
│   ├── requirements.txt
│   └── Dockerfile
│
├── supabase/
│   └── migrations/              # SQL migrations
│       └── 001_initial_schema.sql
│
├── scripts/
│   ├── seed_data.py             # Data seeding script
│   └── scrape_prices.py         # Batch price scraper
│
├── docs/
│   └── superpowers/specs/
│       └── 2026-04-09-faircheck-design.md
│
├── CLAUDE.md
├── .env.example
├── .gitignore
└── README.md
```

---

## 14. Deployment

- **Frontend:** Vercel (free tier, auto-deploy from main branch)
- **Backend:** Railway or Render (free tier, Dockerfile deployment)
- **Database:** Supabase (free tier: 500MB DB, 1GB storage, 50K MAU auth)
- **Cache:** Upstash Redis (free tier: 10K commands/day)
- **Domain:** faircheck.app (or similar)

---

## 15. Phase Breakdown

### Phase 0 — Foundation (This Build)
- Project scaffolding (Next.js + FastAPI + Supabase)
- Database schema + migrations + RLS policies
- Auth flow (sign up, sign in, Google OAuth)
- Core UI shell (all 4 screens with glassmorphism design system)
- Intelligence engine: classifier + orchestrator + all 4 layers
- Auto Repair domain (first vertical)
- Text input → verdict → negotiation coach (full flow)
- Seed data: top 500 auto repair items for 4 Indian cities + 4 US cities
- Feedback loop (report what you paid)

### Phase 1 — Expand (Weeks 7-12)
- Medical prescription module + data seeding
- Home services module + data seeding
- Image input (invoice/bill photo analysis)
- Voice input (Whisper transcription)
- Community pricing browse + submit
- Savings dashboard / Vault
- WhatsApp/Twitter sharing (viral loop)

### Phase 2 — Scale (Month 4-9)
- Legal domain module
- Vendor profiles + FairCheck Verified
- Subscription/billing (Stripe)
- Enterprise API
- Hindi + regional language support
- Batch scraping automation
- Performance optimization + caching refinement
