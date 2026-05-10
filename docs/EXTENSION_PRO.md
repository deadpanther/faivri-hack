# Faivri Extension Pro — Plan

Three add-on features that compound the existing eBay / Facebook Marketplace
price-check overlay without scope creep.

## 1. What we're adding

### A. Seller Risk Score (trust layer)
Badge on every listing's seller section:
- Account age (extracted from seller profile)
- Listing repost signal — same item, same seller, relisted at higher price
- Stock-photo reuse (perceptual hash of listing images vs. Tavily reverse-lookup)
- Avg markup vs. our fair range across this seller's recent listings

Output: a 0–100 score with a short "Why" sentence and color band
(green ≤ 35, amber ≤ 65, red above).

### B. Stale-Listing Timing Alerts
User can "watch" a listing. Background job checks weekly. Push a Chrome
notification when either:
- Price dropped by ≥ 5%, or
- Listing crossed the domain median age (eBay: 14 days, FB: 10 days)

Notification body includes the negotiation script tuned to how stale the
listing has become (deeper discount ask as the listing ages).

### C. In-Chat Reply Coach (conversational, not static)
Current coach: user pastes seller reply → gets one rebuttal.
New coach: persistent side panel, multi-turn conversation.

User pastes or auto-captures the seller's message. Coach replies with a
suggested counter-text + tone toggle (polite / firm / walk-away). User can
ask follow-ups ("what if they push back on the $40?") and the coach remembers
the whole thread + the listing's fair range.

Reuses the existing `NegotiationConversation` table — keyed on
`(query_id, session_id)`, so each listing × seller conversation is isolated
and resumable across sessions.

## 2. Data strategy — Tavily + Firecrawl hybrid

| Signal | Primary | Fallback |
|---|---|---|
| Fair price comps | Tavily search | — |
| Seller profile page | Firecrawl `/scrape` | Tavily search |
| Reverse image lookup | Tavily image search | — |
| Listing status (active / sold / delisted) | Firecrawl `/scrape` | Tavily |
| Structured extraction (price, stock, seller name) | Firecrawl `/extract` | regex fallback |

Firecrawl's strength is structured extraction from a specific URL — Tavily is
search-first. Using both together:
- Tavily → "find comps for this item across the market"
- Firecrawl → "pull exact structured fields from THIS seller profile page"

This lets the Seller Risk Score be real instead of heuristic guesses.

## 3. Pricing

### Landing + pricing page split

**Extension Basic** — free with any paid plan (Signal / Vector / Command)
- Price check overlay on eBay + FB Marketplace
- Single-shot negotiation script
- Evidence sources panel

**Extension Pro** — $12.99/mo add-on (existing SKU, feature set expands)
- Everything in Basic
- Seller Risk Score on every listing
- Stale-listing watch + Chrome notifications
- Conversational reply coach with tone toggle
- Priority Firecrawl quota

No new tier, no new billing integration — we enrich the existing add-on
so nothing downstream (Lemon Squeezy, webhook, quota) changes.

## 4. Cost impact

Monthly fixed infra (unchanged):
- Railway Pro: $20
- Tavily Bootstrap: $30
- Firecrawl Hobby: $16 (new — required for Pro add-on)
- **Total: ~$67/mo**

Per-Pro-subscriber variable cost (assume 40 risk checks + 20 chat turns/mo):
- Firecrawl: 40 scrapes × $0.005 = $0.20
- Tavily extra: $0.05
- Claude: 20 turns × ~1.5k tokens = $0.15
- **Total: ~$0.40/Pro user/mo**

At $12.99/mo revenue per Pro user, gross margin is **~96%** and the $16
Firecrawl Hobby tier break-even is **~2 Pro subscribers**.

## 5. Implementation plan

### Phase 1 — Landing + pricing (frontend-only, ship first)
- [ ] Add 3-feature grid below current ExtensionShowcase
- [ ] Update pricing page add-on card with bullet list
- [ ] Link to `/docs/extension-pro` (this file)

### Phase 2 — Backend (Firecrawl + extension router)
- [ ] `backend/app/services/firecrawl.py` — `scrape(url)` + `extract(url, schema)`
- [ ] `backend/app/routers/extension.py`:
  - `POST /api/v1/extension/seller-risk` → `{ url, seller_handle }` → score + reasons
  - `POST /api/v1/extension/reply-coach` → `{ query_id, session_id, user_message, tone }` → next reply (reuses `continue_negotiation_chat`)
  - `POST /api/v1/extension/listing-watch` → `{ listing_url, fair_high_cents }` → watch id
  - `GET  /api/v1/extension/listing-watch` → user's active watches
- [ ] Register router in `main.py`
- [ ] Add `firecrawl_api_key` to `config.py` + `.env.example`

### Phase 3 — Extension (Chrome)
- [ ] `content/seller-risk.js` — extracts seller handle, calls risk endpoint, renders badge
- [ ] `content/reply-coach.js` — side panel with chat thread, calls reply-coach
- [ ] `popup/popup.html` — "Watched listings" tab

### Phase 4 — Docs
- [ ] Update `docs/BACKEND.md` with new endpoints
- [ ] Update `docs/ARCHITECTURE.md` with Firecrawl as second data source

## 6. Risk / out-of-scope

- **Stale-listing alerts require a background worker.** Out of scope for this
  ship — we'll expose the watch endpoint + client UI, but the cron worker
  that fires notifications ships separately (Railway cron or Upstash QStash).
- **FB Marketplace seller profiles are gated by login.** Firecrawl can't
  scrape them without cookies. For now the Seller Risk Score is eBay-only
  and FB shows "N/A — requires login" in the badge.
- **Image perceptual hashing** we defer: Tavily image search on the listing's
  primary photo is enough to detect stock-photo reuse for v1.
