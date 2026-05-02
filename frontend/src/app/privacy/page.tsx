import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertCircle,
  Ban,
  Database,
  EyeOff,
  FileDown,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  UserRoundX,
  Users,
} from 'lucide-react'
import AuroraBackdrop from '@/components/ui/AuroraBackdrop'

export const metadata = {
  title: 'Privacy Policy',
  description:
    'What Faivri collects, how it is used, and how the Faivri browser extension handles Facebook Marketplace and eBay listing data.',
}

const EFFECTIVE_DATE = 'April 21, 2026'
const CONTACT_EMAIL = 'support@faivri.com'

type Pledge = {
  icon: LucideIcon
  title: string
  body: string
}

const PLEDGES: Pledge[] = [
  {
    icon: Ban,
    title: 'Never sold',
    body: 'Your queries, vehicles, and history are not sold, rented, or licensed to anyone.',
  },
  {
    icon: EyeOff,
    title: 'Zero ad tracking',
    body: 'No third-party cookies, no analytics fingerprinting, no advertising networks.',
  },
  {
    icon: Sparkles,
    title: 'Not used to train models',
    body: 'Our LLM providers contractually do not train on data sent through our paid API access.',
  },
  {
    icon: Trash2,
    title: 'Delete on demand',
    body: 'Wipe your history and account any time from settings — or email us and we do it.',
  },
  {
    icon: Timer,
    title: 'Auto-expiring caches',
    body: 'Market-comp caches vanish after 4 hours. Server logs rotate out after 30 days.',
  },
  {
    icon: Lock,
    title: 'Encrypted in transit',
    body: 'Every request is HTTPS. Provider API keys live as encrypted environment secrets.',
  },
]

type Section = { id: string; label: string; icon: LucideIcon }

const SECTIONS: Section[] = [
  { id: 'collect', label: 'What we collect', icon: Database },
  { id: 'never', label: "What we don't collect", icon: Ban },
  { id: 'use', label: 'How we use it', icon: Activity },
  { id: 'providers', label: 'Providers', icon: Users },
  { id: 'retention', label: 'Data retention', icon: Timer },
  { id: 'rights', label: 'Your rights', icon: FileDown },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'children', label: 'Children', icon: UserRoundX },
  { id: 'changes', label: 'Changes', icon: AlertCircle },
  { id: 'contact', label: 'Contact', icon: Mail },
]

function PolicyCard({
  id,
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 md:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--warm-bg-tertiary)] text-[var(--text-1)]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-semibold leading-tight text-[var(--text-1)] md:text-[26px]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-[var(--text-3)]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-5 text-[15px] leading-relaxed text-[var(--text-2)]">{children}</div>
    </section>
  )
}

function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-3)]"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
      {children}
    </h3>
  )
}

