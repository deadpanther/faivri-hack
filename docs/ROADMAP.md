# FairCheck — Feature Roadmap & Groundbreaking Ideas

**Last updated:** 2026-04-14
**Status:** Phase 0 complete. This roadmap covers Phase 1-3 with emphasis on features that create defensible moats and viral growth.

---

## The Big Insight

FairCheck's current value is **reactive** — user gets a quote, checks it, maybe negotiates. The groundbreaking opportunity is making it **proactive and ambient**: FairCheck should know you're being overcharged *before you do*.

---

## Tier 1 — Game-Changers (High Impact, Novel)

### 1. Price Memory Network
**What:** Every user who reports their final price feeds a living price graph. Over time, FairCheck builds the most accurate hyperlocal pricing database in the world — not scraped, but *crowdsourced from actual transactions*.

**Why groundbreaking:** No one has this data. Google can tell you "brake pads cost $150-350" but can't tell you "at Joe's Garage on MG Road in Pune, brake pads cost ₹2,800 and he tries to upsell rotors 40% of the time." This is Waze for consumer pricing.

**Implementation:**
- After verdict → user reports final price + vendor name + outcome
- Build vendor reputation scores from aggregated reports
- Show "X people paid Y at this vendor" on verdict screen
- Anonymized — no PII, just price + location + vendor + outcome
- Tables: `community_prices` (exists), add `vendor_scores` (aggregated)

**Effort:** M | **Impact:** Very High | **Defensibility:** Extreme (network effect)

---

### 2. WhatsApp/SMS Bot — "Forward Your Bill"
**What:** Users forward a photo of their bill to a WhatsApp number. FairCheck replies in 30 seconds with the verdict, right in the chat. No app install. No signup.

**Why groundbreaking:** In India, WhatsApp IS the internet for 500M people. A mechanic hands you a bill → you snap it → forward to FairCheck → get verdict before you pay. Zero friction. This is how you get to 10M users.

**Implementation:**
- WhatsApp Business API (via Twilio or Meta Cloud API)
- Webhook receives image → existing `/analyze/image` pipeline
- Reply with formatted verdict message (fair/overcharge + fair range + top 2 questions)
- Track conversations by phone number (no auth needed)
- Free tier: 5 checks/month per phone number

**Effort:** L | **Impact:** Very High | **Defensibility:** High (distribution moat)

---

### 3. Ambient Price Scanner (AR/Camera Mode)
**What:** Point your phone camera at a bill, menu, or price tag. FairCheck overlays fair prices in real-time. Think Google Lens but for price fairness.

**Why groundbreaking:** No one does real-time price verification on camera. Imagine walking through a car service center and pointing your phone at their price board — every item gets a green/red overlay.

**Implementation:**
- Camera feed → frame capture every 2s → OCR (on-device Tesseract or cloud Vision API)
- Extract prices + item descriptions → batch classify → show overlays
- Start with receipts/bills (structured), then expand to price boards
- React Native or PWA with camera access

**Effort:** XL | **Impact:** Very High | **Defensibility:** High (tech moat)

---

### 4. Predictive Maintenance Advisor
**What:** Based on your car's make/model/year/mileage, FairCheck proactively tells you what services are coming due and what they should cost — *before* a mechanic tries to sell them to you.

**Why groundbreaking:** Shifts FairCheck from reactive ("am I being cheated?") to proactive ("here's what to expect"). Users open the app even when they don't have a quote.

**Implementation:**
- User enters vehicle profile (make, model, year, mileage)
- Maintenance schedule database (OEM intervals: oil every 10K km, brakes every 40K, etc.)
- Push notifications: "Your Honda City is due for timing belt at 60K km. Fair price in Pune: ₹4,000-8,000"
- Tables: `vehicles` (user_id, make, model, year, mileage, last_updated)
- Tables: `maintenance_schedules` (make, model, service, interval_km, interval_months)

**Effort:** M | **Impact:** High | **Defensibility:** Medium

---

### 5. Group Negotiation Power
**What:** When multiple users in the same city need the same service, FairCheck groups them and negotiates a bulk deal with verified vendors. "4 people in Pune need brake pads this week — here's a group rate from 3 verified garages."

**Why groundbreaking:** Turns individual consumers into a buying group. Vendors get guaranteed volume, consumers get guaranteed fair prices. FairCheck takes a small referral fee.

**Implementation:**
- Match users by: city + domain + service_category + time window (7 days)
- Show "3 others in your area need the same service" on verdict screen
- Partner with multi-brand service centers (GoMechanic, MyTVS in India; RepairPal in US)
- Revenue: 5-10% referral fee from vendor on completed group deals

**Effort:** L | **Impact:** Very High | **Defensibility:** Very High (two-sided marketplace)

---

## Tier 2 — Strong Features (High Impact, Less Novel)

