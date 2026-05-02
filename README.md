# Faivri

**AI-powered negotiation agent.** Reclaim the ~$1,200 you overpay every year on quotes, repairs, and marketplace listings. Faivri delivers an instant fair-market verdict and writes the polite, data-backed reply you can send straight to the seller.

> Built for **Build Matcha & Code**.

---

## What it does

```
You forward a quote (text, photo, voice, or paste a listing)
            │
            ▼
   Classify → cache check → live web search → synthesise verdict
            │
            ▼
   Verdict: fair / high / overcharge  +  fair-price range  +  red flags
            │
            ▼
   Negotiation memory recorded in HydraDB
   (walk-away ceiling, target offer, seller tone, price-point timeline)
            │
            ▼
   Photon drafts the next reply, grounded in the memory above
```

**Example.** "Mechanic quoted $850 for brake pads on a 2019 Honda Civic in Austin"
→ **2.4× OVERCHARGED** · Fair range: $280–$420 · 87% confidence from 18 sources
→ Photon draft (polite tone): *"Thanks for getting back to me. The going rate around Austin for this job is $280–$420 — could you do $340 cash today?"*

---

## Stack

### Core platform
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 + React 19 + TypeScript + Tailwind 4 |
| Backend | FastAPI + Python 3.13 + SQLAlchemy (async) + asyncpg |
| Database | PostgreSQL (Railway) + Redis (Upstash, 4h cache TTL) |
| Auth | Clerk (free 10K MAU, anonymous access supported) |
| Live search | Tavily (primary) + Firecrawl (Extension Pro) |
| LLM | Anthropic Claude (default) or OpenAI, switchable per-request |
| Voice | OpenAI Whisper |
| Vision | Claude Vision / GPT-4o Vision |
| Payments | Stripe (Lemon Squeezy retired) |
| Animations | Framer Motion |

### Faivri partner integrations
Every partner integration is **optional** — Faivri ships a graceful fallback when the key is unset, and the `/integrations` endpoint reports honestly which ones are live in your deploy.

| Partner | Role | File | Fallback when unset |
|---------|------|------|---------------------|
| **GMI Cloud** | Real-time GPU inference fleet | `backend/app/services/gmi_cloud.py` | Routes through Anthropic / OpenAI directly |
| **HydraDB** | Negotiation memory (walk-away, seller tone, price timeline) | `backend/app/services/hydradb.py` + `negotiation_sessions` table | Memory writes are skipped; verdicts still ship |
| **Photon** | Messaging assistant — drafts polite, data-backed seller replies | `backend/app/services/photon.py` + `/api/v1/messages/draft` | Falls back to managed LLM via GMI Cloud adapter |

---

## Run locally

### Prereqs
Python 3.11+, Node 18+, PostgreSQL, Redis (or Upstash), at least one of {Anthropic, OpenAI} API key, Tavily API key.

### Backend
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in keys (see below)
alembic upgrade head   # applies migrations including HydraDB sessions
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local   # Clerk + API URL
npm run dev   # http://localhost:3000
```

### Required env vars
```env
# Backend (.env)
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/faivri
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-proj-xxx
TAVILY_API_KEY=tvly-xxx
UPSTASH_REDIS_URL=redis://default:xxx@host:port
CLERK_SECRET_KEY=sk_test_xxx
CORS_ORIGINS=http://localhost:3000
DEFAULT_PROVIDER=anthropic

# Faivri partners — all optional
GMI_CLOUD_API_KEY=                # GPU inference fleet (falls back to Anthropic/OpenAI)
GMI_CLOUD_BASE_URL=https://api.gmicloud.ai/v1
GMI_CLOUD_TIMEOUT=8.0
HYDRADB_ENABLED=true              # Negotiation memory (rides on Postgres)
```

```env
# Frontend (.env.local)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## API — most-used endpoints

All routes are mounted at `/api/v1`.

### Analysis
| Method | Path | Notes |
|--------|------|-------|
| POST | `/analyze` | Text query → verdict |
| POST | `/analyze/image` | Photo of bill / receipt → vision OCR → verdict |
| POST | `/analyze/voice` | Audio blob → Whisper → verdict |
| POST | `/analyze/purchase/json` | Used-car valuation |

### Negotiation
| Method | Path | Notes |
|--------|------|-------|
| POST | `/negotiate` | Generate negotiation scripts + tactics |
| POST | `/negotiate/counter` | Counter-offer response |
| POST | `/negotiate/purchase-chat` | Live used-car chat coach |

### Photon — messaging assistant **(new)**
| Method | Path | Notes |
|--------|------|-------|
| POST | `/messages/draft` | Reads HydraDB memory + drafts a polite reply (`tone`: polite / firm / walk_away / friendly) |

### HydraDB — negotiation memory **(new)**
| Method | Path | Notes |
|--------|------|-------|
| GET | `/memory/sessions` | List the user's recent negotiations with summary memory |
| GET | `/memory/sessions/{query_id}` | Full snapshot for one negotiation (price timeline, walk-away, seller tone, prior turns) |

