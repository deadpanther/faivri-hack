# FairCheck Frontend Documentation

## Overview

Next.js 16 + React 19 + TypeScript frontend with dark-mode glassmorphism design system. Supports multimodal input (text, image, voice), real-time verdict display, negotiation coaching, and community price intelligence. Uses Clerk for authentication and Framer Motion for animations.

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.3 |
| UI Library | React | 19.2.4 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 (PostCSS) |
| Animation | Framer Motion | 12.38.0 |
| Icons | Lucide React | 1.8.0 |
| Auth | Clerk | 7.0.12 |
| Auth Theming | @clerk/themes | 2.4.57 |

## Directory Structure

```
frontend/src/
├── app/                              # Next.js App Router
│   ├── layout.tsx                   # Root layout: Providers, Nav, ambient BG
│   ├── page.tsx                     # Home: PreLoginLanding | AnalyzerStudio
│   ├── globals.css                  # Design system (600+ lines of tokens)
│   ├── sign-in/[[...sign-in]]/page.tsx   # Clerk sign-in
│   ├── sign-up/[[...sign-up]]/page.tsx   # Clerk sign-up
│   ├── result/
│   │   ├── [id]/page.tsx            # Verdict result display
│   │   └── purchase/[slug]/page.tsx # Used car purchase result
│   ├── negotiate/[id]/page.tsx      # Negotiation coach
│   ├── vault/page.tsx               # History + savings dashboard
│   ├── community/page.tsx           # Community feed + vendor scores
│   └── garage/page.tsx              # Vehicle profiles + maintenance
├── components/
│   ├── Providers.tsx                # ClerkProvider + ToastProvider
│   ├── auth/
│   │   └── AuthShell.tsx            # Reusable auth page layout
│   ├── home/
│   │   ├── AnalyzerStudio.tsx       # Main input workspace (755 lines)
│   │   └── PreLoginLanding.tsx      # Marketing landing page (327 lines)
│   ├── layout/
│   │   └── Nav.tsx                  # Sticky header + mobile tab bar
│   └── ui/
│       ├── FreshnessBadge.tsx       # Data source freshness indicator
│       ├── Recommendations.tsx      # LLM + general recommendations
│       ├── Skeleton.tsx             # Loading skeleton placeholders
│       ├── Toast.tsx                # Toast notification system
│       └── VoiceRecorder.tsx        # Web Speech API + MediaRecorder
├── lib/
│   ├── api.ts                       # Typed API client (239 lines)
│   ├── constants.ts                 # Domains, countries, cities, formatPrice
│   └── motion.ts                    # Motion presets (durations, easings, springs)
└── proxy.ts                         # Clerk middleware config
```

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | Home | PreLoginLanding (signed-out) or AnalyzerStudio (signed-in) |
| `/sign-in` | Sign In | Clerk authentication |
| `/sign-up` | Sign Up | Clerk registration |
| `/result/[id]` | Verdict | Analysis result with gauge, fair range, red flags, evidence |
| `/result/purchase/[slug]` | Purchase Result | Used car purchase analysis |
| `/negotiate/[id]` | Negotiate | Scripts, tactics, counter-offer generator |
| `/vault` | Vault | Query history + savings dashboard |
| `/community` | Community | Price feed + vendor benchmarks + trends |
| `/garage` | Garage | Vehicle profiles + maintenance schedules |

## Key Components

### AnalyzerStudio (`components/home/AnalyzerStudio.tsx`)
Main interaction hub. Features:
- **3 input modes:** Type (text), Scan (image upload), Speak (voice recording)
- **6 domain chips:** Auto, Medical, Home, Legal, Invoice, Purchase
- **Provider selector:** Anthropic / OpenAI dropdown
- **Geolocation:** Auto-detect via browser API with manual city/country override
- **Quick prompts:** Domain-specific example queries
- **Loading timeline:** 3-stage progress display during analysis
- **Image upload:** Drag-drop + click with preview
- **Purchase mode:** Dedicated form for make/model/year/mileage/price

### Verdict Page (`app/result/[id]/page.tsx`)
- Overcharge multiplier hero with spring animation
- Fair price range bar
- Confidence score with data point count
- Red flags list
- Questions to ask list
- Freshness badge (live/cached/knowledge_base)
- "Report final price" feedback modal
- Recommendations sidebar (lazy-loaded)
- Share and Negotiate CTAs

