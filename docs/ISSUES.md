# FairCheck — Hardening Spec (Issues & Remediation Plan)

Audit date: 2026-04-16. Covers `backend/` and `frontend/` as deployed to Railway.

This document is the implementation backlog. Issues are tagged **P0 (critical / data-integrity / security)**, **P1 (high / silent failures / broken features)**, **P2 (medium / UX / validation)**. Every item has a file path + line numbers and a specific remediation. Items under "Live Data Principle" are direct violations of the rule *"NO fallbacks, NO fake data, EVERYTHING must be grounded in live market data."*

Secondary-pass additions are included below. The summary counts in the executive table were not recomputed after those additions.

---

## 📋 Executive Summary

| Area | P0 | P1 | P2 | Total |
|------|----|----|----|-------|
| Auth / access control | 4 | 1 | 0 | 5 |
| Data integrity / live-data principle | 5 | 6 | 4 | 15 |
| Intelligence pipeline (LLM / search) | 2 | 7 | 5 | 14 |
| API contract (frontend ↔ backend mismatch) | 0 | 3 | 1 | 4 |
| Frontend UX / error handling | 0 | 6 | 10 | 16 |
| Resource / cost / DoS | 1 | 2 | 1 | 4 |
| **Total** | **12** | **25** | **21** | **58** |

**Shipping readiness:** the happy path works end-to-end (query → verdict → negotiate → feedback). Core failure modes:
1. **Authorization is effectively absent.** Anonymous users can enumerate other users' queries, vehicles, and purge the entire database.
2. **"Live data" is aspirational, not enforced.** At least 5 code paths return fabricated prices when the LLM or Tavily fails.
3. **Feedback loop is broken.** Community prices are written but never read during verdict synthesis.
4. **Errors are silent.** Frontend swallows most API failures; user sees blank states instead of retry guidance.

---

## 🔴 P0 — Critical (blocks production; fix before public launch)

### AUTH-P0-01 — Anonymous user can list every vehicle in the database
**File:** [backend/app/routers/vehicles.py:50-61](../backend/app/routers/vehicles.py)
```python
query = select(Vehicle).order_by(Vehicle.created_at.desc())
if user_id:
    query = query.where(Vehicle.user_id == user_id)
# when user_id is None, NO WHERE clause → returns EVERY vehicle
```
**Fix:** reject anonymous requests with `401`; require `user_id` and always filter by it.

### AUTH-P0-02 — No ownership check on `/vehicles/{id}/maintenance`
**File:** [backend/app/routers/vehicles.py:87-93](../backend/app/routers/vehicles.py)
Any user can pull any vehicle's maintenance schedule by guessing UUIDs.
**Fix:** `select(Vehicle).where(id == vehicle_id, user_id == current_user_id)` and 404 if no match.