### Platform
| Method | Path | Notes |
|--------|------|-------|
| GET | `/integrations` | Honest "Powered by ..." status — only reports partners whose keys are configured |
| GET | `/health` | Liveness probe |
| GET | `/health/deep` | DB + Redis + migration drift check |

The full router list (`history`, `community`, `vehicles`, `recommend`, `share`, `extension`, `billing`, etc.) lives in [`docs/BACKEND.md`](docs/BACKEND.md).

---

## Project layout

```
Faivri/
├── backend/
│   ├── app/
│   │   ├── main.py                       # FastAPI app, CORS, router mounts, /integrations
│   │   ├── config.py                     # Env settings (incl. GMI_CLOUD_API_KEY, HYDRADB_ENABLED)
│   │   ├── intelligence/                 # Orchestrator → classifier → web_search → synthesizer
│   │   ├── domains/                      # Auto, medical, home, legal prompt context
│   │   ├── routers/
│   │   │   ├── analyze.py                # Text / image / voice analysis
│   │   │   ├── negotiate.py              # Scripts, counter-offers, purchase chat
│   │   │   ├── messages.py               # Photon reply coach
│   │   │   ├── memory.py                 # HydraDB session reads
│   │   │   └── … (history, community, vehicles, recommend, share, extension, billing)
│   │   ├── services/
│   │   │   ├── llm.py                    # Anthropic + OpenAI factory, vision, transcription
│   │   │   ├── gmi_cloud.py              # GMI Cloud GPU adapter (wraps llm.py)
│   │   │   ├── hydradb.py                # Negotiation memory layer over Postgres
│   │   │   ├── photon.py                 # Reply-drafting orchestrator
│   │   │   ├── tavily.py · redis.py · firecrawl.py · auth.py · geo.py · …
│   │   └── models/db.py                  # SQLAlchemy schema (incl. NegotiationSession)
│   ├── alembic/versions/                 # Migrations 0001 → 0017_hydradb_negotiation_sessions
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                  # PreLoginLanding | AnalyzerStudio
│   │   │   ├── result/[id]/              # Verdict display
│   │   │   ├── negotiate/[id]/           # Negotiation lab
│   │   │   ├── messages/                 # Photon reply coach UI (new)
│   │   │   ├── vault/ · community/ · garage/ · used-cars/ · pricing/ · billing/ · docs/
│   │   ├── components/
│   │   │   ├── home/                     # PreLoginLanding, AnalyzerStudio, …
│   │   │   ├── layout/                   # Nav, Footer, LanguageDropdown
│   │   │   └── ui/ · auth/ · pwa/ · share/ · used-cars/
│   │   └── lib/
│   │       ├── api.ts                    # Typed API client (incl. draftMessageReply, listMemorySessions)
│   │       ├── constants.ts              # Domains, US states/cities, formatPrice
│   │       └── motion.ts                 # Motion presets
│   └── package.json
│
├── extension/                            # Chrome extension (seller risk, listing watch, reply coach)
├── sdk/                                  # @faivri/sdk TypeScript client
├── scripts/                              # Seed + e2e tests
└── docs/                                 # ARCHITECTURE.md, BACKEND.md, FRONTEND.md, …
```

---

## Architecture principles

1. **Live data first.** Tavily web search is the primary pricing source; the Postgres `pricing_knowledge` table is a supplementary fallback so the app stays fresh without manual data maintenance.
2. **Split cache.** Redis caches *fair-price baselines* (4h TTL), not per-quote verdicts. The overcharge multiplier is recomputed on every request from the user's specific `quoted_price`, so the same baseline serves every quote correctly.
3. **Optional everything.** Anonymous queries are allowed (Clerk auth is non-blocking). Partner integrations (GMI Cloud, HydraDB) are feature-flagged so the platform degrades cleanly when keys are missing.
4. **Multi-provider LLM.** Anthropic and OpenAI are interchangeable per-request. GMI Cloud sits in front of both as the preferred GPU fleet; the circuit breaker auto-fails over on outage.
5. **Honest "powered by".** The landing page only credits a partner when the integration is actually live — `GET /integrations` is the source of truth.

---

## Database

PostgreSQL with **6 primary tables** (plus billing / webhook / session bookkeeping):

| Table | Purpose |
|-------|---------|
| `profiles` | Clerk-linked accounts, plan, Stripe IDs, savings tracking |
| `queries` | Every analysis result — verdict, fair range, red flags, sources |
| `pricing_knowledge` | Seeded reference data (392 items, India + US auto repair) |
| `community_prices` | Crowdsourced final-price reports → community feed |
| `negotiation_conversations` | Persistent chat log for the negotiation coach |
| **`negotiation_sessions`** | **HydraDB memory header** — walk-away, target, seller tone, price-point timeline |

All currency stored in smallest unit (cents / paise). Migrations are managed by Alembic; `alembic upgrade head` is required after pulling.

---

## Roadmap

- **Now:** GMI Cloud GPU adapter, HydraDB memory, Photon messaging assistant, Stripe billing, Chrome extension Pro.
- **Next:** WhatsApp / SMS reply bot (Photon endpoint already exists), ambient camera price scanner, group negotiation, vendor transparency scores.

See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the full feature roadmap.

---

## License

MIT
