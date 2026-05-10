import Link from 'next/link'
import { ArrowRight, Code2, Gauge, ShieldCheck } from 'lucide-react'

const QUICKSTART = [
  {
    step: '01',
    title: 'Install the SDK',
    desc: 'Drop the typed TypeScript client into your app — one import, zero setup.',
  },
  {
    step: '02',
    title: 'Call analyze()',
    desc: 'Send the quote text, optional price, and location. Get a fair range plus evidence back.',
  },
  {
    step: '03',
    title: 'Use negotiate() output',
    desc: 'Generate scripts with target and walk-away price for real conversations.',
  },
]

export default function DocsPage() {
  return (
    <>
      <header className="mb-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          Documentation
        </p>
        <h1 className="mt-2 font-display text-[32px] font-bold leading-tight tracking-tight text-[var(--text-1)] md:text-[40px]">
          Build with Faivri
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--text-2)]">
          Practical docs for shipping, not theory. Plug in the SDK, call <code className="rounded bg-[var(--warm-bg-secondary)] px-1.5 py-0.5 font-mono text-[12px]">analyze()</code>, and start showing fair-range verdicts in your product in under five minutes.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            <span className="pulse-gentle h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
            Live schema
          </span>
          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Typed SDK
          </span>
        </div>
      </header>

      <section className="mt-10">
        <h2 id="quickstart" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          Quickstart
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          Three calls, one verdict, ready to render. The full sequence in plain TypeScript is below — read each card top-to-bottom.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {QUICKSTART.map((item) => (
            <article
              key={item.step}
              className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-4"
            >
              <p className="font-mono text-[11px] font-bold tracking-wider text-[var(--text-4)]">
                {item.step}
              </p>
              <h3 className="mt-1.5 text-[15px] font-semibold text-[var(--text-1)]">
                {item.title}
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">
                {item.desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 id="sdk-guide" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          SDK guide
        </h2>
        <p className="mt-2 text-[14px] text-[var(--text-2)]">
          The TypeScript client wraps every endpoint, surfaces typed errors, and works the
          same on the server and in the browser.
        </p>
        <article className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-5">
          <Code2 className="h-5 w-5 text-[var(--text-2)]" />
          <h3 className="mt-3 text-[16px] font-semibold text-[var(--text-1)]">
            TypeScript client
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">
            Setup, auth, analyze, negotiate, usage quotas, and error handling — everything you
            need to ship.
          </p>
          <Link
            href="/docs/sdk"
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-1)] hover:underline"
          >
            Open SDK guide
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </article>
      </section>

      <section className="mt-10">
        <h2 id="best-practices" className="font-display text-[22px] font-semibold tracking-tight text-[var(--text-1)]">
          Best practices
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <article className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-5">
            <Gauge className="h-5 w-5 text-[var(--text-2)]" />
            <h3 className="mt-3 text-[15px] font-semibold text-[var(--text-1)]">
              Production mindset
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">
              Use confidence scores and source counts before automating downstream decisions.
            </p>
          </article>
          <article className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-5">
            <ShieldCheck className="h-5 w-5 text-[var(--text-2)]" />
            <h3 className="mt-3 text-[15px] font-semibold text-[var(--text-1)]">
              Security basics
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">
              Send bearer tokens for user-scoped routes and avoid exposing private credentials in
              browsers.
            </p>
          </article>
        </div>
      </section>
    </>
  )
}
