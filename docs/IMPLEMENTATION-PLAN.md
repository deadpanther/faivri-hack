# FairCheck — Phase 0 Implementation Plan

**Status:** Pending Approval
**Date:** 2026-04-09
**Scope:** Foundation build — dual-market (India + US) consumer protection platform

---

## 1. Goal

Build the end-to-end flow: **text input → AI verdict → negotiation coach** for the **Auto Repair** domain across **India and US markets simultaneously**. A user in Pune or Phoenix types a mechanic's quote and gets an instant, data-backed verdict on whether they're being overcharged — with red flags, questions to ask, and a full negotiation script.

**Demo success = type a quote → cinematic 2.8x OVERCHARGED verdict in <5s → actionable negotiation guidance.**

---

## 2. Architecture

```
┌─────────────────────────────────────────────────┐
│              NEXT.JS FRONTEND (Vercel)           │
│                                                   │
│  Clerk Auth (sign in/up, session management)      │
│  / (Home)  →  /result/[id]  →  /negotiate/[id]  │
│              /vault  (History)                     │
│  Tailwind + V6 Design System + Framer Motion      │
└───────────────────┬───────────────────────────────┘
                    │ REST API (JSON)
                    │ Clerk JWT in Authorization header
                    ▼
┌───────────────────────────────────────────────────┐
│             FASTAPI BACKEND (Railway)              │
│                                                     │
│  POST /api/v1/analyze   ← Core pipeline            │
│  POST /api/v1/negotiate ← Script generation         │
│  POST /api/v1/feedback  ← Price confirmation        │
│  GET  /api/v1/history   ← User query history        │
│                                                     │
│  Intelligence Engine:                               │
│  Classifier → [Knowledge + Web Search] → Synthesize │
└───────────────────┬─────────────────────────────────┘
                    ▼
┌───────────────────────────────────────────────────┐
│              DATA LAYER                            │
│  Railway PostgreSQL (pricing data, queries, users) │
│  Upstash Redis (cache + rate limiting)             │
│  Tavily (web search)                               │
│  Claude API (classification + synthesis)            │
└───────────────────────────────────────────────────┘
```

---

## 3. Tech Stack (Updated)

| Layer | Choice | Justification |
|-------|--------|---------------|
| **Frontend** | Next.js 14 + TypeScript + Tailwind CSS | App Router, SSR, team expertise |
| **Auth** | **Clerk** (free tier: 10K MAU) | Free, polished UI, JWT for backend, social logins built-in |
| **Animations** | Framer Motion | Smooth verdict reveals, page transitions |
| **Backend** | FastAPI (Python 3.11+) | Async, fast, excellent for AI pipelines |
| **Database** | **Railway PostgreSQL** (free trial / $5/mo hobby) | Direct Postgres, no vendor lock-in, co-located with backend |
| **ORM** | SQLAlchemy + Alembic (migrations) | Mature, async support, full control |
| **Cache** | Upstash Redis (free tier: 10K cmds/day) | 24h query cache, rate limiting |
| **LLM** | Claude API (Haiku → classify, Sonnet → synthesize) | Best reasoning, structured JSON output |
| **Web Search** | Tavily (1000 free/month) | AI-optimized results, $0.01/search after free tier |
| **Deploy FE** | Vercel (free tier) | Auto-deploy from git, edge network |
| **Deploy BE** | Railway ($5/mo hobby or free trial) | Co-located with DB, Dockerfile deploy |

### Why Railway + Clerk over Supabase

| | Supabase | Railway + Clerk |
|---|---------|----------------|
| **Auth** | Built-in (50K MAU free) | Clerk free (10K MAU) — better UI, easier social logins |
| **Database** | Managed Postgres (500MB free) | Railway Postgres (1GB free trial, $5/mo hobby) — no RLS overhead |
| **Cost at scale** | $25/mo Pro | ~$5-10/mo total |
| **Flexibility** | Opinionated (RLS, client libs) | Raw Postgres — full control, standard SQLAlchemy |
| **Backend co-location** | Separate hosting needed | Backend + DB on same Railway project = lower latency |
| **pgvector** | Built-in | Available on Railway Postgres too |

---

## 4. Implementation Steps

### Step 1: Project Scaffolding [S]
- Next.js app with TypeScript + Tailwind + Framer Motion + Clerk
- FastAPI app with proper structure (routers, services, models)
- Railway PostgreSQL database provisioned
- `.env.example` with all required keys
- `.gitignore` for both frontend and backend

### Step 2: Database Schema + Migrations [M]
- Alembic migration: `profiles`, `queries`, `pricing_knowledge`, `community_prices`
- SQLAlchemy models for all tables
- Indexes for common lookups (domain+city+country, user history)
- Dual-market schema: `country` (IN/US) and `currency` (INR/USD) on all price tables
- Prices stored in smallest unit (paise for INR, cents for USD)

