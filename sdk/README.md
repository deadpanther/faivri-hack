# faivri

Typed TypeScript client for the [Faivri](https://faivri.com) pricing
intelligence API — analyze quotes against live market comps, generate
negotiation scripts, and track lifetime savings.

```bash
npm install faivri
```

## Quickstart

### Node.js (server-side)

```ts
import { createFaivriClient } from 'faivri'

const faivri = createFaivriClient({
  apiKey: process.env.FAIVRI_API_KEY,
})

const verdict = await faivri.analyze({
  query: 'Front brake pads + rotors on a 2019 Honda Civic',
  domain: 'auto',
  quoted_price: 740,
  city: 'Los Angeles',
  country: 'US',
})

if (verdict.expected_overpay > 0) {
  const scripts = await faivri.negotiate(verdict.id)
  console.log(scripts.target_price, scripts.scripts)
}
```

### Browser (Clerk / any short-lived JWT)

```ts
import { createFaivriClient } from 'faivri'
import { useAuth } from '@clerk/nextjs'

const { getToken } = useAuth()

const faivri = createFaivriClient({
  baseUrl: process.env.NEXT_PUBLIC_FAIVRI_URL,
  accessToken: () => getToken(),
})

const verdict = await faivri.analyze({ query: 'MRI cost in Texas' })
```

## Usage quotas

Before enabling the analyze button, check remaining quota:

```ts
const { plan, limit, remaining, reset_at, unlimited } = await faivri.getUsage()

if (!unlimited && remaining === 0) {
  // Show the upgrade modal — quota resets on ${reset_at}
}
```

## Error handling

Every non-2xx response throws a `FaivriError` that carries the HTTP status
and the raw JSON body, so you can branch on the codes the server already
computed for you:

```ts
import { FaivriError } from 'faivri'

try {
  await faivri.analyze({ query: 'MRI cost' })
} catch (err) {
  if (err instanceof FaivriError) {
    if (err.status === 402) {
      // Quota exhausted — `err.body.detail` has `plan`, `limit`, `reset_at`
    } else if (err.status === 429) {
      // Rate limited — back off and retry
    } else if (err.status === 401) {
      // Not signed in — prompt sign-in
    }
  }
}
```

## What you can call

| Group | Methods |
|-------|---------|
| Analyze | `analyze`, `analyzeImage`, `analyzeVoice`, `analyzePurchase`, `getPurchaseAnalysis` |
| Negotiate | `negotiate`, `counterOffer`, `feedback` |
| History | `getHistory`, `getVerdict`, `deleteVerdict`, `purgeHistory`, `getRecommendations` |
| Community | `getCommunityPrices`, `getVendorScores`, `getTrends` |
| Vehicles | `getVehicles`, `createVehicle`, `getMaintenanceSchedule` |
| Account | `getUsage`, `getPlans`, `getSavings`, `getSavingsProfile` |
| Misc | `getProviders`, `joinWaitlist` |

All methods are fully typed — hover in your editor for signatures.

## Auth modes

- **`apiKey`** — for server-side code. Sent as `x-api-key`.
- **`accessToken`** — string or `() => Promise<string | null>`. Sent as
  `Authorization: Bearer <token>`. Use this for browser code with
  Clerk / Auth.js / Firebase Auth.

If both are provided the Bearer token wins.

## Support

- Docs: [faivri.com/docs](https://faivri.com/docs)
- Email: support@faivri.com

MIT © Faivri
