# Faivri — AI Negotiation Agent

> Built for **Nozomio AI Nexus** hackathon (May 9, 2026, San Francisco).

Faivri is an AI-powered consumer protection agent that analyzes prices, detects overcharges, and drafts negotiation replies. It runs 24/7, remembers every negotiation, and gets smarter over time.

## Tracks

Faivri targets three hackathon tracks simultaneously:

| Track | Sponsors | How Faivri uses them |
|---|---|---|
| **Ship It** — Full-Stack Agents | Nia + InsForge | Production-deployed app with InsForge auth + DB; Nia indexes pricing docs for real-time context |
| **Company Brain** | Nia + Hyperspell | Hyperspell ingests negotiation history across Slack/email/docs; agents reason with full context |
| **Always-On Agents** | Nia + Tensorlake | Tensorlake sandboxes run background price monitors that wake on schedule and remember state |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  Frontend (Next.js 15 + Vercel)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐│
│  │ InsForge Auth│  │ Analyzer UI  │  │ Messages UI  ││
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘│
└─────────┼────────────────┼──────────────────┼────────┘
          │                │                  │
┌─────────▼────────────────▼──────────────────▼────────┐
│  Backend (FastAPI + Postgres via InsForge)             │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Nia      │  │Hyperspell │  │ Tensorlake       │  │
│  │ Search   │  │ Memory    │  │ Price Monitors   │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Analyze  │  │ Negotiate │  │ Reply Coach      │  │
│  └──────────┘  └───────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Sponsor Integrations

### Nia (mandatory — all tracks)
- **What**: Context augmentation layer that indexes repos, docs, PDFs, and data sources
- **How Faivri uses it**: When analyzing a price, Faivri queries Nia for fair-market data, pricing trends, and consumer reports. This eliminates hallucination — every verdict is grounded in indexed, current sources.
- **API**: `POST /api/v1/nia/search` — search for pricing context
- **Env vars**: `NIA_API_KEY`, `NIA_API_URL`

### InsForge (Ship It track)
- **What**: Backend for agentic development — auth, database, storage, edge functions
- **How Faivri uses it**: Replaces Clerk auth with InsForge's auth SDK. All user accounts, sessions, and database queries go through InsForge's managed Postgres.
- **Env vars**: `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `INSFORGE_SERVICE_ROLE_KEY`

### Hyperspell (Company Brain track)
- **What**: The company brain for AI agents — ingests Slack, Gmail, Drive, GitHub, Notion
- **How Faivri uses it**: Stores negotiation outcomes, seller patterns, and learned strategies. When a user starts a new negotiation, Hyperspell retrieves relevant past sessions so the agent reasons with full context, not just the latest query.
- **API**: `POST /api/v1/hyperspell/memories`, `POST /api/v1/hyperspell/query`
- **Env vars**: `HYPERSPELL_API_KEY`, `HYPERSPELL_API_URL`

### Tensorlake (Always-On track)
- **What**: Stateful sandbox compute — isolated execution environments for agents
- **How Faivri uses it**: Spawns background price monitors in Tensorlake sandboxes. These run on schedules, watch for price changes, and alert users when a deal drops into fair range. The monitor remembers what it saw across invocations.
- **API**: `POST /api/v1/tensorlake/monitors`, `GET /api/v1/tensorlake/monitors`
- **Env vars**: `TENSORLAKE_API_KEY`, `TENSORLAKE_API_URL`

## Quick Start

```bash
# Backend
cd backend
cp .env.example .env   # fill in API keys
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
cp .env.local.example .env.local   # fill in InsForge + API URLs
npm install
npm run dev
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/analyze` | Analyze a price quote for fairness |
| POST | `/api/v1/negotiate` | Generate negotiation strategy |
| POST | `/api/v1/messages/draft` | Draft a seller reply |
| POST | `/api/v1/nia/search` | Search Nia for pricing context |
| POST | `/api/v1/hyperspell/memories` | Store negotiation memory |
| POST | `/api/v1/hyperspell/query` | Query past negotiations |
| POST | `/api/v1/tensorlake/monitors` | Create background price monitor |
| GET | `/api/v1/tensorlake/monitors` | List active monitors |
| GET | `/integrations` | Check which sponsor integrations are live |

## Fallback Mode

All sponsor integrations degrade gracefully when API keys are absent:
- **Nia**: Returns simulated market intelligence
- **Hyperspell**: Returns simulated negotiation memories
- **Tensorlake**: Returns simulated price monitors

The `/integrations` endpoint honestly reports which sponsors are live based on key configuration — no fake "Powered by" badges.

## Hackathon Credits

| Sponsor | How to access |
|---------|---------------|
| Nia | Code `NIAHACK` at app.trynia.ai → Billing |
| InsForge | $100 credits at insforge.dev/promo/NIA |
| Tensorlake | Free access on May 9th |
| Hyperspell | Free access on May 9th |
| Vercel | Deploy with zero config |