### Step 3: Dual-Market Seed Data [L]
- Python script: `scripts/seed_auto_repair.py`
- **India** (4 cities: Mumbai, Pune, Bangalore, Delhi):
  - ~100 items: brake pads, oil change, timing belt, battery, AC, clutch, etc.
  - Makes: Maruti, Honda, Hyundai, Toyota, Tata
  - Prices in INR (paise), sourced from GoMechanic/MyTVS ranges
- **US** (4 cities: New York, Los Angeles, Chicago, Houston):
  - ~100 items: same service categories
  - Makes: Honda, Toyota, Ford, Chevrolet, Nissan
  - Prices in USD (cents), sourced from RepairPal/KBB
- Each item: price_low, price_high, city, country, currency, source, metadata (OEM/aftermarket)

### Step 4: Backend Core Services [M]
- `config.py` — env var management (DB URL, Claude key, Tavily key, Redis URL, Clerk keys)
- `services/database.py` — SQLAlchemy async engine + session factory
- `services/llm.py` — Claude API client (tiered: Haiku/Sonnet)
- `services/tavily.py` — Tavily web search client
- `services/redis.py` — Upstash cache (get/set with TTL)
- `models/schemas.py` — Pydantic request/response models
- `models/enums.py` — Domain, Verdict, Country, Currency enums
- `models/db.py` — SQLAlchemy table models

### Step 5: Intelligence Engine [L]
- `intelligence/classifier.py` — Claude Haiku extracts: domain, service, make/model, city, country, quoted_price, currency
- `intelligence/knowledge.py` — Query pricing_knowledge by domain + city + country + category
- `intelligence/web_search.py` — Tavily search with market-specific queries (₹ vs $ formatting)
- `intelligence/synthesizer.py` — Claude Sonnet merges all data → structured verdict JSON
- `intelligence/cache.py` — Redis check before pipeline, cache after
- `intelligence/orchestrator.py` — Full pipeline: classify → cache → [knowledge + web search] → synthesize → store
- `domains/auto.py` — Auto repair prompt templates with dual-market awareness

### Step 6: Backend API Routes [M]
- `routers/analyze.py` — `POST /api/v1/analyze` (text → verdict)
- `routers/negotiate.py` — `POST /api/v1/negotiate` (query_id → scripts)
- `routers/feedback.py` — `POST /api/v1/feedback` (report final price)
- `routers/history.py` — `GET /api/v1/history`, `GET /api/v1/history/:id`, `GET /api/v1/savings/summary`
- `main.py` — CORS, router mounts, lifespan (DB init)
- Auth middleware — validate Clerk JWT on protected endpoints
- Rate limiting — Redis-based, 10 req/min

### Step 7: Frontend Design System + Layout [M]
- `globals.css` — V6 design tokens (colors, glass effects, ambient layers)
- `components/ui/` — GlassCard, Button, Input, Chip, Badge, Gauge
- `components/layout/Nav.tsx` — Top nav with Clerk UserButton
- `app/layout.tsx` — ClerkProvider + ambient background + nav
- Responsive breakpoints (375 / 768 / 1024 / 1440)

### Step 8: Home Screen [M]
- Hero with gradient text headline
- Input card: text field + image/attach/mic buttons
- **City + Country selector** (dropdown or auto-detect):
  - India: Mumbai, Pune, Bangalore, Delhi + Other
  - US: New York, LA, Chicago, Houston + Other
- Domain chips (Car Repair, Prescription, Contractor, Legal)
- Live ticker (static), stats row (static)
- Submit → POST /api/v1/analyze → redirect to /result/[id]

### Step 9: Verdict Screen [L]
- Cinematic 2.8x overcharge reveal (Framer Motion number count-up)
- Price gauge bar (green fair range vs red quoted pin)
- Confidence ring, analysis card, red flags, questions
- Currency-aware formatting (₹ for IN, $ for US)
- Action buttons: Negotiate, Share, Report Price

### Step 10: Negotiation Lab [M]
- Chat bubble layout (you / expert / response / walk-away)
- Tactics sidebar, target price card, evidence kit
- Currency-appropriate pricing in all scripts

### Step 11: Vault / History [M]
- Savings hero with total saved (per currency or converted)
- History list with domain icons, verdict badges
- Filter by domain, click → /result/[id]

### Step 12: Auth Flow (Clerk) [S]
- Clerk middleware for protected routes (/vault, /negotiate)
- Sign in/up pages via Clerk's prebuilt components
- Pass Clerk JWT to backend API calls
- Backend validates JWT via Clerk's Python SDK
- Anonymous analysis allowed (up to 5/month by IP)

### Step 13: Integration Testing + Polish [M]
- E2E: "₹14,000 brake pads in Pune" → verdict → negotiate
- E2E: "$800 brake pads in Houston" → verdict → negotiate
- Loading states, error states, mobile responsive
- Pre-cache 2-3 demo queries for reliable demo

---

## 5. Data Model (Phase 0)

