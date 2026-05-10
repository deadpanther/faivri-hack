import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  Ban,
  FileText,
  Gavel,
  Mail,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react'
import AuroraBackdrop from '@/components/ui/AuroraBackdrop'

export const metadata = {
  title: 'Terms of Service',
  description:
    'The agreement between you and Faivri covering acceptable use, subscriptions, refunds, disclaimers, and account termination.',
}

const EFFECTIVE_DATE = 'April 23, 2026'
const CONTACT_EMAIL = 'support@faivri.com'

type Section = { id: string; label: string; icon: LucideIcon }

const SECTIONS: Section[] = [
  { id: 'accept', label: 'Acceptance', icon: FileText },
  { id: 'account', label: 'Your account', icon: Users },
  { id: 'use', label: 'Acceptable use', icon: ShieldCheck },
  { id: 'prohibited', label: 'What you may not do', icon: Ban },
  { id: 'billing', label: 'Subscriptions & billing', icon: Wallet },
  { id: 'refunds', label: 'Cancellations', icon: Sparkles },
  { id: 'content', label: 'Verdicts & accuracy', icon: Wrench },
  { id: 'ip', label: 'Intellectual property', icon: Gavel },
  { id: 'termination', label: 'Termination', icon: AlertCircle },
  { id: 'disclaimer', label: 'Disclaimers', icon: AlertCircle },
  { id: 'law', label: 'Governing law', icon: Gavel },
  { id: 'contact', label: 'Contact', icon: Mail },
]