export default function PrivacyPage() {
  return (
    <section className="ui-section pb-24">
      <div className="ui-container max-w-5xl">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-14">
          <AuroraBackdrop tone="mint" />
          <div className="relative text-center">
            <p className="ui-kicker justify-center">
              <ShieldCheck className="h-3.5 w-3.5" />
              Privacy
            </p>
            <h1 className="ui-title-section mt-3">Your data, your rules.</h1>
            <p className="ui-lead mt-4 mx-auto">
              We collect the minimum needed to answer &ldquo;is this price fair?&rdquo; — nothing
              more. No ads, no brokers, no hidden models learning from your queries.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-3.5 py-1.5 text-xs font-medium text-[var(--text-2)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--green)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--green)]" />
              </span>
              Effective {EFFECTIVE_DATE}
            </div>
          </div>
        </header>

        {/* Pledges */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLEDGES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-5 transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--warm-bg-tertiary)]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--warm-bg-tertiary)] text-[var(--text-1)] group-hover:bg-white">
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <p className="font-display text-[15px] font-semibold text-[var(--text-1)]">
                  {title}
                </p>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--text-2)]">{body}</p>
            </div>
          ))}
        </div>

        {/* Jump nav */}
        <nav
          aria-label="Sections"
          className="mt-10 flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-3"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border)] hover:bg-[var(--warm-bg-tertiary)] hover:text-[var(--text-1)]"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </a>
          ))}
        </nav>

        {/* Policy sections */}
        <div className="mt-8 space-y-5">
          <PolicyCard
            id="collect"
            icon={Database}
            title="What we collect"
            subtitle="Only what's needed to run the check — split by surface."
          >
            <SubHeading>On faivri.com</SubHeading>
            <div className="mt-3">
              <Bullets
                items={[
                  <>
                    <strong>Account data</strong> — handled by our authentication provider. We
                    receive only an opaque user identifier; your email and password never touch
                    our servers.
                  </>,
                  <>
                    <strong>Queries you run</strong> — your quote/listing text, optional price,
                    optional city/country, and the computed verdict. Stored so you can see history
                    and lifetime savings.
                  </>,
                  <>
                    <strong>Vehicle profiles</strong> — make, model, year, mileage, optional
                    nickname. Used only to personalize your maintenance schedule.
                  </>,
                  <>
                    <strong>Feedback</strong> — the final price you actually paid. Aggregated
                    (de-identified) into a community price signal so later users get sharper
                    fair-range estimates.
                  </>,
                ]}
              />
            </div>
            <SubHeading>In the browser extension</SubHeading>
            <div className="mt-3">
              <Bullets
                items={[
                  <>
                    <strong>Listing data on the page you&apos;re viewing</strong> — just the title
                    and asking price on Marketplace or eBay item pages. Sent to our backend for
                    live market comps.
                  </>,
                  <>
                    <strong>Nothing from other sites</strong> — the extension runs only on{' '}
                    <code className="rounded bg-[var(--warm-bg-tertiary)] px-1.5 py-0.5 text-[12.5px]">
                      facebook.com/marketplace/*
                    </code>{' '}
                    and{' '}
                    <code className="rounded bg-[var(--warm-bg-tertiary)] px-1.5 py-0.5 text-[12.5px]">
                      ebay.com/itm/*
                    </code>
                    . It cannot read your feed, messages, friends list, or any other page content.
                  </>,
                  <>
                    <strong>Local preferences</strong> — your optional custom backend URL lives in{' '}
                    <code className="rounded bg-[var(--warm-bg-tertiary)] px-1.5 py-0.5 text-[12.5px]">
                      chrome.storage.sync
                    </code>{' '}
                    on your device. We never receive it.
                  </>,
                ]}
              />
            </div>
          </PolicyCard>

          <PolicyCard id="never" icon={Ban} title="What we don't collect">
            <Bullets
              items={[
                'No browsing history outside the two supported listing URL patterns.',
                'No keystrokes, no clipboard contents, no screen captures.',
                'No payment or credit card data (billing provider handles it end-to-end).',
                'No advertising, no third-party tracking cookies, no cross-site pixels.',
              ]}
            />
          </PolicyCard>

          <PolicyCard id="use" icon={Activity} title="How we use it">
            <Bullets
              items={[
                'To compute the fair-price verdict for the query you just ran.',
                'To show your own history and lifetime savings on your account page.',
                'To sharpen fair-price estimates: 4-hour market-baseline cache + de-identified community feedback aggregates.',
                'To detect abuse (rate limiting) and debug errors. Logs redact request bodies and account identifiers.',
              ]}
            />
          </PolicyCard>

          <PolicyCard
            id="providers"
            icon={Users}
            title="Categories of processors"
            subtitle="Vetted providers act on our behalf to deliver Faivri — never for their own use. We disclose categories rather than vendor names so we can swap providers as we scale without re-issuing this policy."
          >
            <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
              <table className="w-full text-[14px]">
                <thead className="bg-[var(--warm-bg-tertiary)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--text-3)]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Category</th>
                    <th className="px-4 py-2.5 font-semibold">What they do for us</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] bg-[var(--warm-bg)]">
                  {[
                    ['Authentication', 'User sign-in, accounts, and session management.'],
                    ['Hosting & databases', 'Compute and storage for the backend service.'],
                    ['Cache layer', 'Short-lived (4-hour) market-baseline cache.'],
                    ['LLM inference', 'Generates the verdict from your query. Contractually never used to train their models.'],
                    ['Live web search', 'Pulls retail and sold-listing prices used as evidence.'],
                    ['Listing extraction (Firecrawl)', 'Firecrawl pulls structured data from the specific listing URL you view (Extension Pro only). The URL — and only the URL — is sent.'],
                    ['Frontend hosting', 'Serves the web app to your browser.'],
                    ['Payments', 'Processes paid-plan purchases — only if you buy one.'],
                  ].map(([name, desc]) => (
                    <tr key={name}>
                      <td className="px-4 py-3 font-semibold text-[var(--text-1)]">{name}</td>
                      <td className="px-4 py-3 text-[var(--text-2)]">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[13.5px] text-[var(--text-3)]">
              We&apos;ll disclose a specific vendor on request via{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              when required for a GDPR/CCPA data-subject request.
            </p>
          </PolicyCard>

          <PolicyCard
            id="retention"
            icon={Timer}
            title="Data retention"
            subtitle="What we keep, how long, and when it auto-expires."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  label: 'Query history',
                  value: 'Kept until you delete it',
                  foot: 'One-click wipe from your account page.',
                  tone: 'var(--blue)',
                },
                {
                  label: 'Community price aggregates',
                  value: 'Indefinite — de-identified',
                  foot: 'Contains no user ID, no query text, no location.',
                  tone: 'var(--green)',
                },
                {
                  label: 'Market-baseline cache',
                  value: 'Auto-expires after 4 hours',
                  foot: 'Refreshed on next matching query.',
                  tone: 'var(--amber)',
                },
                {
                  label: 'Server logs',
                  value: 'Rotated out after 30 days',
                  foot: 'Request bodies and user IDs redacted before write.',
                  tone: 'var(--purple)',
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ background: row.tone }}
                    />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                      {row.label}
                    </p>
                  </div>
                  <p className="mt-2 font-display text-[17px] font-semibold text-[var(--text-1)]">
                    {row.value}
                  </p>
                  <p className="mt-1 text-[13px] text-[var(--text-2)]">{row.foot}</p>
                </div>
              ))}
            </div>
          </PolicyCard>

          <PolicyCard
            id="rights"
            icon={FileDown}
            title="Your rights"
            subtitle="Regardless of where you live."
          >
            <Bullets
              items={[
                'Request a copy of the data we hold about you.',
                'Request deletion of your account and the queries tied to it.',
                'Opt out of community-price contributions by not submitting feedback.',
              ]}
            />
            <p className="mt-5">
              Email{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
              . We respond within 30 days. GDPR and CCPA requests go through the same address.
            </p>
          </PolicyCard>

          <PolicyCard id="security" icon={Lock} title="Security">
            <p>
              Every request to our backend is HTTPS. Faivri never stores passwords — our
              authentication provider handles them. The database lives on a private network,
              unreachable from the public internet. Provider API keys are stored as encrypted
              environment secrets.
            </p>
          </PolicyCard>

          <PolicyCard id="children" icon={UserRoundX} title="Children">
            <p>
              Faivri is not directed at children under 13. We do not knowingly collect personal
              information from children. If you believe we have, email the address above and we
              will delete it.
            </p>
          </PolicyCard>

          <PolicyCard id="changes" icon={AlertCircle} title="Changes to this policy">
            <p>
              Material changes bump the effective date at the top of this page, and signed-in
              users see an in-app notice. Continuing to use Faivri after a change means you accept
              the updated policy.
            </p>
          </PolicyCard>

          <section
            id="contact"
            className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-6 md:p-8"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[var(--text-1)]">
                <Mail className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="font-display text-[22px] font-semibold leading-tight text-[var(--text-1)] md:text-[26px]">
                  Questions, data requests, or complaints
                </h2>
                <p className="mt-2 text-[15px] text-[var(--text-2)]">
                  Reach us at{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="font-semibold text-[var(--blue)] underline-offset-4 hover:underline"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  . We reply within one business day for general inquiries and 30 days for formal
                  data requests.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-12 text-center text-sm text-[var(--text-3)]">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-[var(--text-1)] hover:underline"
          >
            ← Back to Faivri
          </Link>
        </div>
      </div>
    </section>
  )
}
