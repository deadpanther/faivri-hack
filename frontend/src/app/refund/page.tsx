import Link from 'next/link'
import {
  CheckCircle2,
  CircleSlash,
  Clock,
  CreditCard,
  Mail,
  Receipt,
  Sparkles,
} from 'lucide-react'
import AuroraBackdrop from '@/components/ui/AuroraBackdrop'

export const metadata = {
  title: 'Refund & Cancellation Policy',
  description:
    'How cancellations, refunds, and exceptions work for Faivri subscriptions and Boost Packs — in plain English.',
}

const EFFECTIVE_DATE = 'April 27, 2026'
const CONTACT_EMAIL = 'support@faivri.com'

function Card({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  tone?: 'green' | 'amber' | 'blue' | 'red'
  children: React.ReactNode
}) {
  const accent =
    tone === 'green'
      ? 'var(--green)'
      : tone === 'amber'
      ? 'var(--amber)'
      : tone === 'red'
      ? 'var(--red)'
      : 'var(--blue)'
  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-1)]"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            color: accent,
          }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="flex-1 font-display text-[22px] font-semibold leading-tight text-[var(--text-1)] md:text-[24px]">
          {title}
        </h2>
      </div>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-[var(--text-2)]">
        {children}
      </div>
    </section>
  )
}

export default function RefundPage() {
  return (
    <section className="ui-section pb-24">
      <div className="ui-container max-w-3xl">
        <header className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-14">
          <AuroraBackdrop tone="mint" />
          <div className="relative text-center">
            <p className="ui-kicker justify-center">
              <Receipt className="h-3.5 w-3.5" />
              Refund &amp; Cancellation Policy
            </p>
            <h1 className="ui-title-section mt-3">
              Cancel any time. Keep what you paid for through the cycle.
            </h1>
            <p className="ui-lead mt-4 mx-auto">
              No retention traps, no &quot;contact sales&quot; gauntlet. Here&apos;s exactly
              what happens when you cancel a subscription, what we do (and don&apos;t)
              refund, and how to reach a human when you need one.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-3.5 py-1.5 text-xs font-medium text-[var(--text-2)]">
              <Clock className="h-3.5 w-3.5" />
              Effective {EFFECTIVE_DATE}
            </div>
          </div>
        </header>

        <div className="mt-8 space-y-5">
          <Card icon={CheckCircle2} tone="green" title="Cancelling a subscription">
            <p>
              You can cancel any active Signal or Command subscription{' '}
              <strong>at any time</strong> from the Stripe customer portal — open it
              from the &quot;Manage billing&quot; button on{' '}
              <Link
                href="/pricing"
                className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
              >
                /pricing
              </Link>{' '}
              once you&apos;re signed in.
            </p>
            <p>
              When you cancel, your paid access continues through the end of the
              billing period you already paid for, and then stops at the next
              renewal date. You will not be charged again.
            </p>
            <p className="text-[13.5px] text-[var(--text-3)]">
              After cancellation lapses you&apos;re automatically returned to the
              free Scout tier (3 analyses / month) — no data is deleted.
            </p>
          </Card>

          <Card icon={CircleSlash} tone="amber" title="Refunds — the short version">
            <p>
              <strong>All sales are final.</strong> We do not issue refunds for
              partial-month usage, unused Boost Pack credits, or after a
              renewal has already processed. The fair-trade is straightforward:
              once you cancel you keep what you paid for through that cycle, and
              we don&apos;t bill you again.
            </p>
            <p>
              We make exceptions in two cases:
            </p>
            <ul className="space-y-2.5 pl-1">
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-3)]"
                />
                <span>
                  <strong>Duplicate or accidental charge</strong> — if you were
                  billed twice for the same period, or you bought the wrong plan
                  by mistake and contact us within 7 days, we&apos;ll refund it.
                </span>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-3)]"
                />
                <span>
                  <strong>Mandatory consumer-protection law</strong> in your
                  jurisdiction (e.g. EU/UK 14-day cooling-off period for distance
                  sales, where it applies) — if statute requires a refund, we
                  follow the statute.
                </span>
              </li>
            </ul>
          </Card>

          <Card icon={Sparkles} tone="blue" title="Boost Packs">
            <p>
              Boost Packs are one-time purchases that add 10 analyses to your
              account. They don&apos;t auto-renew and they don&apos;t expire — unused
              credits stay on your account indefinitely.
            </p>
            <p>
              Because credits don&apos;t expire and aren&apos;t time-locked,{' '}
              <strong>we don&apos;t refund Boost Pack purchases</strong> once any
              credit has been spent. If <em>none</em> of the credits in a pack
              have been used and you contact support within 7 days of purchase,
              we&apos;ll refund it.
            </p>
          </Card>

          <Card icon={CreditCard} tone="blue" title="How refunds (when issued) are processed">
            <p>
              Approved refunds are processed by Stripe back to the original
              payment method. They typically post within 5–10 business days,
              depending on your bank.
            </p>
            <p className="text-[13.5px] text-[var(--text-3)]">
              You&apos;ll receive an email confirmation once the refund is sent
              from our side. The credit appears on your statement on Stripe&apos;s
              schedule, not ours — we can&apos;t accelerate the bank-side leg.
            </p>
          </Card>

          <Card icon={Mail} tone="green" title="Talk to a human">
            <p>
              If you think one of the exceptions above applies, or you just want
              to walk through your situation with a person, email{' '}
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Refund%20request`}
                className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>{' '}
              with your account email and the date of the charge. We reply within
              one business day.
            </p>
          </Card>
        </div>

        <p className="mt-10 text-center text-[12.5px] text-[var(--text-3)]">
          This policy lives alongside our{' '}
          <Link
            href="/terms"
            className="font-medium text-[var(--text-2)] underline-offset-4 hover:underline"
          >
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link
            href="/privacy"
            className="font-medium text-[var(--text-2)] underline-offset-4 hover:underline"
          >
            Privacy Policy
          </Link>
          . When statute and policy conflict, statute wins.
        </p>
      </div>
    </section>
  )
}
