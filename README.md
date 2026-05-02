# Faivri

AI-powered consumer protection platform that eliminates information asymmetry between consumers and service providers. Get instant, data-backed verdicts on whether you're being overcharged — for car repairs, prescriptions, contractor quotes, and legal fees.

**Dual-market:** India + United States from day one.

---

## How It Works

```
User submits quote (text / image / voice)
        ↓
   AI classifies domain, service, price, make/model
        ↓
   Check cache for fair-price BASELINE (4h TTL)
        ↓  (cache miss)
   [LIVE Web Search (Tavily) + Knowledge Base]  in parallel
        ↓
   AI synthesizes fair-price baseline from live data
        ↓
   Compute verdict from baseline + user's specific quoted price
        ↓
   Red flags + questions to ask + freshness metadata
```

**Architecture: Live Data First.** Tavily web search is the PRIMARY source. Postgres knowledge base is supplementary fallback. Cache stores fair-price baselines (not per-quote verdicts), so different quotes for the same service always get fresh multiplier computation.

**Example:** "Mechanic quoted ₹14,000 for brake pads on Honda City 2019 in Pune"
→ **3.5x OVERCHARGED** | Fair range: ₹4,000–7,000 | 85% confidence from 20 data points

---

## Features

### Core Analysis
- **Text input** — Describe any quote in natural language
- **Image upload** — Snap a bill/receipt, AI extracts prices via GPT-4o Vision or Claude Vision
- **Voice input** — Record a voice note, transcribed via Whisper then analyzed
- **Domain auto-detection** — AI classifies auto/medical/home/legal from the query
- **Geolocation** — Auto-detects country and city from browser

### Intelligence Engine (Live Data First)
- **Live web search (Tavily)** is the PRIMARY data source — real-time pricing from the web
- **Knowledge base (Postgres)** is supplementary fallback — 392 seeded items for grounding
- **Split cache architecture:** Redis caches fair-price BASELINES (4h TTL), verdict multiplier computed fresh per-quote
- **Dual search strategy:** Specific query (service+vehicle+city) + broad query (service+region average) for coverage
- **Dynamic year:** Search queries use current year, not hardcoded
- **Robust JSON parsing:** LLM response parser with regex fallback and deterministic default on failure
- **Cost-tiered models:** Fast model (Haiku/GPT-4o-mini) for classification, strong model for synthesis

### Verdict Output
- Overcharge multiplier (e.g., 3.5x) — always computed fresh from baseline + user's specific quote
- Fair price range with confidence score
- Red flags (specific problems with the quote)
- Questions to ask the provider (tactical)
- **Freshness metadata** — source (live/cached/knowledge_base), web results count, fetch timestamp
- **Evidence sources** — collapsible drilldown showing data points per source
- Full negotiation script with walk-away threshold

### Multi-Provider LLM (Model Factory)
- **Anthropic Claude** (Haiku for fast, Haiku for strong) — current default
- **OpenAI** (GPT-4o-mini for fast, GPT-4o for strong) — switchable
- Switchable per-request from the UI dropdown or via API `provider` param
- Vision: GPT-4o Vision (OpenAI) or Claude Vision (Anthropic)
- Voice: Always OpenAI Whisper regardless of provider selection

### Price Memory Network
- User feedback writes to `community_prices` table automatically
- Stores: final_price, outcome, vendor_name, city, domain
- Future queries in the same area benefit from crowdsourced data
- Model selector dropdown in the frontend

### Auth & Security
- **Clerk** — Sign in/up with email, Google, GitHub
- Middleware-based auth (Next.js proxy pattern)
- Anonymous analysis supported (no login required for basic use)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + TypeScript + Tailwind CSS 4 |
| Auth | Clerk (free 10K MAU) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Backend | FastAPI (Python 3.13) |
| ORM | SQLAlchemy 2.0 (async) |
| Database | PostgreSQL (Railway) |
| Cache | Redis (Railway) |
| LLM | Anthropic Claude API + OpenAI API |
| Web Search | Tavily |
| Voice | OpenAI Whisper |
| Vision | GPT-4o Vision / Claude Vision |

---

## Project Structure

