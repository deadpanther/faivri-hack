# TypeUI-Inspired UI System Adaptation

This project now borrows the following design-system patterns from the TypeUI Design Skills approach:

## 1) Foundation Tokens First
- Semantic colors and surfaces are defined once in `frontend/src/app/globals.css`.
- Motion, spacing, radius, and typography scales are tokenized.
- Components should consume tokens instead of introducing one-off values.

## 2) Predictable Layout Rhythm
- Shared primitives:
  - `.ui-container`
  - `.ui-section`
  - `.ui-kicker`
  - `.ui-title-display`
  - `.ui-title-section`
  - `.ui-lead`
- This keeps landing, auth, and app pages aligned on spacing and hierarchy.

## 3) Component Consistency
- Shared primitives:
  - `.ui-surface`
  - `.ui-surface-strong`
  - `.ui-stat`
  - `.ui-button-primary`
  - `.ui-button-secondary`
  - `.ui-control-group`
  - `.ui-chip`
- Hover/focus and state behavior should remain consistent via these primitives.

## 4) Accessibility and State Clarity
- Focus-visible outlines remain globally enforced.
- Primary and secondary actions have consistent visual weight.
- Section labels and headings are structured to improve scanability.

## 5) Current Coverage
- Pre-login landing (`/`) when signed out
- Analyzer studio (`/`) when signed in
- Sign-in and sign-up pages
- Global shell/nav and shared token system

## Next Recommended Extension
Apply the same primitives to:
- `frontend/src/app/result/[id]/page.tsx`
- `frontend/src/app/negotiate/[id]/page.tsx`
- `frontend/src/app/vault/page.tsx`

This will complete cross-journey consistency.
