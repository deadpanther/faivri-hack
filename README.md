# Faivri — AI Negotiation Agent

> Built for **Nozomio AI Nexus** (May 9, 2026, San Francisco) — **Ship It track** (Nia + InsForge).

Faivri is an AI consumer-protection agent. Paste a price quote, get back a verdict (`fair` / `slight overcharge` / `overcharge` / `severe overcharge`), a defensible fair-market range, and a ready-to-send negotiation reply — every dollar grounded in live web evidence and a Nia-curated synthesis. No hallucinated numbers, no "trust me bro" verdicts, full source receipts.

## Demo

- **Live**: https://faivri.com
- **Sign in with InsForge**, paste a quote like *"2018 Honda Civic LX, 70k miles, dealer asking $14,500 in San Francisco"*, hit Analyze.
- The verdict card shows the fair range, sources, and the synthesized Nia answer. The `Negotiate` button drafts a reply you can copy-paste to the seller.

## Ship It architecture (Nia + InsForge)

```
 ┌──────────────────────────────────────────────────────────────┐
 │  Frontend (Next.js 15)                                       │
 │  ┌──────────────────────┐   ┌──────────────────────────────┐ │
 │  │ InsForge Auth (PKCE) │   │ Analyzer + Negotiate UI      │ │
 │  └──────────┬───────────┘   └──────────────┬───────────────┘ │
 └─────────────┼──────────────────────────────┼─────────────────┘
               │   InsForge JWT               │
 ┌─────────────▼──────────────────────────────▼─────────────────┐
 │  FastAPI backend                                             │
 │  ┌────────────────────────────────────────────────────────┐  │
 │  │  /api/v1/analyze                                       │  │
 │  │     │                                                  │  │
 │  │     ├── NiaAgent.gather_evidence()  ── parallel ──┐    │  │
 │  │     │     ├─ Tavily web search    (broad recall)  │    │  │
 │  │     │     └─ Nia /v2/query        (synthesis +    │    │  │
 │  │     │                              retrieval log) │    │  │
 │  │     │                                             │    │  │
 │  │     ├── extract_prices_from_results (regex, Py)   │    │  │
 │  │     ├── build_fair_range (trust-weighted, Py)     │    │  │
 │  │     └── verdict + sources.nia.{retrieval_log_id,  │    │  │
 │  │                                  query_time_ms,   │    │  │
 │  │                                  answer, …}       │    │  │
 │  └────────────────────────────────────────────────────────┘  │
 │  Postgres (InsForge): users, sessions, queries, verdicts,    │
 │                       extracted_prices, drafts               │
 └──────────────────────────────────────────────────────────────┘
```

**Why two retrieval providers?** Tavily gives breadth and recency on the open web; Nia adds a synthesized, citable answer plus a `retrieval_log_id` we surface to the user as proof of grounding. They run concurrently via `asyncio.gather`, results dedupe by URL, and the unchanged price-extraction pipeline consumes both — Nia evidence flows through with a `provider: "nia"` tag, no special-case branches downstream.

## Sponsor integrations

### Nia — agentic search backbone (load-bearing)
- **Endpoint**: `POST https://apigcp.trynia.ai/v2/query` with `{messages:[{role,content}]}`
- **Where it lives in code**:
  - [`backend/app/services/nia.py`](backend/app/services/nia.py) — Nia client (late-bound key/URL, Tavily-shape result reshape, `/v2/contexts` save hook)
  - [`backend/app/intelligence/nia_agent.py`](backend/app/intelligence/nia_agent.py) — parallel Tavily + Nia fan-out + URL dedup
  - [`backend/app/routers/nia.py`](backend/app/routers/nia.py) — `POST /api/v1/nia/search` exposes the raw oracle
- **Surfaced in verdict response** under `sources.nia` so the UI and judges can see Nia is real:
  ```json
  "sources": {
    "nia": {
      "live": true,
      "results_count": 10,
      "answer_present": true,
      "answer": "Based on indexed sources, used Civic LX values cluster …",
      "query_time_ms": 6854,
      "sources_searched": 8,
      "retrieval_log_id": "89a876d5-73c3-49a4-9ffb-c90fdafec343"
    },
    "tavily": { "results_count": 23 }
  }
  ```
- **Fallback**: if `NIA_API_KEY` is unset, `_simulate_search` returns the same shape with `live: false` so callers never branch on provider availability.

### InsForge — auth + Postgres (load-bearing)
- **Frontend SDK**: [`frontend/src/lib/insforge.ts`](frontend/src/lib/insforge.ts) wraps `@insforge/sdk` with PKCE OAuth.
- **Provider**: [`frontend/src/components/auth/InsForgeAuthProvider.tsx`](frontend/src/components/auth/InsForgeAuthProvider.tsx) is a drop-in `useAuth()` replacement for Clerk.
- **Backend verification**: [`backend/app/services/auth.py`](backend/app/services/auth.py) verifies the InsForge JWT against `{insforge_url}/api/auth/sessions/current` on every request. Every analyze/negotiate write is keyed to the InsForge user id.
- **Storage**: managed Postgres provisioned through InsForge holds the full user, query, verdict, extracted-price, and draft history (17 Alembic migrations).

### Hyperspell + Tensorlake (next track, scaffolded)
[`backend/app/services/hyperspell.py`](backend/app/services/hyperspell.py) and [`backend/app/services/tensorlake.py`](backend/app/services/tensorlake.py) are wired and exposed at `/api/v1/hyperspell/*` and `/api/v1/tensorlake/*`. They are **scaffolded but not load-bearing for the Ship It demo** — they degrade to deterministic stubs when keys are unset. Roadmap is in [docs/roadmap.md](docs/roadmap.md).

## Run locally

```bash
# Backend (FastAPI on :8008)
cd backend
cp .env.example .env                 # fill TAVILY_API_KEY, NIA_API_KEY, INSFORGE_*
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --host 127.0.0.1 --port 8008 --reload

# Frontend (Next.js on :3000)
cd ../frontend
cp .env.local.example .env.local     # fill NEXT_PUBLIC_INSFORGE_URL + KEY, API URL
npm install
npm run dev
```

Sanity check: `curl http://127.0.0.1:8008/integrations` should report `nia.live: true` and `insforge.live: true`.

## API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/v1/analyze` | InsForge JWT | Run the full NiaAgent + fair-range + verdict pipeline |
| POST | `/api/v1/negotiate` | InsForge JWT | Generate a strategy + draft reply for a verdict |
| POST | `/api/v1/messages/draft` | InsForge JWT | Re-draft a reply with a different tone |
| POST | `/api/v1/nia/search` | optional | Raw Nia `/v2/query` passthrough |
| GET  | `/integrations` | none | Honest live/dry-run status per sponsor |

## What we will NOT do

- **No LLM-picked dollar numbers.** Prices are extracted by regex from Tavily/Nia content, then aggregated with trust-weighted statistics in plain Python. The LLM only writes narrative around numbers it never chose.
- **No fake "powered by" badges.** `/integrations` is the source of truth. If a sponsor's key is missing, the UI says so.

## Hackathon credits

| Sponsor | Access |
|---------|--------|
| Nia | Code `NIAHACK` at app.trynia.ai → Billing |
| InsForge | $100 credits at insforge.dev/promo/NIA |
| Tensorlake | Free access on May 9 |
| Hyperspell | Free access on May 9 |