### Negotiation Page (`app/negotiate/[id]/page.tsx`)
- Conversation scripts with role labels (You/Them)
- Practice mode (progressive reveal)
- Tactics breakdown cards
- Target price + walk-away threshold sidebar
- Evidence summary with copy button
- Counter-offer analyzer (submit vendor's counter → get response strategy)

### Nav (`components/layout/Nav.tsx`)
- Desktop: Sticky header with logo, nav links, auth buttons
- Mobile: Bottom tab bar
- Active link highlighting
- Clerk UserButton integration

## API Client (`lib/api.ts`)

Base URL: `NEXT_PUBLIC_API_URL` env var (defaults to `http://localhost:8000`)

### TypeScript Interfaces

```typescript
VerdictData        // Full analysis result with verdict, multiplier, fair range, confidence
NegotiateData      // Negotiation scripts, tactics, target price, walk-away line
CounterOfferData   // Counter-offer response strategy
HistoryItemData    // Individual query record for vault
RecommendationItem // Single recommendation with title, description, priority
SavingsData        // Aggregate savings: total_saved, total_queries, overcharges_found
ProvidersData      // Available providers list + default
```

### API Methods

```typescript
// Analysis
api.analyze(query, options)          // Text analysis
api.analyzeImage(file, options)      // Image/receipt analysis (FormData)
api.analyzeVoice(blob, options)      // Voice recording analysis (FormData)
api.analyzePurchase(vehicleData)     // Used car purchase analysis

// Results
api.getVerdict(id)                   // Fetch verdict by ID
api.getRecommendations(queryId)      // Personalized recommendations

// Negotiation
api.negotiate(queryId, data)         // Generate negotiation scripts
api.counterOffer(queryId, data)      // Counter-offer response

// Feedback
api.feedback(queryId, finalPrice, outcome, vendorName)

// History & Savings
api.getHistory(page, limit)
api.getSavings()

// Community
api.getCommunityPrices(filters)
api.getVendorScores(filters)
api.getTrends(filters)

// Vehicles
api.getVehicles()
api.createVehicle(data)
api.getMaintenanceSchedule(vehicleId)

// Providers
api.getProviders()
```

## Design System (`globals.css`)

### Color Palette (Dark Theme)
| Token | Value | Usage |
|-------|-------|-------|
| `--clr-primary` | #1856ff | Buttons, links, active states |
| `--clr-success` | #07ca6b | Fair verdicts, positive indicators |
| `--clr-danger` | #ea2143 | Overcharge verdicts, red flags |
| `--clr-warning` | #e89558 | High verdicts, caution states |
| `--clr-secondary` | #7e3def | Purple accents |
| `--clr-info` | #31a8ff | Informational badges |

### Typography
- **Display/Body:** Space Grotesk
- **Monospace:** JetBrains Mono (data, prices)
- **Scale:** `--type-12` through `--type-40` (8 steps)

### UI Classes
| Class | Purpose |
|-------|---------|
| `.ui-surface` / `.ui-surface-strong` | Card/container backgrounds |
| `.ui-button-primary` / `.ui-button-secondary` | Button variants |
| `.ui-section` / `.ui-container` | Layout containers |
| `.card-accent` / `.card-danger` / `.card-green` / `.card-warning` | Status cards |
| `.ui-stat` | Statistics cards with gradient |
| `.glass` / `.glass-soft` / `.glass-strong` | Glassmorphism tiers (16/24/32px blur) |
| `.ui-kicker` / `.ui-title-display` / `.ui-title-section` / `.ui-lead` | Typography |

### Background Effects
- Radial gradient "ambient orbs" (blue top-left, purple bottom-right)
- Grid mesh overlay
- Film grain texture
- All algorithmic — no images

### Motion System (`lib/motion.ts`)
```typescript
DUR.FAST    = 0.12s   // Micro-interactions
DUR.NORMAL  = 0.22s   // Standard transitions
DUR.SLOW    = 0.42s   // Page reveals

EASE.OUT    = cubic-bezier(0.16, 1, 0.3, 1)
EASE.INOUT  = cubic-bezier(0.65, 0, 0.35, 1)

SPRING_KPI  = { type: "spring", stiffness: 80, damping: 15 }

reveal      = fade-in + slide-up variant
stagger     = staggered children animation container
```

## State Management

- **No global store** (no Redux/Zustand)
- React hooks only: `useState`, `useEffect`, `useCallback`, `useMemo`, `useContext`
- Custom `ToastContext` for notifications
- Direct API calls (no React Query/SWR)
- Clerk handles auth session state

## Authentication Flow

- **Provider:** Clerk (`@clerk/nextjs` v7.0.12)
- **Protected content:** `<Show when="signed-in">` conditional rendering
- **Components used:** `<SignInButton>`, `<SignUpButton>`, `<UserButton>`
- **Middleware:** `proxy.ts` — Clerk intercepts requests
- **Theming:** Custom accent colors in `Providers.tsx`

## Environment Variables

```env
NEXT_PUBLIC_API_URL=http://localhost:8000   # Backend API base URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...    # Clerk public key
CLERK_SECRET_KEY=sk_...                     # Clerk secret key
```

## Running the Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

### Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Browser APIs Used

- **`navigator.geolocation`** — Auto-detect user location
- **`SpeechRecognition`** — Web Speech API for voice input
- **`MediaRecorder`** — Audio recording fallback
- **`FormData`** — Multipart file/audio uploads
