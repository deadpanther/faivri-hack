# Overnight launch-prep changes (2026-04-17 → 2026-04-18)

Everything below is **committed locally only** — nothing has been pushed to
Railway or the frontend host. Test locally, then `git push` when you're ready.

## TL;DR

1. **$70 Marketplace bag quoted at $10 — fixed.** Retail domain now uses
   used-market queries (eBay sold / Marketplace / Mercari) and weights those
   domains higher than pristine retail (Amazon / Walmart) whenever the user is
   pricing a secondhand listing.
2. **"Sometimes /negotiate returns nothing" — fixed.** The endpoint now retries
   once and, on total LLM failure, returns a deterministic fallback playbook so
   the extension never sees a 502.
3. **Conversational negotiation coach** — new `POST /api/v1/negotiate/chat` +
   `GET /api/v1/negotiate/chat/:query/:session` endpoints. Session state lives
   in a new `negotiation_conversations` table so the user can keep chatting
   after the seller replies. Bound to the extension overlay UI.
4. **Extension pill moved to top-right, slightly larger.** Bumped to v0.4.0.
5. **Pricing page** gets a dedicated extension-pricing section (included in
   Signal+, optional Extension Pro add-on).

## What changed, file by file

### Backend

| File | Change |
| --- | --- |
| `app/intelligence/web_search.py` | Platform-aware Tavily queries. Retail + marketplace → used-market search terms (`ebay sold listings`, `facebook marketplace used price`, …). New `detect_listing_platform()` heuristic. |
| `app/intelligence/evidence.py` | New `USED_MARKET_DOMAINS`, `PRISTINE_RETAIL_DOMAINS`, `_calibrate_trust_for_platform()`. Per-source trust gets boosted/dampened before feeding the weighted percentile math whenever the listing platform is secondhand. |
| `app/intelligence/orchestrator.py` | Threads `listing_platform` through `process_query` and `refresh_query_baseline` → `search_web` → `extract_prices_from_results`. |
| `app/models/db.py` | New `NegotiationConversation` ORM model. |
| `alembic/versions/0006_negotiation_conversations.py` | Migration: creates `negotiation_conversations` table + unique `(query_id, session_id)` index + `(user_id, created_at)` index. **Must be run on Railway before /chat works.** |
| `app/models/schemas.py` | `NegotiationChatRequest`, `NegotiationChatMessage`, `NegotiationChatResponse`. |
| `app/services/llm.py` | New `continue_negotiation_chat()` + `_fallback_chat_turn()` + `build_fallback_negotiation()`. |
| `app/routers/negotiate.py` | Retry-with-fallback on `/negotiate`, new `/negotiate/chat` POST + `/negotiate/chat/:q/:s` GET. |
| `tests/test_retail_calibration.py` | New — platform detection + trust calibration. |
| `tests/test_negotiation_fallbacks.py` | New — playbook + chat fallback shape. |
| `tests/test_negotiate_authorize.py` | Updated — codifies the (intentional) anonymous-shared-handle model instead of the old dead-handle rule. |

### Extension (v0.3.1 → v0.4.0)

| File | Change |
| --- | --- |
| `manifest.json` | Version bump, updated description. |
| `popup/popup.html` | Version string + top-right instruction. |
| `content/overlay.css` | Pill moved to `top: 20px; right: 20px;`, slightly larger. Full chat styles added. |
| `content/overlay.js` | Chat UI beneath the playbook: two-mode input ("Seller replied" / "I have a question"), persistent session ID, suggested-price badges, coach-hint banner. |
| `background.js` | New `FAIVRI_CHAT` and `FAIVRI_CHAT_HISTORY` message handlers. |

### Frontend

| File | Change |
| --- | --- |
| `src/app/pricing/page.tsx` | New **Chrome extension pricing** section. Signal/Vector/Command include extension use; optional $6.99/mo Extension Pro add-on unlocks unlimited checks + chat turns. |

## Deployment order (when you're ready)

1. **Deploy backend with new migration**:
   ```bash
   cd backend
   alembic upgrade head        # locally first to sanity-check
   # push → Railway runs alembic upgrade head on start
   ```
2. **Deploy frontend**: standard Vercel/Railway build.
3. **Reload extension** in Chrome (zip `extension/` → load unpacked, or publish
   to the store).

## Validation

### Local

```bash
cd backend && source .venv/bin/activate && pytest -q
# 104 passed
```

### Against Railway (deferred — do not push yet)

The pre-deploy smoke curl for the LV Neverfull case already returns a
reasonable fair range; the calibration changes will tighten it further for
genuinely used-market items. After deploy, run:

```bash
curl -s -X POST https://faircheck-backend-production.up.railway.app/api/v1/analyze \
  -H 'Content-Type: application/json' \
  -d '{"query":"used Louis Vuitton Neverfull MM on Facebook Marketplace for $70","domain":"retail","quoted_price":7000}' | jq .
```

Expect: data points reference eBay / Marketplace / Mercari comps; fair range
reflects counterfeit-market resale ($40-$200 range) rather than MSRP.

## Known deferrals

- **Live e2e against Railway /chat** — blocked on you deploying; the migration
  must run first. Local unit tests cover the deterministic paths.
- **Generating new extension icons** — using existing `icons/icon-*.png`.
- **Pricing page wiring to Lemon Squeezy for Extension Pro add-on** — copy is
  live, checkout flow for the add-on is a post-launch task (purchase still
  routes to `/sign-up` like other plans).
