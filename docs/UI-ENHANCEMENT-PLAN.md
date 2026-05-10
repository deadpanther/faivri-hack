# FairCheck UI Enhancement Plan (Page-by-Page)

**Last updated:** 2026-04-14  
**Goal:** Make FairCheck feel premium, dynamic, and conversion-focused while keeping clarity and trust.

---

## 1. Design Direction

### Product Feel
- Confident, fast, and trustworthy.
- “Live intelligence” should feel visible at every step.
- Motion should guide decisions, not just decorate screens.

### Core UX Principles
- One primary action per screen.
- Progressive disclosure for detail (show summary first, then evidence).
- Every major state should have explicit feedback (loading, partial data, errors, success).

### Motion Principles
- Use motion for hierarchy: verdict first, then explanation, then actions.
- Keep micro-interactions fast (`120–220ms`), hero transitions slower (`350–500ms`).
- Add route-level continuity (shared elements, not hard cuts).

---

## 2. Global System Enhancements (All Pages)

## Visual System
- Add a **display font** for hero/KPI only (keep Inter for body/UI).
- Introduce card variants by purpose:
  - `evidence-card`
  - `warning-card`
  - `action-card`
- Increase spacing rhythm consistency (8pt system, stronger section separation).

## Interaction System
- Standardize button states: default, hover, active, loading, disabled, success.
- Add consistent toast system for all async actions.
- Add skeleton loaders (not spinners-only) for list/content blocks.

## Trust Layer
- Add a reusable “data freshness” component:
  - `Live`
  - `Cached Xh ago`
  - `Limited evidence`
- Add reusable “confidence explanation” tooltip/popover.

## Accessibility
- Add keyboard navigation for dropdowns, chips, and action cards.
- Add `aria-live="polite"` regions for status changes.
- Ensure contrast for muted text and badges in low-light backgrounds.

---

## 3. Page-by-Page Enhancements

## A) Home Page (`/`)

### Current Role
Entry point for text/image/voice analysis.

### UX Goals
- Reduce friction to first analysis.
- Make mode choice obvious and delightful.
- Increase confidence before submit.

### Enhancements
1. **Mode Switcher**
- Add segmented control: `Type`, `Scan`, `Speak`.
- Animate input panel transition based on selected mode.
- Dynamically change helper copy and example prompts.

2. **Guided Input Assistant**
- Add “smart prompt chips” per domain and city.
- Show inline extraction preview for voice/image before submit.
- Add “estimated time” + “likely confidence” indicators pre-submit.

3. **Stronger Primary CTA**
- Keep one dominant CTA with contextual text:
  - `Analyze Quote`
  - `Analyze Invoice`
  - `Analyze Voice Note`
- Add loading stage timeline:
  - `Classifying`
  - `Fetching market data`
  - `Synthesizing verdict`

4. **Trust + Proof at Fold**
- Replace static stats with live mini-proof cards:
  - “X checks in your city today”
  - “Y overcharges detected this week”
- Add “How verdict is computed” expandable section.

5. **Micro-Polish**
- Close provider dropdown on outside click and `Esc`.
- Add upload progress for large image/voice files.
- Add drag/drop success confirmation and replace/remove control clarity.

### Metrics
- Time to first successful analysis.
- Submit conversion rate.
- Drop-off by input mode (text/image/voice).

### Priority
- **P0:** mode switcher, loading stage timeline, trust cards.
- **P1:** guided assistant, inline extraction preview.

---

## B) Result Page (`/result/[id]`)

### Current Role
Core verdict and decision screen.

### UX Goals
- Make verdict immediately understandable.
- Convert user from “read” to “act.”
- Increase trust in evidence quality.

### Enhancements
1. **Narrative Reveal Sequence**
- Animate in strict order:
  1. Verdict multiplier
  2. Fair range + quoted delta
  3. Why (top 3 reasons)
  4. Red flags/questions
  5. Action panel

2. **Decision Clarity Block**
- Add explicit top-line summary:
  - “You’re likely paying ~₹X above fair.”
- Add “Best next action now” card with one recommended move.

3. **Evidence Transparency Panel**
- Upgrade source section with:
  - freshness timestamp
  - source quality score
  - clickable citations
  - evidence count per source type

4. **Action Ladder**
- Replace equal-weight CTAs with ranked action ladder:
  1. `Start Negotiation Coach` (primary)
  2. `Share Evidence` (secondary)
  3. `Report Final Price` (tertiary)
- Add expected outcome text under each action.

5. **Adaptive States**
- If low confidence: show caution banner + “How to improve accuracy”.
- If no quoted price: show “enter quoted price now” inline module.

