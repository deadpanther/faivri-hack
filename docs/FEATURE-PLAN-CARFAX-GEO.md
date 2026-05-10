# Feature Plan: Car Purchase Intelligence + Smart Geolocation

**Date:** 2026-04-14
**Status:** Ready for approval

---

## Feature 1: Car Purchase Intelligence ("FairCheck for Buying Cars")

### The Problem
When someone buys a used car, they face massive information asymmetry:
- They don't know what repairs the car has had (or should have had)
- They don't know what maintenance is due based on mileage
- They can't estimate the **true cost of ownership** (purchase price + upcoming repairs)
- Dealers/sellers hide expensive upcoming maintenance to inflate perceived value

### The Solution
A new "Car Purchase Check" mode. User enters: **make, model, year, mileage, asking price, city**. FairCheck returns:

1. **Maintenance audit** — What services SHOULD have been done by this mileage (and likely cost if they weren't)
2. **Upcoming costs** — What's due in the next 10K/20K/50K km with estimated prices
3. **True cost of ownership** — Asking price + estimated maintenance for next 1 year
4. **Red flags** — Common issues for this make/model/year (from web search + recall data)
5. **Fair price verdict** — Is the asking price fair given the car's condition profile?
6. **Questions to ask the seller** — Specific to this car's expected maintenance state

### Data Sources (All Live)
| Source | What it provides | Method |
|--------|-----------------|--------|
| **NHTSA Recalls API** (free, US) | Open recalls for make/model/year | REST API — `https://api.nhtsa.dot.gov/recalls/recallsByVehicle` |
| **NHTSA Complaints API** (free, US) | Common complaints/defects | REST API — `https://api.nhtsa.dot.gov/complaints/complaintsByVehicle` |
| **Tavily web search** | Market price, common issues, owner reviews | Existing pipeline |
| **Our maintenance schedule** | What's due at this mileage | `vehicles.py` MAINTENANCE_SCHEDULE (already built) |
| **Team-BHP / CarDekho** (India) | Common issues, ownership costs | Tavily search |

### No Carfax API Needed
Carfax is B2B, expensive ($$$), and US-only. Instead, we:
- Use free NHTSA APIs for recalls and complaints (US)
- Use Tavily to search for "common problems [make] [model] [year]"
- Use our existing maintenance schedule to flag what's overdue
- Build a **cost projection model** from our pricing database + web data

This gives 80% of Carfax's value at 0% of the cost, AND works in India.

### Architecture

```
User: "Buying a 2019 Honda City, 45K km, asking ₹7.5L in Pune"
        ↓
   Parse: make=Honda, model=City, year=2019, mileage=45000, asking_price=750000, city=Pune
        ↓
   [Parallel fetch]
   ├── Maintenance audit (what's due/overdue at 45K km)
   ├── NHTSA recalls + complaints (US only)
   ├── Tavily: "2019 Honda City common problems India"
   ├── Tavily: "2019 Honda City fair price 45000 km Pune"
   └── Tavily: "Honda City maintenance cost India"
        ↓
   LLM synthesizes:
   - Maintenance report (done/overdue/upcoming)
   - Cost projection (next 12 months)
   - Fair price verdict (asking vs market)
   - Red flags + questions for seller
```

### New Backend Components

**1. `POST /api/v1/analyze/purchase`**
```json
// Request
{
  "make": "Honda",
  "model": "City",
  "year": 2019,
  "mileage_km": 45000,
  "asking_price": 750000,  // in smallest currency unit
  "city": "Pune",
  "country": "IN"
}

// Response
{
  "id": "...",
  "vehicle": { "make": "Honda", "model": "City", "year": 2019, "mileage_km": 45000 },
  "asking_price_verdict": "high",  // fair | high | overcharge
  "fair_price_range": { "low": 600000, "high": 720000 },
  "maintenance_audit": [
    { "service": "Oil Change", "status": "overdue", "due_at_km": 40000, "estimated_cost": 250000, "note": "Should have been done 5K km ago" },
    { "service": "Brake Pads", "status": "upcoming", "due_at_km": 50000, "estimated_cost": 350000, "note": "Due in ~5K km" },
    { "service": "Timing Belt", "status": "ok", "due_at_km": 60000, "estimated_cost": 800000, "note": "Due at 60K km" }
  ],
  "cost_projection_12mo": {
    "total": 1500000,  // ₹15,000 in maintenance over next year
    "breakdown": [
      { "service": "Oil Change x2", "cost": 500000 },
      { "service": "Brake Pads", "cost": 350000 },
      { "service": "Air Filter", "cost": 80000 }
    ]
  },
  "true_cost_of_ownership": 900000,  // asking + 12mo maintenance
  "recalls": [],  // from NHTSA (US) or web search (India)
  "common_issues": ["AC compressor failure common after 50K km", "..."],
  "red_flags": ["Timing belt due at 60K — expensive if not done", "..."],
  "questions_for_seller": [
    "When was the last oil change? Can you show the service receipt?",
    "Has the timing belt ever been replaced?",
    "Any AC compressor issues?"
  ],
  "freshness": { "source": "live", "live_search": true }
}
```

**2. `app/domains/purchase.py`** — Purchase-specific LLM context
**3. `app/intelligence/nhtsa.py`** — NHTSA recalls + complaints client (free API)
**4. `app/intelligence/purchase_analyzer.py`** — Orchestrates purchase analysis

### New Frontend Components

**1. Purchase mode on Home page**
- Add "Buy a Car" to domain chips
- When selected, show a structured form: Make, Model, Year, Mileage, Asking Price
- Different from the free-text input — this is guided

**2. Purchase Result page** (`/result/purchase/[id]`)
- Maintenance audit timeline (visual: green/amber/red items on a mileage axis)
- Cost projection chart (stacked bars: purchase + Year 1 maintenance)
- True cost of ownership hero number
- Recall alerts (if any)
- Red flags + questions for seller (existing pattern)

### Effort: L (1-2 days) | Impact: Very High

---

## Feature 2: Smart Geolocation with Confirmation

### The Problem
Current flow: user manually selects country + city from dropdowns. Feels manual and friction-heavy. The geolocation auto-detect exists but silently sets the dropdown without user awareness.

### The Solution
Replace dropdown-first with **detect-first, confirm-second**:

```
Page loads → detect location → show confirmation banner:

┌─────────────────────────────────────────────────────────┐
│ 📍 Detected: Pune, India                    [✓ Correct] [✗ Change] │
└─────────────────────────────────────────────────────────┘

If "Correct" → set and dismiss (green flash confirmation)
If "Change" → expand inline city/country selector
If detection fails → show selector immediately (no banner)
```

### UX Flow
1. On page load, call geolocation API (existing code)
2. Show a slim **confirmation strip** below the nav, above the hero
3. Strip shows: detected city + country with Correct / Change buttons
4. "Correct" → animate green checkmark, strip slides up and disappears, location locked
5. "Change" → strip expands to show country + city dropdowns (same as current)
6. Location persists in `localStorage` across sessions — don't ask again until cleared
7. On subsequent visits, show small "📍 Pune, India" badge in the input card (not a strip)

### Why This Matters
- Reduces friction: one tap vs two dropdown selections
- Builds trust: "FairCheck knows where I am" feels smart
- Enables hyperlocal: future features (vendor recommendations, community prices) depend on accurate location
- Works for both India and US users

### Architecture

**New component: `<LocationConfirm />`**
- Client component, renders as a slim strip at the top of the page
- State: `detecting | confirming | confirmed | manual`
- Persists to `localStorage: faircheck_location = { city, country, confirmed_at }`
- Exported from `@/components/ui/LocationConfirm.tsx`

**Changes to Home page:**
- Remove the country/city dropdowns from the input card
- Add `<LocationConfirm />` above the hero
- Read confirmed location from localStorage, pass to analyze API
- Show small location badge in the input card: "📍 Pune, India · Change"

### Effort: S (half day) | Impact: Medium-High

---

## Implementation Order

### Sprint 1 (Do First — Quick Win)
1. **Smart Geolocation** — small component, big UX improvement, no backend changes
2. **Purchase mode: backend** — new endpoint + NHTSA client + purchase analyzer

### Sprint 2 (Build on Sprint 1)
3. **Purchase mode: frontend** — guided form + purchase result page
4. **Persist location** across routes via localStorage

### Sprint 3 (Polish)
5. **Purchase result page** — maintenance timeline visualization, cost projection chart
6. **Integration tests** — purchase flow end-to-end, both markets

---

## What This Unlocks

| Current FairCheck | With These Features |
|-------------------|---------------------|
| "Am I being overcharged for this repair?" | + "Am I being overcharged for this CAR?" |
| Manual city selection | Smart location detection |
| Reactive (after getting a quote) | **Proactive** (before buying, before maintenance is due) |
| Service price checker | **Ownership cost advisor** |

The purchase intelligence feature especially creates a new entry point — people shopping for cars can use FairCheck BEFORE they even own the car, building the habit early. Then when they need repairs, FairCheck is already their trusted tool.
