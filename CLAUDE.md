# FairCheck

AI-powered consumer protection platform. Analyzes service quotes via live web search + LLM synthesis to detect overcharging, then provides negotiation coaching.

## Documentation

Read these before making changes:
- `docs/ARCHITECTURE.md` — System design, data flows, external dependencies, caching strategy
- `docs/BACKEND.md` — FastAPI endpoints, database schema, intelligence pipeline, env vars, LLM config
- `docs/FRONTEND.md` — Next.js pages, components, API client, design system, motion system

## Quick Reference

### Stack
- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind 4 + Clerk auth
- **Backend:** FastAPI + Python 3.13 + SQLAlchemy (async) + asyncpg
- **Database:** PostgreSQL (5 tables) + Redis (Upstash, 4h cache TTL)
- **LLM:** Anthropic Claude (default) or OpenAI (switchable per-request)
- **Search:** Tavily (live web pricing data — primary source)

### Run Locally
```bash
# Backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend && npm run dev   # http://localhost:3000
```

### Key Directories
```
backend/app/intelligence/   # AI pipeline (orchestrator, classifier, synthesizer, cache)
backend/app/routers/        # 7 API routers at /api/v1
backend/app/domains/        # Domain-specific prompt context (auto, medical, home, legal)
backend/app/services/       # External integrations (LLM, Tavily, Redis, Clerk, Geo)
frontend/src/app/           # Next.js App Router pages
frontend/src/components/    # UI components
frontend/src/lib/api.ts     # Typed API client (all backend calls)
```

### Architecture Principles
1. **Live Data First** — Tavily web search is primary; DB is fallback
2. **Split Cache** — Cache baselines, not verdicts; multiplier computed fresh per quote
3. **Optional Auth** — Anonymous queries allowed; Clerk adds history/savings tracking
4. **Multi-Provider** — Anthropic/OpenAI switchable; fast models classify, strong models synthesize
