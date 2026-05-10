# Deployment Runbook

How to deploy FairCheck to Railway (backend) + Vercel (frontend), run migrations, and handle common operations. Updated 2026-04-30.

## Surfaces

| Surface | Provider | Service | URL |
|---|---|---|---|
| Backend API | Railway | `faivri-api` | `https://faivri-api.up.railway.app` |
| Frontend | Vercel | (default project) | `https://faivri.com` |
| DB | Railway Postgres (asyncpg) | linked to backend | — |
| Cache | Upstash Redis | external | — |

## Prerequisites

```bash
# CLIs
brew install railway        # Railway CLI
npm i -g vercel             # Vercel CLI
brew install postgresql     # psql (for ad-hoc DB ops)

# Auth once
railway login
vercel login

# Link this repo to the Railway project
cd backend && railway link   # pick the FairCheck project
```

## Backend deploy (Railway)

> ⚠️ `railway redeploy` only restarts the **same image** — it does NOT pull new code.
> Always use `railway up` for a fresh build.

```bash
cd backend
railway up --service faivri-api --ci --detach
```

`--ci` disables the interactive UI; `--detach` returns immediately. Monitor with:

```bash
railway logs --service faivri-api
```

### Migrations (must run separately)

The Procfile only runs `uvicorn` — Alembic migrations do **not** run on deploy.
After any `alembic revision`, run:

```bash
cd backend
railway run --service faivri-api alembic upgrade head
```

Verify with the deep health probe (compares DB's `alembic_version` to local heads):

```bash
curl -s https://faivri-api.up.railway.app/health/deep | jq
```

Expect `checks.migrations: "ok"`. If you see `error: drift (db=[X], expected=[Y])`,
re-run `alembic upgrade head`.

### Environment variables

```bash
railway variables --service faivri-api                   # list
railway variables --service faivri-api --set KEY=value   # set
railway variables --service faivri-api --set KEY=value --skip-deploys   # set without auto-redeploy
```

Required vars (fail-fast at boot in production):

- `CORS_ORIGINS` — comma-separated list (e.g. `https://faivri.com,https://www.faivri.com`).
  Cannot include `*` (CORS spec forbids it with credentials). Cannot be localhost-only.
- `ADMIN_API_KEY` — protects `/admin/*` endpoints. Without it, those routes always 403.
  Generate with `python -c "import secrets; print(secrets.token_urlsafe(40))"`.
- `DATABASE_URL` — set automatically by Railway Postgres.
- `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` — from Upstash.
- `CLERK_SECRET_KEY` — from Clerk dashboard.
- `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`.
- `TAVILY_API_KEY` — primary search provider.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` — for billing.

## Frontend deploy (Vercel)

```bash
cd frontend
vercel --prod                       # build + deploy from local
# or push to main and let the GitHub integration handle it
```

Environment variables live in the Vercel dashboard. Required:

- `NEXT_PUBLIC_API_URL` — `https://faivri-api.up.railway.app`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Common operations

### Reset a user's monthly quota

Emails live in Clerk, not our DB — look up `clerk_user_id` first, then update Postgres.

```bash
# 1. Resolve email → clerk_user_id (use Clerk Backend API)
EMAIL="user@example.com"
CLERK_KEY=$(railway variables --service faivri-api --kv | grep CLERK_SECRET_KEY | cut -d= -f2-)
CLERK_USER_ID=$(curl -s -H "Authorization: Bearer $CLERK_KEY" \
  "https://api.clerk.com/v1/users?email_address=$EMAIL" | jq -r '.[0].id')

# 2. Reset quota in Postgres
DB_URL=$(railway variables --service faivri-api --kv | grep ^DATABASE_URL= | cut -d= -f2-)
PSQL_URL=$(echo "$DB_URL" | sed 's|postgresql+asyncpg://|postgresql://|')
psql "$PSQL_URL" -c "UPDATE profiles SET queries_this_month = 0, usage_reset_at = NOW() WHERE clerk_user_id = '$CLERK_USER_ID';"
```

> Gotcha: `DATABASE_URL` uses the `postgresql+asyncpg://` SQLAlchemy prefix. `psql`
> rejects it — strip to `postgresql://` first (the `sed` line above).

### Tail production logs

```bash
railway logs --service faivri-api
railway logs --service faivri-api -f   # follow
```

### Rollback

```bash
# List recent deployments
railway deployments --service faivri-api

# Redeploy a previous one
railway redeploy --service faivri-api --deployment <id>
```

(`railway redeploy` is the right tool here — we *want* the same image.)

### Rotate `ADMIN_API_KEY`

```bash
NEW=$(python -c "import secrets; print(secrets.token_urlsafe(40))")
railway variables --service faivri-api --set "ADMIN_API_KEY=$NEW" --skip-deploys
# Then redeploy when convenient:
railway up --service faivri-api --ci --detach
```

## Post-deploy verification

```bash
# Health
curl -s https://faivri-api.up.railway.app/health
curl -s https://faivri-api.up.railway.app/health/deep | jq '.status, .checks'

# Frontend
curl -sI https://faivri.com | head -1
```

Expect `200 OK` from `/health`, `status: ok` from `/health/deep`, and a `200` from
the frontend.