```
Faivri/
├── backend/                         # FastAPI application
│   ├── app/
│   │   ├── config.py                # Environment settings + provider config
│   │   ├── main.py                  # FastAPI app, CORS, lifespan, router mounts
│   │   ├── models/
│   │   │   ├── db.py                # SQLAlchemy tables (profiles, queries, pricing_knowledge, community_prices)
│   │   │   ├── enums.py             # Domain, Verdict, Country, Currency enums
│   │   │   └── schemas.py           # Pydantic request/response models
│   │   ├── intelligence/
│   │   │   ├── orchestrator.py      # Full pipeline: classify → cache → fetch → synthesize → store
│   │   │   ├── classifier.py        # LLM-based query classification
│   │   │   ├── knowledge.py         # PostgreSQL pricing_knowledge search
│   │   │   ├── web_search.py        # Tavily web search with market-specific queries
│   │   │   ├── synthesizer.py       # LLM verdict synthesis with domain context
│   │   │   └── cache.py             # Redis cache layer (24h TTL)
│   │   ├── domains/
│   │   │   └── auto.py              # Auto repair context (India vs US labor rates, scam patterns)
│   │   ├── routers/
│   │   │   ├── analyze.py           # POST /analyze, /analyze/image, /analyze/voice, GET /providers
│   │   │   ├── negotiate.py         # POST /negotiate (scripts + tactics generation)
│   │   │   ├── history.py           # GET /history, /history/:id, /savings/summary
│   │   │   └── feedback.py          # POST /feedback (report final price)
│   │   └── services/
│   │       ├── llm.py               # Model factory — OpenAI + Anthropic, vision, transcription
│   │       ├── database.py          # Async SQLAlchemy engine + session
│   │       ├── tavily.py            # Tavily search client
│   │       └── redis.py             # Redis cache client
│   ├── requirements.txt
│   └── .env                         # API keys (gitignored)
│
├── frontend/                        # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx           # Root layout + ClerkProvider + ambient background
│   │   │   ├── page.tsx             # Home — multimodal input, geolocation, model selector
│   │   │   ├── result/[id]/page.tsx # Verdict — overcharge display, gauge, red flags, evidence
│   │   │   ├── negotiate/[id]/      # Negotiation Lab — scripts, tactics, target price
│   │   │   ├── vault/page.tsx       # History — date-grouped, savings hero
│   │   │   ├── sign-in/             # Clerk sign-in
│   │   │   ├── sign-up/             # Clerk sign-up
│   │   │   └── globals.css          # Design system tokens, glass tiers, motion, ambient
│   │   ├── components/
│   │   │   └── layout/Nav.tsx       # Desktop top nav + mobile bottom tab bar
│   │   ├── lib/
│   │   │   ├── api.ts               # Typed API client (text, image, voice, history, negotiate)
│   │   │   ├── constants.ts         # Countries, cities, domains, price formatting (INR/USD)
│   │   │   └── motion.ts            # Unified motion system (3 durations, 2 easings, spring for KPI)
│   │   └── proxy.ts                 # Clerk middleware
│   └── .env.local                   # Clerk keys (gitignored)
│
├── scripts/
│   └── seed_auto_repair.py          # Dual-market seed data (392 items, India + US)
│
├── docs/
│   ├── IMPLEMENTATION-PLAN.md       # Phase 0 build plan
│   └── ROADMAP.md                   # Feature roadmap with groundbreaking ideas
│
└── .gitignore
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/analyze` | Analyze text query → verdict |
| `POST` | `/api/v1/analyze/image` | Upload bill photo → extract → verdict |
| `POST` | `/api/v1/analyze/voice` | Upload voice recording → transcribe → verdict |
| `GET` | `/api/v1/providers` | Available LLM providers + current default |
| `POST` | `/api/v1/negotiate` | Generate negotiation script for a verdict |
| `POST` | `/api/v1/feedback` | Report final price paid |
| `GET` | `/api/v1/history` | Paginated query history |
| `GET` | `/api/v1/history/:id` | Full verdict details |
| `GET` | `/api/v1/savings/summary` | Total savings statistics |
| `GET` | `/health` | Health check |

### Example: Analyze a Quote

```bash
curl -X POST http://localhost:8000/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Mechanic quoted ₹14,000 for brake pads and rotors on Honda City 2019 in Pune",
    "city": "Pune",
    "country": "IN"
  }'
```

Response:
```json
{
  "id": "154c74b1-...",
  "verdict": "overcharge",
  "overcharge_multiplier": 3.5,
  "fair_price_low": 400000,
  "fair_price_high": 700000,
  "currency": "INR",
  "confidence_score": 85,
  "explanation": "The quoted ₹14,000 is significantly overpriced...",
  "red_flags": ["Price is 3.5x higher than authorized Honda dealership pricing", "..."],
  "questions_to_ask": ["Can you provide an itemized breakdown?", "..."]
}
```

---

## Database Schema

**4 tables** on PostgreSQL (Railway):

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `profiles` | User accounts (via Clerk) | clerk_user_id, city, country, total_saved |
| `queries` | Every analysis request + verdict | domain, input_text, verdict, overcharge_multiplier, red_flags (JSONB), questions_to_ask (JSONB) |
| `pricing_knowledge` | Fair price database (seeded) | domain, category, item_name, price_low/high, city, country, currency, metadata (JSONB) |
| `community_prices` | Crowdsourced user-reported prices | service_type, price_paid, city, country, vendor_name |

