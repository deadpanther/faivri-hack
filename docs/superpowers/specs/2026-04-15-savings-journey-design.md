# Savings Journey — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Goal:** Make the user feel "this app just saved me real money" through a projected → confirmed savings loop with streaks and milestones.

---

## Overview

Three features that form one story arc:

1. **Projected Savings Hero** — Verdict page shows what the user could save before they negotiate.
2. **Savings Celebration** — After reporting final price, a full-screen celebration confirms real savings.
3. **Streak & Milestone System** — Running tracker of overcharges dodged, lifetime savings, and savvy level.

The demo pitch: "Submit a quote → see projected savings → negotiate → report back → celebrate confirmed savings → watch your streak grow."

---

## Feature 1: Projected Savings Hero

### Where
Top of `/result/[id]` page, above the existing overcharge multiplier and price gauge.

### Behavior by Verdict

| Verdict | Hero Display | Tone |
|---------|-------------|------|
| `overcharge` | **"You're overpaying $X"** (animated counter roll-up) | Red urgency |
| `high` | **"You could save ~$X"** | Amber caution |
| `fair` | **"Good news — your price is fair"** (green checkmark) | Green confidence |

### Calculation
```
projected_savings = quoted_price - fair_price_high
```
Uses top of fair range (not midpoint) so the number is conservative and credible. Only shown when `quoted_price` is present and greater than `fair_price_high`.

### Supporting Elements
- Context line below the number: *"Based on {data_points_count} live market data points for {service} in {location_city}"*
- CTA button: **"Get Negotiation Script →"** linking to `/negotiate/[id]`
- For `fair` verdicts: CTA changes to **"View Full Analysis ↓"** (anchor scroll)

### Backend Changes
None. All data exists in `VerdictResponse`: `quoted_price`, `fair_price_high`, `verdict`, `data_points_count`, `location_city`.

---

## Feature 2: Savings Celebration Screen

### Where
Full-screen overlay that replaces the feedback modal after the user submits their final price via `POST /api/v1/feedback`.

### Flow
1. User clicks "Report Final Price" on verdict page (existing button)
2. Feedback form modal appears (existing: final_price, outcome, vendor_name)
3. User submits → backend returns enriched response
4. Modal transitions to **celebration overlay** (not a new page — same URL)

### Display by Outcome

**Saved money (`final_price < quoted_price`):**
- Confetti animation (lightweight CSS/canvas, no heavy library)
- Animated counter: **"You saved $347!"**
- Context: *"On brake pad replacement in Austin, TX"*
- Outcome badge:
  - `negotiated_down` → "Negotiation Win"
  - `found_alternative` → "Smart Shopper"
  - `walked_away` → "Walked Away, Saved Big"
- Streak: **"3rd overcharge dodged this month"**
- Milestone toast if level boundary crossed (see Feature 3)
- CTAs: **"View My Savings Dashboard"** → `/vault` | **"Analyze Another Quote"** → `/`

**Paid full price (`final_price >= quoted_price`):**
- No confetti
- Supportive message: *"You paid the quoted price. The fair range was $350–$500 — keep this for next time."*
- CTA: **"Analyze Another Quote"**

**Fair verdict confirmed:**
- Green confirmation: **"Confirmed fair price. Nice find."**
- CTA: **"Analyze Another Quote"**

**No quoted_price on the original query:**
- Skip savings calculation. Show: *"Thanks for reporting! This helps the FairCheck community."*
- CTA: **"Analyze Another Quote"**

**Anonymous user (no auth):**
- Celebration still shows savings amount (computed from the single query), but streak/level are omitted since there's no user_id to track history against. The `streak` field in the response is `null` for anonymous users.

### Backend Changes

Enrich `POST /api/v1/feedback` response with streak data:

**Current response:**
```json
{
    "status": "ok",
    "savings": 34700,
    "currency": "USD"
}
```

**New response:**
```json
{
    "status": "ok",
    "savings": 34700,
    "currency": "USD",
    "streak": {
        "monthly_dodged": 3,
        "lifetime_saved": 124700,
        "level": "savvy",
        "milestone_unlocked": "savvy"
    }
}
```

`milestone_unlocked` is non-null only when this feedback submission crosses a level threshold. The frontend uses this to trigger the milestone toast.

