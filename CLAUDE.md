# Faivri — Nozomio AI Nexus Hackathon

> AI negotiation agent built for Nozomio AI Nexus (May 9, 2026, SF).

## Tracks
- **Ship It** (Nia + InsForge) — production-deployed full-stack agent
- **Company Brain** (Nia + Hyperspell) — negotiation memory across all data
- **Always-On Agents** (Nia + Tensorlake) — background price monitors

## Sponsor Integrations

| Sponsor | Service file | Router | Env vars |
|---------|-------------|--------|----------|
| Nia | `backend/app/services/nia.py` | `backend/app/routers/nia.py` | `NIA_API_KEY`, `NIA_API_URL` |
| InsForge | `frontend/src/lib/insforge.ts` + `frontend/src/components/auth/InsForgeAuthProvider.tsx` | — | `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `INSFORGE_SERVICE_ROLE_KEY` |
| Hyperspell | `backend/app/services/hyperspell.py` | `backend/app/routers/hyperspell.py` | `HYPERSPELL_API_KEY`, `HYPERSPELL_API_URL` |
| Tensorlake | `backend/app/services/tensorlake.py` | `backend/app/routers/tensorlake.py` | `TENSORLAKE_API_KEY`, `TENSORLAKE_API_URL` |

All services have fallback simulation mode when API keys are absent. The `/integrations` endpoint honestly reports which are live.

## Key Conventions
- Auth: InsForge replaces Clerk entirely. `useAuth()` from `InsForgeAuthProvider` is the drop-in replacement for `useUser()`.
- The `gmi_cloud.py` / `hydradb.py` / `photon.py` files are internal implementations (LLM routing, Postgres memory, reply drafting). They still work but are no longer user-facing brands.
- User-visible sponsor names are Nia, Hyperspell, Tensorlake, and InsForge only.
- Frontend sponsor client: `frontend/src/lib/sponsors.ts`

## Project Structure
```
backend/
  app/
    services/
      nia.py              # Nia context search
      hyperspell.py        # Hyperspell durable memory
      tensorlake.py        # Tensorlake sandbox monitors
      photon.py            # Reply-drafting orchestrator (internal)
      hydradb.py           # Postgres memory layer (internal)
      gmi_cloud.py         # LLM routing (internal)
    routers/
      nia.py               # /api/v1/nia/search
      hyperspell.py        # /api/v1/hyperspell/*
      tensorlake.py        # /api/v1/tensorlake/*
frontend/
  src/
    lib/
      insforge.ts          # InsForge SDK wrapper
      sponsors.ts          # Nia/Hyperspell/Tensorlake frontend clients
    components/
      auth/
        InsForgeAuthProvider.tsx  # Auth context (replaces Clerk)
        AuthModal.tsx             # Sign-in/up modal
```
