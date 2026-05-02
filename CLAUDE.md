# Faivri

AI-powered negotiation agent. Reclaim the ~$1,200 most consumers overpay every year on quotes, repairs, and marketplace listings — Faivri delivers an instant fair-market verdict via live web search + LLM synthesis, then drafts a polite, data-backed seller reply.

> Built for **Build Matcha & Code**. (Faivri started life as "FairCheck" — assume any lingering "FairCheck" string is a stale reference and replace it with "Faivri" when you touch that file.)

## Documentation

Read these before making changes:
- `docs/ARCHITECTURE.md` — System design, data flows, external dependencies, caching strategy
- `docs/BACKEND.md` — FastAPI endpoints, database schema, intelligence pipeline, env vars, LLM config
- `docs/FRONTEND.md` — Next.js pages, components, API client, design system, motion system

## Quick Reference

### Stack
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 4 + Clerk auth
- **Backend:** FastAPI + Python 3.13 + SQLAlchemy (async) + asyncpg
- **Database:** PostgreSQL (6 primary tables) + Redis (Upstash, 4h cache TTL)
- **LLM:** Anthropic Claude (default) or OpenAI (switchable per-request)
- **Search:** Tavily (live web pricing — primary source) + Firecrawl (Extension Pro only)

### Faivri partner integrations (all optional, all feature-flagged)
- **GMI Cloud** — `backend/app/services/gmi_cloud.py`. Preferred GPU inference fleet. Wraps `app/services/llm.py`; falls back to Anthropic/OpenAI when `GMI_CLOUD_API_KEY` is unset.
- **HydraDB** — `backend/app/services/hydradb.py` + `negotiation_sessions` table (Alembic 0017). Negotiation memory layer (walk-away ceilings, seller tone, price-point timeline) on top of Postgres. No separate connection — it's a capability, not a database.
- **Photon** — `backend/app/services/photon.py` + `/api/v1/messages/draft`. Reads HydraDB memory and drafts polite, data-backed seller replies. Tone toggle: polite / firm / walk_away / friendly.

`GET /integrations` reports honestly which partners are live so the landing page only credits ones whose keys are configured.

### Run Locally
```bash
# Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev   # http://localhost:3000
```

After pulling, run `alembic upgrade head` to pick up `negotiation_sessions` (and any other new migrations).

### Key Directories
```
backend/app/intelligence/   # AI pipeline (orchestrator, classifier, synthesizer, cache)
backend/app/routers/        # API routers at /api/v1 (incl. messages.py, memory.py)
backend/app/domains/        # Domain-specific prompt context (auto, medical, home, legal)
backend/app/services/       # External + partner integrations
                            #   llm.py, tavily.py, redis.py, geo.py, auth.py
                            #   gmi_cloud.py, hydradb.py, photon.py   ← Faivri partners
frontend/src/app/           # Next.js App Router pages (incl. /messages for Photon UI)
frontend/src/components/    # UI components
frontend/src/lib/api.ts     # Typed API client (incl. draftMessageReply, listMemorySessions)
```

### Architecture Principles
1. **Live Data First** — Tavily web search is primary; PostgreSQL knowledge base is supplementary fallback.
2. **Split Cache** — Cache fair-price baselines (4h TTL), not per-quote verdicts. Overcharge multiplier is computed fresh from the user's `quoted_price` against the baseline.
3. **Optional Auth** — Anonymous queries allowed; Clerk adds history, savings tracking, and HydraDB memory attribution.
4. **Multi-Provider** — Anthropic/OpenAI switchable; fast models classify, strong models synthesize. GMI Cloud sits in front as the preferred GPU fleet with circuit-breaker fallback to managed providers.
5. **Honest Partner Credits** — Never claim "powered by X" on the UI when the integration isn't actually live in the running deploy. The `served_by` field on responses (and `/integrations`) is the source of truth.