### AUTH-P0-03 — No ownership check on `GET /history/{query_id}`
**File:** [backend/app/routers/history.py:60-88](../backend/app/routers/history.py)
Full verdict (quoted price, red flags, negotiation script, user's paid price) is readable by anyone with the UUID. Since UUIDs leak into shareable URLs, this is effectively public.
**Fix:** require auth, filter by `user_id`; also consider allowing opt-in public share links with separate opaque IDs.

### AUTH-P0-04 — `DELETE /history/purge` nukes the entire database with no auth
**File:** [backend/app/routers/history.py:162-194](../backend/app/routers/history.py)
```python
@router.delete("/history/purge")
async def purge_stale_history(db: AsyncSession = Depends(get_db)):
    # NO auth. Deletes all community_prices + all queries + flushes Redis.
```
**Fix:** delete the endpoint entirely, or gate behind an admin secret + confirmation token. This should not exist in production.

### AUTH-P0-05 — `POST /negotiate` accepts any query_id with no ownership check
**File:** [backend/app/routers/negotiate.py:20-62](../backend/app/routers/negotiate.py)
An attacker can pull negotiation scripts for any user's verdict (including their target/walk-away price — useful for vendor-side reconnaissance).
**Fix:** require auth, check `query.user_id == current_user_id` (or make explicit public-share).

### LIVE-P0-01 — Synthesizer returns fabricated verdict on JSON parse failure
**File:** [backend/app/intelligence/synthesizer.py:45-59](../backend/app/intelligence/synthesizer.py)
```python
# On LLM parse error:
return {
    "fair_price_low": 0, "fair_price_high": 0,
    "confidence_score": 0, "verdict": "high",
    "overcharge_multiplier": 1.0,
}
```
Fake `$0–$0` fair range renders as legitimate verdict on the frontend.
**Fix:** raise `ValueError("Could not synthesize verdict from live data")` → bubble as HTTP 503. Never return zero-price verdicts.

### LIVE-P0-02 — Hardcoded maintenance costs in purchase analyzer
**File:** [backend/app/intelligence/purchase_analyzer.py:14-20, 89](../backend/app/intelligence/purchase_analyzer.py)
```python
ESTIMATED_COSTS = { "oil_change": 8500, "brake_pads": 25000, "timing_belt": 80000, ... }
```
Cost projection on the purchase result page surfaces these as if they were market data.
**Fix:** remove the dict. Drive all maintenance cost estimates through the same Tavily → LLM pipeline used for `/analyze`. If live data can't be fetched, return `null` for the projection and let the frontend show "Live estimate unavailable — retry."

### LIVE-P0-03 — Zero-price baseline cached & reused
**Files:** [backend/app/intelligence/cache.py:73-78](../backend/app/intelligence/cache.py), [backend/app/intelligence/orchestrator.py:114-120](../backend/app/intelligence/orchestrator.py)
If the synthesizer ever returns `fair_price_low=0, fair_price_high=0` (see LIVE-P0-01), the orchestrator caches it. Subsequent users hit the cache and receive `multiplier = 1.0` ("fair") against a zero baseline.
**Fix:** validate `fair_price_low > 0 and fair_price_high >= fair_price_low` before caching. On cache hit, if baseline is degenerate, treat as miss and re-synthesize.

### LIVE-P0-04 — Cache multiplier silently defaults to 1.0 when baseline is zero
**File:** [backend/app/intelligence/cache.py:73-78](../backend/app/intelligence/cache.py)
```python
if fair_mid > 0:
    multiplier = round(quoted_price / fair_mid, 2)
else:
    multiplier = 1.0  # silently lies
```
**Fix:** raise on `fair_mid == 0`; never return verdicts where the math is undefined.

### LIVE-P0-05 — Community prices are write-only; the feedback loop is broken
**Files:** [backend/app/routers/feedback.py:35-50](../backend/app/routers/feedback.py), [backend/app/intelligence/orchestrator.py](../backend/app/intelligence/orchestrator.py)
Every successful feedback write inserts into `community_prices`, but no code reads from it during verdict synthesis. The crowdsourcing pitch (README, marketing) is unfulfilled.
**Fix:** in `orchestrator._synthesize_fresh`, query `community_prices` by `(domain, service, city, country)` within a 90-day window, and pass those anonymized data points into the synthesizer prompt alongside web results. Weight community data ≥ Tavily for the same geography.

### COST-P0-01 — No rate limiting anywhere
**Files:** all routers
Tavily + Anthropic + OpenAI + Clerk API calls are all unthrottled. A single malicious client can drain API quota in minutes.
**Fix:** add `slowapi` (Redis-backed) with per-IP limits: `/analyze*` = 10/min, `/negotiate*` = 20/min, `/feedback` = 30/min. Surface 429 with `Retry-After` header.

### DATA-P0-01 — `Base.metadata.create_all` on startup; no migrations
**File:** [backend/app/main.py:12-17](../backend/app/main.py)
Schema changes in production will silently fail or skip. Alembic is already in `requirements.txt` but never used.
**Fix:** generate initial Alembic revision, wire `alembic upgrade head` into deploy. Remove `create_all` from lifespan.

---

## 🟠 P1 — High (silent failures, broken features, API contract violations)

### LIVE-P1-01 — Synthesizer prompt tolerates LLM guessing
**File:** [backend/app/services/llm.py:205-256](../backend/app/services/llm.py)
Prompt says "grounded in ACTUAL prices" but never requires `fair_price_low` to be an exact quote from a web result, and never instructs the LLM to refuse if evidence is thin.
**Fix:** require structured output where each price point is annotated with source URL; reject synthesis if `data_points < 3`.

### LIVE-P1-02 — No pre-extraction of prices from Tavily results
**File:** [backend/app/intelligence/web_search.py](../backend/app/intelligence/web_search.py), [backend/app/services/llm.py](../backend/app/services/llm.py)
The LLM is handed raw HTML-stripped content and trusted to extract prices. A result saying "closed on weekends" still counts as a data point in the confidence score.
**Fix:** regex-extract price candidates (`\$?\d{1,3}(,\d{3})*(\.\d{2})?`) before synthesis; gate LLM synthesis on extracting ≥3 prices from distinct domains.

### LIVE-P1-03 — Confidence score is count-based, not quality-based
**Files:** [backend/app/intelligence/synthesizer.py:66-74](../backend/app/intelligence/synthesizer.py), [backend/app/intelligence/cache.py:70](../backend/app/intelligence/cache.py)
```python
confidence_score = min(85, max(40, data_points * 12))  # arbitrary
```
Six low-quality sources yield the same 85% confidence as six excellent ones.
**Fix:** compute confidence from (a) number of distinct domains, (b) price variance (tight cluster = high confidence), (c) domain trust weight (RepairPal > random blog).

### LIVE-P1-04 — Tavily config is minimal (`search_depth: basic`, no time filter)
**File:** [backend/app/services/tavily.py:32-39](../backend/app/services/tavily.py)
Returns stale national averages as easily as current local quotes.
**Fix:** use `search_depth: advanced`, `include_answer: true`, `time_range: year`, and per-domain `include_domains` list (RepairPal, GoMechanic, Thumbtack, etc.).

### LIVE-P1-05 — Negotiation prompt doesn't receive web results or source URLs
**File:** [backend/app/services/llm.py:317-379](../backend/app/services/llm.py)
Only `fair_price_low/high` and red flags are passed. LLM is told to produce "evidence_summary with specific sources" — but has no sources to cite. Result: scripts feel authoritative but can't be defended when the vendor asks "says who?"
**Fix:** pass top 5 web results (title + URL + key quote) into the negotiation prompt; require scripts to reference them by number (`[1]`, `[2]`).

### LIVE-P1-06 — Target price + walk-away are LLM-guessed, not computed
**File:** [backend/app/services/llm.py:354-356](../backend/app/services/llm.py)
Prompt says "aim for 10–15% above fair_low" but the backend never validates. A drifting LLM can return `target_price = fair_high`.
**Fix:** compute in Python after LLM returns scripts:
```python
target_price = int(verdict.fair_price_low * 1.12)
walk_away_above = int(verdict.fair_price_high * 1.10)
```
Override whatever the LLM returned for these two fields.

### LIVE-P1-07 — Negotiation uses stale verdict data with no refresh path
**File:** [backend/app/routers/negotiate.py:20-61](../backend/app/routers/negotiate.py)
Verdict may be hours old; negotiation never re-runs Tavily.
**Fix:** if `query.created_at` older than 2h, re-run synthesis before generating scripts; return a `freshness` field so frontend can show "Prices last checked X minutes ago."

### LIVE-P1-08 — US-only scope is implicit, not enforced as a hard product boundary
**Files:** [backend/app/services/llm.py:174-190](../backend/app/services/llm.py), [backend/app/intelligence/web_search.py:1-40](../backend/app/intelligence/web_search.py), [backend/app/intelligence/purchase_analyzer.py:36, 96-114](../backend/app/intelligence/purchase_analyzer.py), [backend/app/intelligence/orchestrator.py:1-9, 51-52, 97](../backend/app/intelligence/orchestrator.py)
If FairCheck is intentionally US-only, the system should say so explicitly and reject unsupported geographies cleanly. Right now the code is US-biased, but the product contract is ambiguous, which risks non-US queries being processed anyway and returning misleading "live" verdicts.
**Fix:** make US-only a first-class invariant: reject non-US country input with 400, default all market metadata to US/USD centrally, strip unsupported country options from the frontend, and update docs/copy so the app never implies broader coverage than it actually has.

### LIVE-P1-09 — Raw Tavily snippets are injected into LLM prompts as trusted text
**Files:** [backend/app/services/llm.py:219-256](../backend/app/services/llm.py), [backend/app/services/llm.py:317-379](../backend/app/services/llm.py), [backend/app/intelligence/web_search.py:52-58](../backend/app/intelligence/web_search.py)
Retrieved page snippets are pasted straight into the synthesis and negotiation prompts. A malicious SEO page or scraped forum post can contain prompt-injection text ("ignore previous instructions", "quote $999") that the model may obey or over-weight.
**Fix:** treat search results as untrusted input. Pass only structured evidence records (`url`, `title`, `domain`, `quoted_text`, `price_candidates`) into the model, wrap them in explicit delimiters, and add a top-level instruction to ignore any instructions embedded in retrieved content. Prefer deterministic price extraction before LLM reasoning.

### LIVE-P1-10 — Community prices are not canonicalized enough to become a reliable live-data layer
**File:** [backend/app/routers/feedback.py:35-40](../backend/app/routers/feedback.py)
`service_type=query.input_text[:200]` stores raw user phrasing instead of a canonical service key. The same repair can land as "brake job", "front pads", "replace rotors", or an entire paragraph. Once `community_prices` is wired into synthesis, this will create noisy clusters and bad baselines.
**Fix:** store normalized market attributes alongside every community row: `canonical_service`, `domain`, `country`, `city/s2`, `currency`, make/model/year when relevant, and a stable `service_fingerprint`. Only use rows with a high-confidence canonical mapping in live verdict synthesis.

### LIVE-P1-11 — Negotiation prompt encourages bluffing facts FairCheck has not verified
**Files:** [backend/app/services/llm.py:338-351](../backend/app/services/llm.py), [backend/app/services/llm.py:360-364](../backend/app/services/llm.py), [backend/app/services/llm.py:415-430](../backend/app/services/llm.py)
The prompt explicitly tells the model to say things like "I have quotes from two other shops" and "other customers in this area are paying X-Y" even when FairCheck only has a synthesized range, not user-supplied competing quotes. That makes scripts sound strong, but they are vulnerable the moment a vendor asks for proof.
**Fix:** split negotiation into `verified_facts` and `optional tactics`. Scripts may only cite actual retrieved sources, actual community aggregates, or user-supplied alternative quotes. When FairCheck lacks a fact, the language must stay conditional ("I'm seeing local market estimates around..."), never fabricated.

### API-P1-01 — Frontend calls `/api/v1/savings/profile` but backend only has `/savings/summary`
**Files:** [frontend/src/lib/api.ts:211](../frontend/src/lib/api.ts), [backend/app/routers/history.py:91](../backend/app/routers/history.py)
Vault page crashes on load for users who hit the profile path. The shapes also differ — `SavingsProfileData` has `lifetime_saved`, `monthly_streak`, `level`, etc.; backend returns `total_saved` only.
**Fix:** implement `/api/v1/savings/profile` endpoint with full shape; compute streak, level, and thresholds server-side.

### API-P1-02 — Feedback endpoint missing `streak` field
**Files:** [backend/app/routers/feedback.py:57-62](../backend/app/routers/feedback.py), [frontend/src/lib/api.ts:201](../frontend/src/lib/api.ts)
Frontend `SavingsCelebration` expects `streak: { monthly_dodged, lifetime_saved, level, milestone_unlocked }`. Backend returns nothing of the sort. Celebration renders broken.
**Fix:** compute streak fields inside feedback handler; return them in the response.

### API-P1-03 — Counter-offer response shape not validated
**Files:** [backend/app/routers/negotiate.py:70-100](../backend/app/routers/negotiate.py), [frontend/src/app/negotiate/[id]/page.tsx:273-276](../frontend/src/app/negotiate/[id]/page.tsx)
If LLM omits `suggested_counter`, frontend calls `formatPrice(undefined)` → `NaN`.
**Fix:** add Pydantic response model with required fields; on LLM incompleteness, return 502 rather than a partial response.

### AUTH-P1-01 — Clerk auth verifies by scanning all active sessions
**File:** [backend/app/services/auth.py:18-53](../backend/app/services/auth.py)
```python
# Fetches ALL active sessions then linear-searches for the token
sessions = res.json().get("data", [])
for session in sessions:
    if session.get("last_active_token", {}).get("jwt") == token:
```
Performance cliff at scale; also no JWT signature verification.
**Fix:** use Clerk's JWT verification (`PyJWT` is already in requirements) against Clerk's JWKS endpoint. Cache JWKS keys with 1h TTL.

### COST-P1-01 — No file-size validation on voice endpoint
**File:** [backend/app/routers/analyze.py:129-166](../backend/app/routers/analyze.py)
Only image endpoint checks size. Large audio uploads blow up Whisper cost and memory.
**Fix:** add `MAX_AUDIO_SIZE = 20 MB`, match the image check.

### COST-P1-02 — Anonymous community price submission with no spam protection
**File:** [backend/app/routers/feedback.py:35-50](../backend/app/routers/feedback.py)
A poisoning attack can flood `community_prices` with garbage, tainting the fix for LIVE-P0-05 (community → verdict).
**Fix:** require auth for feedback, add per-user rate limit, add validation that `final_price` is within `[fair_price_low * 0.1, fair_price_high * 10]`.

### DATA-P1-01 — Feedback endpoint is not idempotent; duplicate submits corrupt community data
**File:** [backend/app/routers/feedback.py:17-50](../backend/app/routers/feedback.py)
Repeated `POST /feedback` calls for the same `query_id` overwrite `feedback_final_price` and insert a brand-new `community_prices` row every time. A double-click, retry storm, or malicious script can therefore inflate community counts and distort vendor statistics.
**Fix:** enforce one canonical feedback record per query. Add a unique constraint on `queries.feedback_final_price` ownership semantics or create a dedicated `query_feedback` table keyed by `query_id`, and upsert instead of blindly inserting another community row.

### FE-P1-01 — Silent `.catch(() => {})` in all data-fetch pages
**Files:** [frontend/src/app/result/[id]/page.tsx:65](../frontend/src/app/result/[id]/page.tsx), [frontend/src/app/negotiate/[id]/page.tsx:80](../frontend/src/app/negotiate/[id]/page.tsx), [frontend/src/components/ui/Recommendations.tsx:86](../frontend/src/components/ui/Recommendations.tsx), [frontend/src/app/vault/page.tsx:68-80](../frontend/src/app/vault/page.tsx), [frontend/src/app/garage/page.tsx:93-115](../frontend/src/app/garage/page.tsx)
API failures produce blank pages with no retry. "Query not found" is indistinguishable from a 500.
**Fix:** replace each `.catch(() => {})` with a typed error state; render an error card with retry button + toast.

### FE-P1-02 — Purchase result passes full analysis via URL query string
**Files:** [frontend/src/components/home/AnalyzerStudio.tsx:186](../frontend/src/components/home/AnalyzerStudio.tsx), [frontend/src/app/result/purchase/[slug]/page.tsx:68-85](../frontend/src/app/result/purchase/[slug]/page.tsx)
`router.push(\`/result/purchase/${slug}?data=${encodeURIComponent(JSON.stringify(result))}\`)` — truncates at URL length limit; leaks in browser history; unshareable.
**Fix:** persist result server-side (`POST /analyze/purchase` already stores to DB — return the id), navigate to `/result/purchase/{id}`, fetch on mount.

### FE-P1-03 — VoiceRecorder silently renders nothing on unsupported browsers
**File:** [frontend/src/components/ui/VoiceRecorder.tsx:13-15, 174](../frontend/src/components/ui/VoiceRecorder.tsx)
Firefox / older Safari users click "Speak" tab and see nothing.
**Fix:** detect unsupported → render fallback: "Voice capture isn't supported in this browser. Use Scan or Type instead."

### FE-P1-04 — Geolocation failures are silent
**File:** [frontend/src/components/home/AnalyzerStudio.tsx:84-91](../frontend/src/components/home/AnalyzerStudio.tsx)
Denied / timed-out location → query proceeds with no location → verdict defaults to national US averages.
**Fix:** show a non-blocking banner ("Location unavailable; prices may be national averages. Add your city below.") and require manual city input if missing for auto/medical domains.

### FE-P1-05 — Load-more in Vault treats any error as "end of data"
**File:** [frontend/src/app/vault/page.tsx:68-80](../frontend/src/app/vault/page.tsx)
```typescript
} catch { setHasMore(false) }  // data still exists but button disables
```
**Fix:** distinguish transient vs terminal errors; show retry button on transient.

### FE-P1-06 — Error responses from backend leak stack-trace details
**Files:** [backend/app/routers/analyze.py:80, 83, 123, 126, 163, 166](../backend/app/routers/analyze.py) and ~5 more
```python
raise HTTPException(500, detail=f"Analysis failed: {str(e)}")
```
Implementation details (SQL, file paths, sometimes API keys in error strings) get surfaced to the client.
**Fix:** log full trace server-side; return a generic user-facing message + a request_id the user can quote to support.

### INT-P1-01 — `pricing_knowledge` table is dead code that could re-activate
**File:** [backend/app/intelligence/knowledge.py](../backend/app/intelligence/knowledge.py)
`search_knowledge()` exists, but `orchestrator.py:92` passes `knowledge_data=[]`. Dead code is a re-entry point for stale data.
**Fix:** delete `knowledge.py` and the `pricing_knowledge` table (after verifying no other caller).

### INT-P1-02 — US-only assumptions are scattered instead of centralized
**Files:** [backend/app/intelligence/orchestrator.py:51-52, 97](../backend/app/intelligence/orchestrator.py), [backend/app/services/llm.py:174-190](../backend/app/services/llm.py), [backend/app/intelligence/purchase_analyzer.py:36](../backend/app/intelligence/purchase_analyzer.py)
`country = "US"` and `currency = "USD"` are repeated in multiple places. That is fine for a US-only app, but repeated assumptions drift over time and make it easy for one flow to behave differently from another.
**Fix:** define a single US market constant/module and import it everywhere. All routes should derive `country`, `currency`, display symbol, and search geography from that shared source so "US-only" stays consistent across analyze, purchase, history, and negotiation.

### INT-P1-03 — NHTSA failures silently return empty list
**File:** [backend/app/intelligence/nhtsa.py:30-31, 55-56](../backend/app/intelligence/nhtsa.py)
```python
except Exception:
    return []
```
User sees "No known recalls" when the API actually failed.
**Fix:** return a structured result `{ checked: bool, recalls: [] }`; surface on frontend if `checked=false`.

### INT-P1-04 — Domain files are advisory, not enforcing
**Files:** [backend/app/domains/*.py](../backend/app/domains)
Each file provides prompt hints ("RepairPal is trusted"); LLM can ignore them.
**Fix:** promote trusted sources into Tavily `include_domains`; reduce LLM discretion.

### INT-P1-05 — No validation that LLM output ranges are sane
**File:** [backend/app/intelligence/synthesizer.py:61-80](../backend/app/intelligence/synthesizer.py)
No checks for `fair_low <= fair_high`, `confidence in [0,100]`, `overcharge_multiplier > 0`.
**Fix:** Pydantic validation on the LLM output; retry once on invalid output, else raise.

### INT-P1-06 — Maintenance schedule hardcoded (same for all vehicles)
**File:** [backend/app/routers/vehicles.py:22-33](../backend/app/routers/vehicles.py)
Honda Civic = BMW M3 = Tesla Model 3 in this model.
**Fix:** look up per make/model/year intervals via the same live-data pipeline used for prices.

### INT-P1-07 — Km/year hardcoded to 15,000 in purchase projection
**File:** [backend/app/intelligence/purchase_analyzer.py:83](../backend/app/intelligence/purchase_analyzer.py)
**Fix:** accept user-provided annual distance; fall back to region median (pulled from live data, not hardcoded).

---

## 🟡 P2 — Medium (quality of life, validation, best practices)

### DATA-P2-01 — Integer overflow on price fields (32-bit)
**File:** [backend/app/models/db.py:47-49](../backend/app/models/db.py)
`Column(Integer)` caps at ~$21M. Breaks for commercial/legal retainers.
**Fix:** `BigInteger` everywhere prices are stored.

### DATA-P2-02 — No FK `ON DELETE` behavior
**File:** [backend/app/models/db.py:41, 101, 122](../backend/app/models/db.py)
Deleting a profile orphans queries/vehicles.
**Fix:** `ondelete="SET NULL"` on nullable user_id, `ondelete="CASCADE"` on required.

### DATA-P2-03 — Dead multi-country schema/config branches remain in a US-only product
**Files:** [backend/app/models/db.py:14-17](../backend/app/models/db.py), [backend/app/config.py](../backend/app/config.py), README/docs references
The codebase still carries country/currency scaffolding beyond the active US scope. Dead branches increase cognitive load and invite partial future changes that silently re-open unsupported markets.
**Fix:** collapse enums, docs, and config to the supported surface area. If you want to keep extensibility, isolate it behind clearly unused internal abstractions rather than exposing half-supported country/currency paths in the main product contract.

### DATA-P2-04 — Pydantic schemas don't bound coordinates or prices
**File:** [backend/app/models/schemas.py](../backend/app/models/schemas.py)
`lat: Optional[float]` with no `ge=-90, le=90`; `quoted_price: Optional[int]` with no `ge=1`.
**Fix:** add Field bounds.

### DATA-P2-05 — No MIME type validation on uploads
**File:** [backend/app/routers/analyze.py:86-126, 129-166](../backend/app/routers/analyze.py)
Accepts any file.
**Fix:** whitelist `image/jpeg, image/png, image/webp, image/heic` and `audio/webm, audio/mp4, audio/mpeg`.

### LIVE-P2-01 — Cache TTL hardcoded to 4h, not per-domain
**File:** [backend/app/intelligence/cache.py:12](../backend/app/intelligence/cache.py)
Home/legal prices change slowly (weeks); groceries change daily.
**Fix:** per-domain TTL map.

### LIVE-P2-02 — No audit trail of which sources a verdict cited
**File:** [backend/app/intelligence/orchestrator.py:123](../backend/app/intelligence/orchestrator.py)
Stores `sources_used = {web_search: count}` only. Can't review verdicts.
**Fix:** persist full `[{url, title, price_extracted}]` in `sources_used` JSONB.

### LIVE-P2-03 — Redis cache failures fully silent
**File:** [backend/app/services/redis.py:30-42](../backend/app/services/redis.py)
When Redis is down, latency/cost spike — no alerting.
**Fix:** log at WARN with cluster ID; expose a `/health/cache` endpoint.

### LIVE-P2-04 — `UPSTASH_REDIS_URL` env var name misleading
Redis is now Railway-hosted, not Upstash; name persists.
**Fix:** rename to `REDIS_URL`; keep `UPSTASH_REDIS_URL` as an alias for one release.

### INT-P2-01 — Two Tavily queries not diverse enough
**File:** [backend/app/intelligence/web_search.py:38-41](../backend/app/intelligence/web_search.py)
Specific query can 0-match; broad query returns national averages.
**Fix:** add a third query scoped to state/region, and a fourth scoped to brand/model.

### INT-P2-02 — Recommender's LLM arm silently swallows errors
**File:** [backend/app/intelligence/recommender.py:246-282](../backend/app/intelligence/recommender.py)
Parse failure → `personalized = []` with no log.
**Fix:** log at WARN, increment a metric, include in request_id-tagged response meta.

### INT-P2-03 — Domain tactics lists are static
**File:** [backend/app/services/llm.py:266-291](../backend/app/services/llm.py)
Same 4 tactics for every auto case.
**Fix:** tailor tactics to the specific verdict (e.g., OEM tactics only when the LLM detects OEM-vs-aftermarket as a red flag).

### INT-P2-04 — Confidence score arbitrary cap at 85
**File:** [backend/app/intelligence/cache.py:70](../backend/app/intelligence/cache.py)
Why not 95? 100? No rationale.
**Fix:** derive from evidence quality; allow up to 95% when data is strong.

### INT-P2-05 — No retry on transient LLM / Tavily failures
**Files:** [backend/app/services/llm.py](../backend/app/services/llm.py), [backend/app/services/tavily.py](../backend/app/services/tavily.py)
One network blip → 503 to user.
**Fix:** `tenacity`-style retry with jittered backoff, max 2 retries.

### FE-P2-01 — Empty recommendations render nothing instead of a message
**File:** [frontend/src/components/ui/Recommendations.tsx:104-106](../frontend/src/components/ui/Recommendations.tsx)
**Fix:** show "No personalized recommendations for this verdict."

### FE-P2-02 — Skeletons have no ARIA
**File:** [frontend/src/components/ui/Skeleton.tsx](../frontend/src/components/ui/Skeleton.tsx)
**Fix:** add `role="status" aria-busy="true" aria-label="Loading"`.

### FE-P2-03 — Toast duration not configurable
**File:** [frontend/src/components/ui/Toast.tsx:29-35](../frontend/src/components/ui/Toast.tsx)
**Fix:** accept `duration` param; default error to 6s, success to 3s.

### FE-P2-04 — `getCommunityPrices` / `getVendorScores` typed as `any[]`
**File:** [frontend/src/lib/api.ts:219-226](../frontend/src/lib/api.ts)
**Fix:** add `CommunityPriceData` and `VendorScoreData` interfaces.

### FE-P2-05 — Image `ObjectURL` leaks on unmount when preview not cleared
**File:** [frontend/src/components/home/AnalyzerStudio.tsx:93-96](../frontend/src/components/home/AnalyzerStudio.tsx)
**Fix:** cleanup effect on unmount regardless of preview state.

### FE-P2-06 — FreshnessBadge breaks on future timestamps (clock skew)
**File:** [frontend/src/components/ui/FreshnessBadge.tsx:24-26](../frontend/src/components/ui/FreshnessBadge.tsx)
Shows `-2h ago` if the server clock is ahead.
**Fix:** `Math.max(0, hours)` + show "just now" under 1h.

### FE-P2-07 — No empty-state for purchase result page when data missing
**File:** [frontend/src/app/result/purchase/[slug]/page.tsx](../frontend/src/app/result/purchase/[slug]/page.tsx)
Once FE-P1-02 is fixed, this becomes straightforward.

### FE-P2-08 — Canonical nav link drift
**File:** [frontend/src/components/layout/Nav.tsx:9-18](../frontend/src/components/layout/Nav.tsx)
Signed-in links include `/analyze` which isn't a page; signed-out links reference `/home` which also isn't a page.
**Fix:** audit against `/src/app/**/page.tsx` and fix mismatches.

### FE-P2-09 — Practice mode on negotiate page doesn't handle empty scripts
**File:** [frontend/src/app/negotiate/[id]/page.tsx:67, 188](../frontend/src/app/negotiate/[id]/page.tsx)
**Fix:** show empty-state message if `data.scripts.length === 0`.

### FE-P2-10 — Savings submission modal doesn't disable backdrop
**File:** [frontend/src/app/result/[id]/page.tsx:103-125](../frontend/src/app/result/[id]/page.tsx)
User can double-submit.
**Fix:** disable backdrop click + spinner on button.

### COST-P2-01 — CORS `allow_methods=["*"]` + `allow_credentials=True`
**File:** [backend/app/main.py:27-33](../backend/app/main.py)
Works because origins list is explicit, but any wildcard origin added later becomes an auth-bypass vector.
**Fix:** reduce to `["GET", "POST", "DELETE"]`, explicit headers.

### COST-P2-02 — `/health` is only a heartbeat, not a readiness check
**File:** [backend/app/main.py:44-46](../backend/app/main.py)
`/health` returns `{"status":"ok"}` even if Postgres is unreachable, Redis is down, or Tavily credentials are broken. In production this causes bad deploys to look healthy until user traffic starts failing.
**Fix:** split health into `/health/live` (process is up) and `/health/ready` (DB reachable, cache optional-but-reported, required env/config present). Use short dependency timeouts and return component-level status.

---

## 🗺️ Suggested Implementation Order

**Sprint 1 — lock it down** (nothing else matters if auth is broken)
- AUTH-P0-01, AUTH-P0-02, AUTH-P0-03, AUTH-P0-05, AUTH-P0-04 (delete purge)
- COST-P0-01 (rate limiting)
- FE-P1-06 (stop leaking stack traces)

**Sprint 2 — make "live data" honest**
- LIVE-P0-01, LIVE-P0-03, LIVE-P0-04 (stop fabricating verdicts)
- LIVE-P0-02 (remove hardcoded maintenance costs)
- LIVE-P0-05 (wire community_prices into synthesis)
- LIVE-P1-01, LIVE-P1-02 (require real price extraction)
- LIVE-P1-08 (make US-only scope an explicit contract)
- LIVE-P1-09 (treat retrieved web text as untrusted evidence)
- LIVE-P1-10 (canonicalize community prices before using them as market data)
- INT-P1-02 (centralize US-only assumptions)
- INT-P1-05 (validate LLM output)

**Sprint 3 — trustworthy negotiation**
- LIVE-P1-05 (pass sources to negotiation prompt)
- LIVE-P1-06 (compute target/walk-away in Python)
- LIVE-P1-07 (refresh stale verdicts)
- LIVE-P1-11 (forbid bluffing / fabricated BATNA in scripts)
- API-P1-03 (validate counter-offer response)

**Sprint 4 — product contract**
- API-P1-01 (`/savings/profile`)
- API-P1-02 (streak in feedback)
- DATA-P1-01 (make feedback idempotent)
- DATA-P0-01 (Alembic migrations)
- AUTH-P1-01 (proper JWT verification)

**Sprint 5 — UX repair**
- FE-P1-01 (replace all silent catches)
- FE-P1-02 (server-side purchase result storage)
- FE-P1-03 (browser support fallback)
- FE-P1-04 (geolocation banner)
- FE-P1-05 (vault load-more)

**Sprint 6 — polish**
- All P2 items, best-effort.
- COST-P2-02 early if deploying behind a load balancer / managed platform.

---

## 🚫 What This Spec Does NOT Cover (yet)

- **Observability** — no metrics, no traces, no structured logs. A future spec should add OpenTelemetry + Sentry.
- **Testing** — `backend/tests/` is empty. Need unit tests for the intelligence pipeline, integration tests for the full `analyze → negotiate → feedback` chain.
- **Load / chaos testing** — nothing has been benchmarked. Before a public launch, the synthesizer + Tavily path needs p99 latency + error-budget numbers.
- **Data poisoning defense beyond auth** — even with auth, a determined actor can game `community_prices`. Reputation scoring + outlier filtering is future work.
- **Moderation** — user-submitted text (query, vendor_name) is stored raw. Needs PII scrubbing + moderation before it appears on the community feed.
- **Accessibility audit** — dark theme contrast, keyboard traps in the modal flows, screen reader labels on interactive icons.
- **i18n** — whole app is English-only; if US launch expands beyond English-speaking users later, localization planning will still be needed.
- **Privacy policy / data retention** — no deletion path for a user who signs up, submits queries, and wants to leave.