```
profiles
├── id (uuid PK)
├── clerk_user_id (text, unique, from Clerk)
├── display_name (text)
├── city (text)
├── country (text: 'IN' | 'US')
├── queries_this_month (int, default 0)
├── total_saved (int, smallest currency unit)
├── created_at, updated_at

queries
├── id (uuid PK)
├── user_id (uuid FK → profiles, nullable for anon)
├── domain (enum: auto | medical | home | legal)
├── input_text (text)
├── location_city (text)
├── location_country (text: 'IN' | 'US')
├── currency (enum: INR | USD)
├── quoted_price (int, nullable)
├── fair_price_low (int)
├── fair_price_high (int)
├── verdict (enum: fair | high | overcharge)
├── overcharge_multiplier (numeric)
├── confidence_score (int 0-100)
├── data_points_count (int)
├── explanation (text)
├── red_flags (jsonb)
├── questions_to_ask (jsonb)
├── negotiation_script (jsonb)
├── sources_used (jsonb)
├── llm_model_used (text)
├── cost_cents (int)
├── feedback_final_price (int, nullable)
├── created_at

pricing_knowledge
├── id (uuid PK)
├── domain (enum)
├── category (text)
├── item_name (text)
├── item_description (text)
├── price_low (int)
├── price_high (int)
├── currency (enum: INR | USD)
├── city (text, nullable = national avg)
├── country (text: 'IN' | 'US')
├── source (text)
├── source_url (text)
├── confidence (int 0-100)
├── metadata (jsonb)
├── created_at, updated_at

community_prices
├── id (uuid PK)
├── user_id (uuid FK → profiles)
├── domain (enum)
├── service_type (text)
├── description (text)
├── price_paid (int)
├── currency (enum: INR | USD)
├── city (text)
├── country (text: 'IN' | 'US')
├── vendor_name (text, nullable)
├── created_at
```

---

## 6. API Design

### POST /api/v1/analyze
```json
// Request
{
  "query": "Mechanic quoted ₹14,000 for brake pads and rotors, Honda City 2019",
  "city": "Pune",
  "country": "IN"
}

// Response
{
  "id": "a7f3b2c1-...",
  "verdict": "overcharge",
  "overcharge_multiplier": 2.8,
  "fair_price_low": 350000,
  "fair_price_high": 550000,
  "currency": "INR",
  "confidence_score": 87,
  "data_points_count": 13,
  "explanation": "Brake pads for Honda City 2019 cost ₹1,500–2,500...",
  "red_flags": ["Full rotor replacement rarely needed", "No OEM vs aftermarket distinction"],
  "questions_to_ask": ["Show me rotor wear measurement?", "OEM or aftermarket?", "Can I see old parts?"],
  "sources": { "knowledge_base": 5, "web_search": 4, "community": 0 }
}
```

### POST /api/v1/negotiate
```json
// Request
{ "query_id": "a7f3b2c1-..." }
// Response — scripts[], tactics[], target_price, walk_away_above, currency
```

### POST /api/v1/feedback
```json
{ "query_id": "...", "final_price": 450000, "outcome": "negotiated_down" }
```

### GET /api/v1/history?page=1&limit=10
### GET /api/v1/history/:id
### GET /api/v1/savings/summary

---

## 7. Demo Flow (3 min)

| Time | Action |
|------|--------|
| 0:00–0:20 | **The Problem:** "When a mechanic quotes ₹14,000, how do you know if that's fair?" |
| 0:20–0:50 | **India query:** Type "₹14,000 brake pads, Honda City 2019, Pune" → processing animation |
| 0:50–1:30 | **Verdict:** 2.8x OVERCHARGED, gauge, red flags, questions to ask |
| 1:30–2:00 | **Negotiate:** Color-coded script, tactics, target ₹4,500 |
| 2:00–2:30 | **US query:** "$800 brake pads, 2020 Honda Civic, Houston" → 1.6x overcharged |
| 2:30–3:00 | **Impact:** Vault shows ₹34,500 saved. "India + US today. Prescriptions and contractors next." |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Claude latency >5s | Processing animation; pre-cache demo queries |
| Tavily returns bad data | Validate before synthesis; fall back to knowledge base |
| Railway DB cold start | Keep connection pool warm; use connection pooler |
| LLM hallucinated prices | Always ground in knowledge base; show data_points_count |
| Clerk JWT validation overhead | Cache validation result for session duration |

---

## 9. MVP Scope — What to Cut

**Keep (core demo):**
- Text input → verdict → negotiation (both markets)
- Auto repair domain with 200 seed items (100 IN + 100 US)
- V6 design system on Home + Verdict + Negotiate screens

**Cut first if tight:**
- ~~Auth~~ → anonymous-only, skip Clerk integration
- ~~Vault/History~~ → localStorage or skip entirely
- ~~Feedback/Report~~ → skip community loop
- ~~Rate limiting~~ → add later
- ~~Framer Motion~~ → CSS transitions only
- ~~Mobile responsive~~ → desktop-only for demo

**Absolute minimum:** Home → type query → verdict → negotiate. Two markets. Done.
