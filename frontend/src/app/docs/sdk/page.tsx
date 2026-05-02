import { Box, ShieldCheck, Workflow, Gauge, Users, Car, Sparkles } from 'lucide-react'

const installSnippet = `// Browser (Next.js client component)
import { createFaivriClient } from 'faivri'

const faivri = createFaivriClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
  accessToken: async () => await clerk.session?.getToken() ?? null,
})`

const analyzeSnippet = `const verdict = await faivri.analyze({
  query: 'Front brake pads + rotor quote',
  domain: 'auto',
  quoted_price: 740,
  city: 'Los Angeles',
  country: 'US',
})

if (verdict.expected_overpay > 0) {
  const scripts = await faivri.negotiate(verdict.id)
  console.log(scripts.target_price, scripts.scripts)
}

// Follow up after the conversation
await faivri.feedback({
  query_id: verdict.id,
  final_price: 540,
  outcome: 'accepted',
})`

const usageSnippet = `// Before enabling the analyze button, check remaining quota
const { plan, limit, remaining, reset_at, unlimited } = await faivri.getUsage()

if (!unlimited && remaining === 0) {
  // Show the upgrade modal — quota resets on \${reset_at}
}

// For rendering the pricing page
const catalog = await faivri.getPlans()
// [{ key: 'scout', monthly_limit: 3, unlimited: false }, ...]`

const errorSnippet = `import { FaivriError } from 'faivri'

try {
  await faivri.analyze({ query: 'MRI cost' })
} catch (err) {
  if (err instanceof FaivriError) {
    if (err.status === 402) {
      // Quota exhausted; err.body.plan + err.body.reset_at are populated
      showUpgradeModal(err.body)
    } else if (err.status === 429) {
      // Rate limited (IP cap or per-minute)
      showRetryToast()
    } else {
      showError(err.message)
    }
  }
}`

const serverSnippet = `// Server / edge function — no Clerk, use a server key
import { FaivriClient } from 'faivri'

const client = new FaivriClient({
  baseUrl: process.env.FAIVRI_API_URL,
  apiKey: process.env.FAIVRI_API_KEY,
})

const [history, savings, usage] = await Promise.all([
  client.getHistory(1, 10),
  client.getSavingsProfile(),
  client.getUsage(),
])`

const METHODS = [
  {
    group: 'Analyze',
    icon: Workflow,
    rows: [
      ['analyze(input)', 'Text quote → verdict'],
      ['analyzeImage(file, opts)', 'OCR an invoice photo'],
      ['analyzeVoice(blob, opts)', 'Transcribe + analyze'],
      ['analyzePurchase(input)', 'Used-vehicle deal check'],
      ['getPurchaseAnalysis(id)', 'Re-fetch a purchase verdict'],
    ],
  },
  {
    group: 'Negotiate',
    icon: Box,
    rows: [
      ['negotiate(queryId)', 'Target price + scripts'],
      ['counterOffer(input)', 'Respond to vendor pushback'],
      ['feedback(input)', 'Log final outcome'],
    ],
  },
  {
    group: 'History',
    icon: ShieldCheck,
    rows: [
      ['getHistory(page, limit)', 'Your past verdicts'],
      ['getVerdict(id) / deleteVerdict(id)', 'Re-open or remove one'],
      ['purgeHistory()', 'Wipe all verdicts'],
      ['getRecommendations(queryId)', 'Next-step suggestions'],
    ],
  },
  {
    group: 'Community',
    icon: Users,
    rows: [
      ['getCommunityPrices(domain)', 'Shared pricing signals'],
      ['getVendorScores(domain)', 'Vendor fairness scores'],
      ['getTrends(domain)', 'Category trendlines'],
    ],
  },
  {
    group: 'Vehicles',
    icon: Car,
    rows: [
      ['getVehicles()', 'Saved vehicles on file'],
      ['createVehicle(input)', 'Add a vehicle to the garage'],
      ['getMaintenanceSchedule(id)', 'Upcoming service intervals'],
    ],
  },
  {
    group: 'Account',
    icon: Gauge,
    rows: [
      ['getUsage()', 'Plan + monthly remaining'],
      ['getPlans()', 'Public plan catalog'],
      ['getSavings() / getSavingsProfile()', 'Lifetime savings'],
    ],
  },
  {
    group: 'Misc',
    icon: Sparkles,
    rows: [
      ['getProviders()', 'LLM provider matrix'],
      ['joinWaitlist(email, source?)', 'Add email to waitlist'],
    ],
  },
] as const