### Metrics
- Click-through to negotiation page.
- Share action usage.
- Feedback submission rate.

### Priority
- **P0:** narrative reveal, decision clarity, ranked CTA ladder.
- **P1:** advanced evidence panel with citations.

---

## C) Negotiation Page (`/negotiate/[id]`)

### Current Role
Conversation scripts + tactics.

### UX Goals
- Convert script into real-world behavior.
- Improve confidence under pressure.
- Make export/share immediately useful.

### Enhancements
1. **Practice Mode**
- Step-through conversation flow one turn at a time.
- Provide quick responses (“if they push back on price”, “if they refuse itemization”).

2. **Tone & Strategy Controls**
- Toggle response style:
  - `Polite`
  - `Firm`
  - `Direct`
- Toggle strategy:
  - `Anchor low`
  - `Evidence-first`
  - `Walk-away early`

3. **Utility Upgrades**
- Copy button per script line.
- Mark lines as used.
- One-tap “Send on WhatsApp” for selected script bundle.

4. **Outcome Prediction**
- Show “likely save range” from this negotiation plan.
- Add “minimum acceptable price” + “walk-away script” sticky card.

5. **Post-Negotiation Loop**
- Add immediate outcome capture:
  - final quote
  - final paid price
  - vendor name

### Metrics
- Script copy usage.
- Outcome submission completion.
- Negotiation-to-feedback conversion.

### Priority
- **P0:** practice mode, copy per line, outcome capture.
- **P1:** tone/strategy controls, predicted save range.

---

## D) Vault / History Page (`/vault`)

### Current Role
History + total savings.

### UX Goals
- Build habit and retention.
- Give users progress and confidence over time.

### Enhancements
1. **Insights Dashboard**
- Add charts:
  - savings trend over time
  - overcharge rate by category
  - top city/domain savings

2. **Power Filters**
- Domain, date range, verdict type, city, provider filters.
- Search by query/vendor/service.

3. **Progress & Motivation**
- Add milestones:
  - “Saved first ₹10,000”
  - “5 successful negotiations”
- Add monthly recap card.

4. **History Cards Upgrade**
- Add confidence/freshness badges.
- Add quick actions:
  - reopen verdict
  - reopen negotiation
  - share summary

5. **Multi-Currency Clarity**
- Show savings in native + normalized reference currency.
- Add clear conversion timestamp/rate source.

### Metrics
- Return frequency (weekly active users).
- Repeat analysis rate.
- History-to-reanalysis flow usage.

### Priority
- **P1:** filters + dashboard basics.
- **P2:** milestones + monthly recap.

---

## E) Navigation & Layout

### UX Goals
- Keep orientation clear.
- Improve continuity across screens.

### Enhancements
1. **Route Transitions**
- Add shared element transition from Home input card to Result header.
- Add subtle page enter/exit animation (consistent across all pages).

2. **Context Persistence**
- Persist city/country/domain/provider across session and routes.
- Show compact context strip in result/negotiate pages.

3. **Mobile Bottom Nav**
- Add stronger active indicator and haptic-like press feedback style.
- Add badge counters (new insights, unresolved negotiations).

### Priority
- **P0:** context persistence.
- **P1:** shared transitions.

---

## 4. State Design Matrix (Must Implement)

For each page, define and design these states explicitly:
- Initial empty
- Loading (with meaningful stage)
- Success
- Partial data / low confidence
- Error with retry
- Offline / degraded mode (if applicable)

---

## 5. 3-Sprint Rollout Plan

## Sprint 1 (P0 Core Experience)
- Home mode switcher + loading stage timeline
- Result narrative reveal + decision clarity + CTA ladder
- Negotiation practice mode + line copy
- Context persistence across routes

## Sprint 2 (Trust + Utility)
- Evidence transparency panel with citations/freshness
- Report final price full UX flow
- Share evidence + WhatsApp share path
- Skeleton loaders + unified toast system

## Sprint 3 (Retention + Intelligence UX)
- Vault filters + trend charts
- Milestones/recap cards
- Advanced negotiation controls (tone/strategy)
- Route-level shared transitions polish

---

## 6. Definition of Done (UI Enhancement Track)

- Primary action CTR improves on Home and Result pages.
- Negotiation start rate and feedback submission rate both increase.
- Users can explain why the verdict was produced (trust test).
- All key flows pass mobile usability test (one-thumb interaction).
- No dead-end CTAs on primary journey screens.

---

## 7. Notes for Build Team

- Prioritize **clarity over decoration** on critical decision screens.
- Keep animation purposeful and deterministic; avoid random motion noise.
- Every new visual element should map to either trust, speed, or conversion.