### 6. Medical Prescription Domain
**What:** Expand from auto to medical. "Doctor prescribed 5 medicines costing ₹2,400 — are there cheaper generic alternatives?"

**Implementation:**
- NPPA drug price database (India government data)
- GoodRx-style generic alternatives (US)
- Drug interaction warnings
- Seed: top 200 drugs per market
- Domain prompt template in `domains/medical.py`

**Effort:** M | **Impact:** High

### 7. Contractor/Home Services Domain
**What:** "Plumber quoted ₹15,000 for bathroom renovation" or "Contractor wants $8,000 for deck repair."

**Implementation:**
- Material cost databases (IndiaMART, Home Depot)
- Labor rate by city and skill level
- Scope validation (is the work actually needed?)
- Seed: top 50 home services per market

**Effort:** M | **Impact:** High

### 8. Vendor Transparency Scores
**What:** Every vendor (garage, pharmacy, contractor) gets a public transparency score based on: how close their quotes are to fair, how many red flags, customer outcome reports.

**Implementation:**
- Aggregate from `community_prices` and feedback data
- Score = weighted average of: price_fairness, itemization_quality, outcome_satisfaction
- Public profile pages: `faircheck.app/vendor/joes-garage-pune`
- "FairCheck Verified" badge for vendors who opt in

**Effort:** M | **Impact:** High

### 9. Price Trend Alerts
**What:** "Brake pad prices in Mumbai dropped 15% this month" or "AC repair costs spike every May in Houston." Users subscribe to categories they care about.

**Implementation:**
- Weekly aggregation job over `pricing_knowledge` + `community_prices`
- Detect significant price movements (>10% change)
- Email/push notification to subscribed users
- Dashboard: `/trends` page with time-series charts

**Effort:** S | **Impact:** Medium

### 10. Comparative Quotes
**What:** Instead of just telling you the fair range, FairCheck shows you actual quotes from verified vendors nearby. "3 garages in Pune quoted ₹3,500, ₹4,200, and ₹5,100 for the same work."

**Implementation:**
- Partner vendors submit their standard pricing
- Match to user's query by service + city
- Show ranked comparison on verdict screen
- Revenue: vendors pay for featured placement

**Effort:** M | **Impact:** High

---

## Tier 3 — Polish & Scale

### 11. Multi-language Support
Hindi, Tamil, Telugu, Marathi for India. Spanish for US. Voice input already supports this via Whisper.

### 12. Offline Mode (PWA)
Cache recent verdicts and pricing data. Allow text queries to queue when offline, process when back online.

### 13. Browser Extension
Auto-detect prices on e-commerce sites and show fair price comparison inline.

### 14. API for Partners
Insurance companies, fleet managers, and consumer protection agencies can integrate FairCheck's pricing intelligence.

### 15. Subscription Tiers
- Free: 5 queries/month
- Pro (₹199/$4.99/mo): Unlimited queries, voice, image, history, alerts
- Family (₹399/$9.99/mo): 5 members, shared vehicle profiles, group negotiation

---

## Implementation Priority (Next 4 Weeks)

### Week 1-2: Foundation Expansion
- [ ] Medical prescription domain (seed NPPA + GoodRx data)
- [ ] Home services domain (seed top 50 services)
- [ ] Vendor transparency scores (aggregate from existing feedback)
- [ ] Price Memory Network v1 (enhanced feedback → community data loop)

### Week 2-3: Distribution
- [ ] WhatsApp Bot MVP (Twilio + image analysis)
- [ ] PWA setup (service worker, offline verdict cache)
- [ ] Share verdict as image (for Twitter/WhatsApp viral loop)

### Week 3-4: Retention
- [ ] Vehicle profiles + predictive maintenance
- [ ] Price trend alerts (weekly email digest)
- [ ] Comparative quotes from partner vendors

### Month 2: Marketplace
- [ ] Group negotiation MVP
- [ ] Vendor profiles + FairCheck Verified
- [ ] Subscription billing (Stripe)

---

## Success Metrics

| Metric | Target (Month 1) | Target (Month 3) |
|--------|------------------|------------------|
| Queries/day | 100 | 5,000 |
| Unique users/month | 1,000 | 50,000 |
| Money saved (total) | ₹5L / $5K | ₹2Cr / $250K |
| Community price reports | 500 | 25,000 |
| WhatsApp users | — | 10,000 |
| Vendor partners | — | 50 |

---

## What Makes FairCheck Defensible

1. **Network effect:** Every query + feedback makes the pricing data better for everyone
2. **Hyperlocal data:** City-level, vendor-level pricing that can't be scraped from Google
3. **Distribution:** WhatsApp bot reaches users where they already are
4. **Two-sided marketplace:** Vendors need consumers, consumers need fair prices
5. **Switching cost:** Vehicle profiles, history, saved money tracking create stickiness