const codeBlock =
  'mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4 text-[12px] leading-relaxed text-[var(--text-2)]'

const inlineCode =
  'rounded bg-[var(--warm-bg-secondary)] px-1.5 py-0.5 text-[11px] font-mono'

export default function SdkDocsPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          SDK guide
        </p>
        <h1 className="mt-2 font-display text-[32px] font-bold leading-tight tracking-tight text-[var(--text-1)] md:text-[40px]">
          TypeScript client
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--text-2)]">
          A single typed client for the full Faivri surface — analyze, negotiate, history,
          community intel, quota, and billing. Works the same in the browser and on the
          server; swap between a Clerk JWT and a server API key.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            <span className="pulse-gentle h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
            Typed methods
          </span>
          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Browser + server
          </span>
        </div>
      </header>

      <section className="mt-10">
        <h2 id="install" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          1. Install
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Typed SDK — zero runtime deps, ships ESM + CJS + <code className={inlineCode}>.d.ts</code>.
        </p>
        <pre className={codeBlock}>
          <code>npm install faivri</code>
        </pre>

        <h2 id="create-client" className="mt-10 font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          2. Create the client
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Wire once, call anywhere. The accessToken getter is awaited on every request,
          so rotating Clerk JWTs just work.
        </p>
        <pre className={codeBlock}>
          <code>{installSnippet}</code>
        </pre>
      </section>

      <section className="mt-10">
        <h2 id="analyze-negotiate" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          3. Analyze → negotiate → feedback
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          The core flow. Every verdict carries a stable id you pass into the negotiate call to
          get a target price and ready-to-send scripts.
        </p>
        <pre className={codeBlock}>
          <code>{analyzeSnippet}</code>
        </pre>
      </section>

      <section className="mt-10">
        <h2 id="quota" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          4. Check quota before you render the UI
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          The backend enforces plan limits server-side. Call <code className={inlineCode}>getUsage()</code>{' '}
          on page mount to disable the submit button before the user hits 402.
        </p>
        <pre className={codeBlock}>
          <code>{usageSnippet}</code>
        </pre>
      </section>

      <section className="mt-10">
        <h2 id="errors" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          5. Typed error handling
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Every non-2xx throws a <code className={inlineCode}>FaivriError</code> with{' '}
          <code className={inlineCode}>status</code> and <code className={inlineCode}>body</code>{' '}
          preserved. Branch on 402 for quota, 429 for rate-limit, render the server message otherwise.
        </p>
        <pre className={codeBlock}>
          <code>{errorSnippet}</code>
        </pre>
      </section>

      <section className="mt-10">
        <h2 id="server" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          6. Server-side usage
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Skip Clerk, pass an API key instead. Useful for cron jobs, webhooks, and edge
          functions that reconcile verdicts with your own data.
        </p>
        <pre className={codeBlock}>
          <code>{serverSnippet}</code>
        </pre>
      </section>

      <section className="mt-14">
        <h2 id="method-reference" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          Method reference
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Every endpoint on the Faivri REST API, typed and callable.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {METHODS.map((block) => {
            const Icon = block.icon
            return (
              <article
                key={block.group}
                className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)]">
                    <Icon className="h-[18px] w-[18px] text-[var(--text-2)]" />
                  </div>
                  <h3 className="font-display text-[15px] font-semibold text-[var(--text-1)]">
                    {block.group}
                  </h3>
                </div>
                <ul className="mt-4 space-y-2">
                  {block.rows.map(([method, desc]) => (
                    <li
                      key={method}
                      className="flex items-start justify-between gap-4 text-[13px]"
                    >
                      <code className="rounded bg-[var(--warm-bg-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-2)]">
                        {method}
                      </code>
                      <span className="text-right text-[var(--text-3)]">{desc}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}
