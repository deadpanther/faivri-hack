'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import {
  AlertCircle,
  ArrowRight,
  Check,
  GraduationCap,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import AuroraBackdrop from '@/components/ui/AuroraBackdrop'
import { ApiError, api } from '@/lib/api'

type Stage = 'checking' | 'success' | 'not-eligible'

interface SuccessState {
  activeUntil: string
  discountPct: number
}

function formatActiveUntil(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function StudentForm() {
  const [stage, setStage] = useState<Stage>('checking')
  const [success, setSuccess] = useState<SuccessState | null>(null)
  // Backend's friendly reason when Clerk auto-verify fails (422). We
  // surface it verbatim on the not-eligible card so the user knows
  // exactly why their account didn't qualify.
  const [reason, setReason] = useState<string | null>(null)
  const { user } = useAuth()

  // Single check: trust whatever the user signed in with. If their
  // Clerk-verified primary email is .edu, we flip on Scholar in-place.
  // Otherwise: not eligible — no fallback form, no second-email game.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      try {
        const s = await api.studentStatus()
        if (cancelled) return
        if (s.active && s.active_until) {
          setSuccess({ activeUntil: s.active_until, discountPct: s.discount_pct })
          setStage('success')
          return
        }
      } catch {
        // Silent — fall through to verify attempt.
      }

      try {
        const r = await api.studentVerifyClerk()
        if (cancelled) return
        if (r.verified) {
          setSuccess({ activeUntil: r.active_until, discountPct: r.discount_pct })
          setStage('success')
          return
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) {
          setReason(err.message || err.rawDetail || null)
        }
      }
      if (!cancelled) setStage('not-eligible')
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  if (stage === 'checking') {
    return (
      <div
        className="flex items-center justify-center rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-10"
        role="status"
        aria-label="Checking eligibility"
      >
        <div className="h-2 w-32 animate-pulse rounded-full bg-[var(--warm-bg-tertiary)]" />
      </div>
    )
  }

  if (stage === 'success' && success) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-8 md:p-10 text-center"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--green)_15%,var(--warm-bg))] text-[var(--green)]">
          <Check className="h-7 w-7" strokeWidth={2.5} />
        </div>
        <h2 className="mt-5 font-display text-[26px] font-semibold text-[var(--text-1)]">
          You&apos;re a Faivri Scholar.
        </h2>
        <p className="mt-2 text-[15px] text-[var(--text-2)]">
          {success.discountPct}% off every paid plan, active through{' '}
          <strong className="text-[var(--text-1)]">
            {formatActiveUntil(success.activeUntil)}
          </strong>
          {' '}— about 6 months.
        </p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/pricing?scholar=1"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--text-1)] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
          >
            See Scholar pricing
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--text-2)] hover:bg-[var(--warm-bg-tertiary)]"
          >
            Back to Faivri
          </Link>
        </div>
      </motion.div>
    )
  }

  // Not eligible — final state. We don't offer a fallback form on purpose:
  // Scholar is gated to the verified school email on the user's account.
  // To qualify, the user has to add a .edu to their Clerk profile and
  // verify it; we link them to /account so Clerk's UI handles that flow.
  const accountEmail = user?.email ?? null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-8 md:p-10 text-center"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--amber)_15%,var(--warm-bg))] text-[var(--amber)]">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h2 className="mt-5 font-display text-[26px] font-semibold text-[var(--text-1)]">
        Not eligible for student offers.
      </h2>
      <p className="mt-2 text-[15px] text-[var(--text-2)]">
        {reason
          ? reason
          : 'Your account isn’t linked to a verified school email, so we can’t turn on Scholar pricing.'}
      </p>
      {accountEmail && (
        <p className="mt-2 text-[13px] text-[var(--text-3)]">
          Signed in as <span className="font-mono text-[var(--text-2)]">{accountEmail}</span>.
        </p>
      )}
      <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4 text-left text-[13.5px] text-[var(--text-2)]">
        <p className="font-semibold text-[var(--text-1)]">How to qualify</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Add your <span className="font-mono">.edu</span> address to your Faivri account.</li>
          <li>Verify it from the email Clerk sends.</li>
          <li>Come back here — Scholar pricing turns on automatically.</li>
        </ol>
      </div>
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          href="/account"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--text-1)] px-5 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
        >
          Add school email
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/pricing"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-sm font-semibold text-[var(--text-2)] hover:bg-[var(--warm-bg-tertiary)]"
        >
          Standard pricing
        </Link>
      </div>
    </motion.div>
  )
}

const PERKS = [
  {
    icon: Sparkles,
    title: '50% off every paid plan',
    body: 'Signal drops to $6.49/mo, Command to $12.49/mo — for the full semester.',
  },
  {
    icon: GraduationCap,
    title: 'No transcripts, no waiting',
    body: 'We use the .edu address already verified on your Faivri account — no extra forms.',
  },
  {
    icon: RefreshCw,
    title: 'Active for 6 months',
    body: 'Once on, Scholar pricing stays for 180 days. Re-check any time after to keep it going.',
  },
]

export default function StudentPage() {
  const { user } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState<'sign-in' | 'sign-up' | null>(null)
  return (
    <section className="ui-section pb-24">
      {showAuthModal && <AuthModal mode={showAuthModal} onClose={() => setShowAuthModal(null)} />}
      <div className="ui-container max-w-3xl">
        <header className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-12">
          <AuroraBackdrop tone="mint" />
          <div className="relative text-center">
            <p className="ui-kicker justify-center">
              <GraduationCap className="h-3.5 w-3.5" />
              Faivri Scholar
            </p>
            <h1 className="ui-title-section mt-3">Students get 50% off.</h1>
            <p className="ui-lead mt-4 mx-auto">
              If your Faivri account is signed in with a verified school email, we turn on
              Scholar pricing automatically — no codes, no paperwork.
            </p>
          </div>
        </header>

        <div className="mt-8">
          {user ? (
            <StudentForm />
          ) : (
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-8 md:p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--warm-bg-tertiary)] text-[var(--text-1)]">
                <GraduationCap className="h-6 w-6" />
              </div>
              <h2 className="mt-5 font-display text-[22px] font-semibold text-[var(--text-1)]">
                Sign in to check your eligibility.
              </h2>
              <p className="mt-2 text-[15px] text-[var(--text-2)]">
                Scholar pricing is tied to your Faivri account, so we need to know who&apos;s
                being verified.
              </p>
              <button
                onClick={() => setShowAuthModal('sign-in')}
                className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[var(--text-1)] px-6 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
              >
                Sign in to continue
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {PERKS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--warm-bg-tertiary)] text-[var(--text-1)]">
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-3 font-display text-[15px] font-semibold text-[var(--text-1)]">
                {title}
              </p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-2)]">
                {body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center text-sm text-[var(--text-3)]">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-[var(--text-1)] hover:underline"
          >
            ← Back to pricing
          </Link>
        </div>
      </div>
    </section>
  )
}