**How streak is computed:**
```sql
-- monthly_dodged: count of queries THIS calendar month where user saved
SELECT COUNT(*) FROM queries
WHERE user_id = :uid
  AND feedback_final_price IS NOT NULL
  AND feedback_final_price < quoted_price
  AND created_at >= date_trunc('month', NOW());

-- lifetime_saved: sum of confirmed savings across all time
SELECT COALESCE(SUM(quoted_price - feedback_final_price), 0) FROM queries
WHERE user_id = :uid
  AND feedback_final_price IS NOT NULL
  AND feedback_final_price < quoted_price;
```

Level is derived from `lifetime_saved` using the threshold table (Feature 3).

---

## Feature 3: Streak & Milestone System

### Savvy Levels

| Level | Threshold | Label |
|-------|-----------|-------|
| 0 | $0 | Newcomer |
| 1 | $100+ (10000 cents) | Novice |
| 2 | $500+ (50000 cents) | Savvy |
| 3 | $2,000+ (200000 cents) | Expert |
| 4 | $5,000+ (500000 cents) | Master Negotiator |

Levels advance only on confirmed savings (feedback submitted), never on projected savings.

### Streak Counter
- **"X overcharges dodged this month"** — queries this calendar month where `feedback_final_price < quoted_price`
- Resets at the start of each calendar month
- Displayed on: celebration screen, Vault dashboard hero

### Milestone Toasts
When feedback submission causes a level-up, the celebration screen shows an extra toast:
- *"Milestone unlocked: Savvy — You've saved over $500!"*
- Shown once per level crossing. Backend computes by comparing level before and after this savings addition.

### Vault Dashboard Enhancement

Current Vault hero: flat numbers for `total_saved` and `overcharges_found`.

**New Vault hero layout:**
```
┌─────────────────────────────────────────────────┐
│  💰 $1,247 saved                    Level: Savvy │
│  ████████████████░░░░ $753 to Expert             │
│                                                   │
│  Confirmed: $890  |  Potential: $357              │
│  7 overcharges found  |  3 dodged this month     │
└─────────────────────────────────────────────────┘
```

- **Savings amount** — large animated rolling counter
- **Level badge** + progress bar toward next level
- **Monthly streak** badge
- **Split stat** — confirmed (from feedback) vs potential (overcharge verdicts without feedback, computed as `quoted_price - fair_price_high`)

### New Backend Endpoint

`GET /api/v1/savings/profile` — replaces or supplements current `GET /api/v1/savings/summary`

**Response:**
```json
{
    "lifetime_saved": 124700,
    "potential_saved": 35700,
    "monthly_streak": 3,
    "total_queries": 12,
    "overcharges_found": 7,
    "level": "savvy",
    "level_label": "Savvy",
    "next_level": "expert",
    "next_level_label": "Expert",
    "next_level_threshold": 200000,
    "progress_to_next": 62,
    "currency": "USD"
}
```

`progress_to_next` = percentage (0-100) of current level toward next threshold.

### No New Database Tables
Everything computed from existing `queries` table: `user_id`, `quoted_price`, `feedback_final_price`, `fair_price_high`, `verdict`, `created_at`.

---

## Shareable Card (Nice-to-Have)

If time allows after the core three features:
- After celebration, a **"Share Your Win"** button generates a card image
- Card shows: savings amount, service name, city, FairCheck branding
- Downloadable as PNG
- Implementation: HTML-to-canvas rendering (html2canvas or similar)
- Not a blocker for the core demo

---

## What We're NOT Building

- No leaderboards or competitive features
- No push notifications or email alerts
- No social login or sharing integration (shareable card is download-only)
- No changes to the core verdict engine or analysis pipeline
- No new database tables or migrations

---

## Files Expected to Change

### Backend
- `app/routers/feedback.py` — Enrich response with streak data
- `app/routers/history.py` — New `GET /savings/profile` endpoint

### Frontend
- Result page component — Add Projected Savings Hero block above existing content
- Feedback modal component — Add celebration overlay state after submission
- Vault page — Enhance hero section with level, progress bar, streak, split stats
- New component: `SavingsCelebration.tsx` — Confetti + counter + badges + milestone toast
- New component: `ProjectedSavings.tsx` — Hero block for verdict page
- New component: `SavingsProfile.tsx` — Enhanced Vault hero with level/progress

### Shared
- `lib/api.ts` — Add `getSavingsProfile()` call, update feedback response type