All prices stored in **smallest currency unit** (paise for INR, cents for USD).

Indexes: `idx_pricing_lookup` (domain, country, city, category), `idx_queries_user_history` (user_id, created_at), `idx_community_lookup` (domain, city, country).

---

## Dual-Market Design

| Aspect | India | United States |
|--------|-------|---------------|
| Currency | INR (₹), stored in paise | USD ($), stored in cents |
| Cities | Mumbai, Pune, Bangalore, Delhi | New York, LA, Chicago, Houston |
| Car makes | Maruti, Honda, Hyundai, Toyota, Tata | Honda, Toyota, Ford, Chevrolet, Nissan |
| Labor rates | ₹300-1200/hr | $80-180/hr |
| Data sources | GoMechanic, MyTVS, CarDekho | RepairPal, KBB, AutoZone |
| Scam patterns | OEM markup on aftermarket parts, unnecessary replacements | Diagnostic fee padding, fluid flush upsells |

Country/city auto-detected from browser geolocation with manual override.

---

## Running Locally

### Prerequisites
- Python 3.11+ with pip
- Node.js 18+ with npm
- PostgreSQL (or Railway account)
- Redis (or Railway/Upstash account)
- Anthropic API key (with credits) and/or OpenAI API key

### Backend

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # or .venv/bin/activate.fish

# Install dependencies
pip install -r requirements.txt
pip install openai python-multipart greenlet

# Create .env (copy from .env.example and fill in keys)
cp .env.example .env

# Start server
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Create .env.local (copy from .env.local.example and fill in Clerk keys)
cp .env.local.example .env.local

# Start dev server
npm run dev
```

### Seed Data

```bash
# From project root
DATABASE_URL="postgresql+asyncpg://user:pass@host:port/db" \
  backend/.venv/bin/python scripts/seed_auto_repair.py
```

### Environment Variables

**Backend `.env`:**
```
DATABASE_URL=postgresql+asyncpg://...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...          # optional if using Anthropic
TAVILY_API_KEY=tvly-...
UPSTASH_REDIS_URL=redis://...
CLERK_SECRET_KEY=sk_test_...
CORS_ORIGINS=http://localhost:3000
DEFAULT_PROVIDER=anthropic          # or "openai"
```

**Frontend `.env.local`:**
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Design Approach

- **Dark mode** glassmorphism with tiered blur (16/24/32px)
- Single blue accent (`#5B7BF5`) for interactions; semantic colors only for outcomes (green=fair, red=overcharge)
- Unified motion system: 3 durations (120/220/420ms), 2 easings, spring reserved for verdict KPI
- Mobile bottom tab bar, responsive breakpoints at 640/768/1024px
- Gradient text limited to one key element per screen
- Ambient mesh background (slow rotation, low opacity)

---

## Test Queries

**India:**
- "Mechanic quoted ₹14,000 for brake pads and rotors on Honda City 2019 in Pune"
- "₹8,000 for full synthetic oil change on Hyundai Creta, Mumbai"
- "AC compressor replacement quoted ₹22,000, Maruti Swift, Bangalore"

**US:**
- "Quoted $800 for brake pads on 2020 Honda Civic in Houston"
- "$450 for a full synthetic oil change, Toyota Camry, New York"
- "$1,500 for timing belt replacement, Honda Accord, Los Angeles"

---

## Codebase Stats

| Metric | Count |
|--------|-------|
| Backend Python files | 20 |
| Frontend TypeScript files | 12 |
| Total source lines | ~2,900 |
| API endpoints | 10 |
| Database tables | 4 |
| Seed data items | 392 |
| Service categories | 25 |
| Supported cities | 8 (4 IN + 4 US) |
| LLM providers | 2 (Anthropic + OpenAI) |

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature roadmap. Highlights:

1. **Price Memory Network** — crowdsourced transaction data creates hyperlocal pricing intelligence
2. **WhatsApp Bot** — forward a bill photo, get verdict in 30 seconds (zero friction for India's 500M WhatsApp users)
3. **Ambient Price Scanner** — point camera at a bill, see fair prices overlaid in real-time
4. **Predictive Maintenance** — proactive alerts based on vehicle profile + mileage
5. **Group Negotiation** — batch users needing the same service, negotiate bulk rates with vendors
6. **Medical + Home domains** — expand beyond auto repair
7. **Vendor Transparency Scores** — public fairness ratings for service providers

---

## License

MIT