function Card({
  id,
  icon: Icon,
  title,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
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
        <h2 className="flex-1 font-display text-[22px] font-semibold leading-tight text-[var(--text-1)] md:text-[26px]">
          {title}
        </h2>
      </div>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-[var(--text-2)]">
        {children}
      </div>
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

export default function TermsPage() {
  return (
    <section className="ui-section pb-24">
      <div className="ui-container max-w-5xl">
        <header className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-14">
          <AuroraBackdrop tone="mint" />
          <div className="relative text-center">
            <p className="ui-kicker justify-center">
              <FileText className="h-3.5 w-3.5" />
              Terms of Service
            </p>
            <h1 className="ui-title-section mt-3">The agreement, in plain English.</h1>
            <p className="ui-lead mt-4 mx-auto">
              These terms govern your use of Faivri — the web app, the browser extension, and
              our API. By using Faivri, you agree to them. If you don&apos;t, please don&apos;t use it.
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

        <div className="mt-8 space-y-5">
          <Card id="accept" icon={FileText} title="Acceptance of these terms">
            <p>
              By creating an account, installing the Faivri Chrome extension, or otherwise using
              any part of Faivri, you accept these Terms and our{' '}
              <Link href="/privacy" className="font-medium text-[var(--blue)] underline-offset-4 hover:underline">
                Privacy Policy
              </Link>
              . If you&apos;re using Faivri on behalf of a company, you represent that you have
              the authority to bind that company to these Terms.
            </p>
          </Card>

          <Card id="account" icon={Users} title="Your account">
            <Bullets
              items={[
                'You must be at least 13 years old to use Faivri.',
                'You are responsible for activity under your account — keep your login credentials safe.',
                'Provide accurate information. One person, one account.',
                'Authentication is handled by a third-party identity provider — their terms apply to the sign-in flow itself.',
              ]}
            />
          </Card>

          <Card id="use" icon={ShieldCheck} title="Acceptable use">
            <p>
              Use Faivri to check if prices you&apos;re quoted are fair. Everything else on the
              platform is built to support that — history, negotiation scripts, the browser
              extension, and paid plans. Use it the way a reasonable person would.
            </p>
          </Card>

          <Card id="prohibited" icon={Ban} title="What you may not do">
            <Bullets
              items={[
                'Scrape, rate-limit-evade, or resell the Faivri API without a written agreement.',
                'Use Faivri to harass a seller, dox a person, or automate harassment campaigns.',
                'Submit queries that contain other people\u2019s personal data you\u2019re not authorized to share.',
                'Reverse-engineer or attempt to extract model weights, prompts, or proprietary pipelines.',
                'Use the extension outside Facebook Marketplace and eBay item pages it is scoped to.',
                'Bypass paywalls, quota limits, or the abuse protections in place to keep costs sane.',
              ]}
            />
          </Card>

          <Card id="billing" icon={Wallet} title="Subscriptions & billing">
            <p>
              Scout is free — every account gets <strong>3 analyses per month</strong> at no cost.
              Paid plans (Signal and Command) and one-time Boost Packs are processed by our
              third-party payments provider. Prices, quotas, and plan contents are listed on{' '}
              <Link href="/pricing" className="font-medium text-[var(--blue)] underline-offset-4 hover:underline">
                /pricing
              </Link>
              . Subscriptions renew automatically until you cancel. Boost Packs are one-time
              purchases with no auto-renew.
            </p>
            <Bullets
              items={[
                'You authorize our payments provider to charge your payment method on each renewal.',
                'Failed payments may suspend your paid-tier access until resolved.',
                'We may change pricing with at least 14 days notice to active subscribers.',
                'Applicable sales tax or VAT is added at checkout where legally required.',
              ]}
            />
          </Card>

          <Card id="refunds" icon={Sparkles} title="Cancellations">
            <p>
              <strong>Cancel any time</strong> from your account page — no phone calls, no
              retention traps. When you cancel, your paid-plan access continues through the end
              of the billing period you&apos;ve already paid for, and then stops at the next
              renewal date. You&apos;re never charged after you cancel.
            </p>
            <p>
              <strong>All sales are final.</strong> Once a charge has been made, we don&apos;t issue
              refunds — but you keep the access you paid for through the end of that period and
              won&apos;t be billed again. Free-tier (Scout) usage is, of course, free.
            </p>
            <p className="text-[13.5px] text-[var(--text-3)]">
              Exceptions are made only where mandatory consumer-protection law in your
              jurisdiction requires it. Contact{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              if you believe that applies to you.
            </p>
          </Card>

          <Card id="content" icon={Wrench} title="Verdicts are informational, not advice">
            <p>
              Faivri synthesizes public market data and model reasoning to produce a fair-price
              estimate. It is not legal, medical, financial, or professional advice. Market
              conditions change; models make mistakes. Use Faivri as a strong signal, verify
              important purchases with a qualified professional, and treat every verdict as a
              starting point — not the final word.
            </p>
          </Card>

          <Card id="ip" icon={Gavel} title="Intellectual property">
            <p>
              Faivri, its brand, logo, design system, and software are owned by the Faivri
              team. Queries you submit remain yours; by running them through Faivri you grant us
              a limited license to process, cache, and aggregate them in the de-identified ways
              described in our Privacy Policy.
            </p>
          </Card>

          <Card id="termination" icon={AlertCircle} title="Termination">
            <p>
              You can close your account any time — settings → delete account. We may suspend
              or terminate access if you violate these Terms, especially the prohibited uses
              above, or if required by law. On termination, outstanding paid-plan access runs
              out through the current billing period unless the termination was for abuse.
            </p>
          </Card>

          <Card id="disclaimer" icon={AlertCircle} title="Disclaimers & limits">
            <p>
              Faivri is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To the maximum extent
              permitted by law, we disclaim warranties of merchantability, fitness for a particular
              purpose, and non-infringement. Our total liability for any claim relating to Faivri
              is limited to the amount you paid us in the 12 months preceding the event giving
              rise to the claim, or USD $50, whichever is greater.
            </p>
          </Card>

          <Card id="law" icon={Gavel} title="Governing law & disputes">
            <p>
              These Terms are governed by the laws of the State of Delaware, USA, without regard
              to conflict-of-law rules. Disputes will be resolved in the state or federal courts
              located in Delaware. If you&apos;re a consumer in the EU, UK, or another jurisdiction
              whose mandatory laws grant you stronger rights, those rights still apply.
            </p>
          </Card>

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
                  Questions about these Terms
                </h2>
                <p className="mt-2 text-[15px] text-[var(--text-2)]">
                  Email{' '}
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="font-semibold text-[var(--blue)] underline-offset-4 hover:underline"
                  >
                    {CONTACT_EMAIL}
                  </a>
                  . We reply within one business day for general inquiries.
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
