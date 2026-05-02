'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  GraduationCap,
  Loader2,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Star,
  TimerReset,
} from 'lucide-react'
import AuroraBackdrop from '@/components/ui/AuroraBackdrop'
import {
  api,
  ApiError,
  type BillingStatusData,
  type ProrationPreviewData,
  type StripePriceKey,
} from '@/lib/api'
import { CHROME_EXTENSION_URL } from '@/lib/constants'

type BillingCycle = 'monthly' | 'yearly'

interface Plan {
  id: string
  name: string
  blurb: string
  cta: string
  href: string
  highlight?: boolean
  popular?: boolean
  monthlyCents: number
  features: string[]
}

const PLANS: Plan[] = [
  {
    id: 'scout',
    name: 'Scout',
    blurb: 'Quick checks for occasional quotes.',
    cta: 'Start Free',
    href: '/sign-up',
    monthlyCents: 0,
    features: [
      '3 analyses per month',
      'Text, image, PDF, and voice input',
      'Negotiation scripts',
    ],
  },
  {
    id: 'signal',
    name: 'Signal',
    blurb: 'Steady checking for every quote that matters.',
    cta: 'Choose Signal',
    href: '/sign-up',
    monthlyCents: 1299,
    highlight: true,
    popular: true,
    features: [
      '20 analyses per month',
      'Chrome Extension included',
      'Live evidence refresh',
      'Full history and exports',
    ],
  },
  {
    id: 'command',
    name: 'Command',
    blurb: 'Unlimited checks for power users.',
    cta: 'Choose Command',
    href: '/sign-up',
    monthlyCents: 2499,
    features: [
      'Unlimited analyses',
      'Chrome Extension included',
      'API access with typed SDK',
      'Priority support',
    ],
  },
]

const TRUST_SIGNALS = [
  { icon: ShieldCheck, label: 'Secure checkout' },
  { icon: TimerReset, label: 'Cancel anytime' },
  { icon: Sparkles, label: 'Instant setup' },
]

const LIVE_PRICING_FEED = [
  { text: 'Signal chosen 2m ago' },
  { text: 'Scholar verified 5m ago' },
]

const SCHOLAR_DISCOUNT = 0.5

const BOOST_PRICE_CENTS = 499
const BOOST_CREDITS = 10

function centsToUSD(cents: number): string {
  if (cents === 0) return '$0'
  return `$${(cents / 100).toFixed(2)}`
}

type PendingAction =
  | { kind: 'checkout'; key: StripePriceKey }
  | { kind: 'change'; key: StripePriceKey }
  | { kind: 'preview'; key: StripePriceKey }
  | { kind: 'cancel' }
  | { kind: 'resume' }

function pendingMatches(p: PendingAction | null, key: StripePriceKey): boolean {
  return (
    !!p &&
    (p.kind === 'checkout' || p.kind === 'change' || p.kind === 'preview') &&
    p.key === key
  )
}

interface ProrationModalState {
  priceKey: StripePriceKey
  planName: string
  interval: 'monthly' | 'yearly' | null
  preview: ProrationPreviewData
}

function formatMoney(cents: number, currency: string): string {
  const amount = Math.abs(cents) / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase() || 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `$${amount.toFixed(2)}`
  }
}

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingCycle>('monthly')
  const [scholar, setScholar] = useState<boolean>(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [billingStatus, setBillingStatus] = useState<BillingStatusData | null>(null)
  const [confirmDowngrade, setConfirmDowngrade] = useState<StripePriceKey | null>(null)
  const [proration, setProration] = useState<ProrationModalState | null>(null)
  const router = useRouter()
  const { isSignedIn, isLoaded: clerkLoaded } = useUser()

  // Hydrate the user's current subscription so we can badge their plan
  // and switch CTAs to upgrade/downgrade/cancel/resume. Anonymous users
  // skip this — they'll land on sign-up before any billing call.
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn) return
    let cancelled = false
    const load = async () => {
      try {
        const status = await api.getBillingStatus()
        if (!cancelled) setBillingStatus(status)
      } catch {
        // Best-effort — falling back to "no current plan" UI is fine.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [clerkLoaded, isSignedIn])

  // Checkout redirects to Stripe via window.location. If the user hits
  // browser-Back, the page may restore from bfcache with `pending` still
  // set — leaving the CTA stuck on "Redirecting…". Clear any in-flight
  // checkout pending whenever the tab becomes visible again.
  useEffect(() => {
    const reset = () => setPending((p) => (p?.kind === 'checkout' ? null : p))
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) reset()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') reset()
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const refreshStatus = async () => {
    try {
      const status = await api.getBillingStatus()
      setBillingStatus(status)
    } catch {
      /* swallow — UI will retry on next interaction */
    }
  }

  const planPriceKey = (planId: string): StripePriceKey | null => {
    if (planId === 'scout') return null
    if (planId !== 'signal' && planId !== 'command') return null
    const cycle = billing === 'monthly' ? 'monthly' : 'yearly'
    const tag = scholar ? 'scholar_' : ''
    return `${planId}_${tag}${cycle}` as StripePriceKey
  }

  const currentPriceKey = billingStatus?.has_active_subscription
    ? billingStatus.price_key
    : null
  const currentPlan = billingStatus?.has_active_subscription
    ? billingStatus.plan
    : null
  const cancelScheduled = !!billingStatus?.cancel_at_period_end
  const periodEndLabel = useMemo(() => {
    if (!billingStatus?.current_period_end) return null
    try {
      return new Date(billingStatus.current_period_end).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return null
    }
  }, [billingStatus?.current_period_end])

  const launchCheckout = async (priceKey: StripePriceKey) => {
    setErrorMessage(null)
    if (!clerkLoaded) return
    if (!isSignedIn) {
      router.push(`/sign-up?next=${encodeURIComponent('/pricing')}`)
      return
    }
    setPending({ kind: 'checkout', key: priceKey })
    try {
      const { url } = await api.createCheckoutSession(priceKey)
      if (url) {
        window.location.href = url
        return
      }
      throw new Error('Stripe did not return a checkout URL.')
    } catch (err) {
      const friendly = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not start checkout. Please try again.'
      setErrorMessage(friendly)
      setPending(null)
    }
  }

  const planLabelFromKey = (key: StripePriceKey): string => {
    if (key.startsWith('signal')) return 'Signal'
    if (key.startsWith('command')) return 'Command'
    return 'plan'
  }

  // Two-step switch: fetch Stripe's prorated preview, show the modal,
  // then commit on confirm. The preview call doesn't modify the sub —
  // the user can dismiss the modal without being charged.
  const handleChangePlan = async (priceKey: StripePriceKey) => {
    setErrorMessage(null)
    setPending({ kind: 'preview', key: priceKey })
    try {
      const preview = await api.previewChangePlan(priceKey)
      setProration({
        priceKey,
        planName: planLabelFromKey(priceKey),
        interval: priceKey.endsWith('yearly') ? 'yearly' : 'monthly',
        preview,
      })
    } catch (err) {
      const friendly = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not preview the switch. Please try again.'
      setErrorMessage(friendly)
    } finally {
      setPending(null)
    }
  }

  // Two paths to confirm the switch:
  // - Scholar prices share a Stripe product with their non-Scholar siblings
  //   at the same interval+currency, so the Customer Portal config can't
  //   list both. For those, commit silently via /change-plan — the modal
  //   the user already saw IS the confirmation.
  // - Everything else hands off to Stripe's hosted Billing Portal so Stripe
  //   shows its own prorated breakdown, handles SCA/3DS if needed, and our
  //   webhook syncs the plan back on completion.
  const confirmProrationSwitch = async () => {
    if (!proration) return
    setErrorMessage(null)
    setPending({ kind: 'change', key: proration.priceKey })
    const isScholarSwitch = proration.priceKey.includes('scholar')
    try {
      if (isScholarSwitch) {
        await api.changePlan(proration.priceKey)
        await refreshStatus()
        setProration(null)
        setPending(null)
        return
      }
      const { url } = await api.createPortalUpdateSession(proration.priceKey)
      if (!url) throw new Error('Stripe did not return a portal URL.')
      window.location.href = url
    } catch (err) {
      const friendly = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not confirm the switch. Please try again.'
      setErrorMessage(friendly)
      setPending(null)
    }
  }

  const handleCancel = async () => {
    setErrorMessage(null)
    setPending({ kind: 'cancel' })
    try {
      await api.cancelSubscription()
      await refreshStatus()
    } catch (err) {
      const friendly = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not cancel. Please try again.'
      setErrorMessage(friendly)
    } finally {
      setPending(null)
      setConfirmDowngrade(null)
    }
  }

  const handleResume = async () => {
    setErrorMessage(null)
    setPending({ kind: 'resume' })
    try {
      await api.resumeSubscription()
      await refreshStatus()
    } catch (err) {
      const friendly = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Could not resume. Please try again.'
      setErrorMessage(friendly)
    } finally {
      setPending(null)
    }
  }

  const priceMeta = useMemo(() => {
    return PLANS.map((plan) => {
      const isFree = plan.monthlyCents === 0
      const effectiveMonthlyCents = scholar && !isFree
        ? Math.round(plan.monthlyCents * (1 - SCHOLAR_DISCOUNT))
        : plan.monthlyCents
      const yearlyCents = effectiveMonthlyCents * 10 // 2 months free
      const shownCents = billing === 'monthly' ? effectiveMonthlyCents : yearlyCents
      const originalShownCents = billing === 'monthly' ? plan.monthlyCents : plan.monthlyCents * 10

      let footnote = ''
      if (isFree) footnote = 'Free forever'
      else if (scholar) footnote = `50% student price · was ${centsToUSD(originalShownCents)}`
      else if (billing === 'monthly') footnote = 'Billed monthly'
      else footnote = `Effective ${centsToUSD(Math.round(yearlyCents / 12))}/mo`

      const yearlySavingsCents = effectiveMonthlyCents * 2
      const showSavings = billing === 'yearly' && yearlySavingsCents > 0

      return {
        id: plan.id,
        amount: isFree ? 'Free' : centsToUSD(shownCents),
        cadence: isFree ? '' : billing === 'monthly' ? '/month' : '/year',
        footnote,
        savings: showSavings ? `Save ${centsToUSD(yearlySavingsCents)}/yr` : null,
        strikethrough: scholar && !isFree ? centsToUSD(originalShownCents) : null,
      }
    })
  }, [billing, scholar])

  return (
    <section className="ui-section pb-20">
      <div className="ui-container max-w-6xl">
        <header className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 text-center md:p-8">
          <AuroraBackdrop tone="cool" />
          <div className="relative">
            <h1 className="ui-title-section mt-1">Pricing that scales with you</h1>
            <p className="ui-lead mt-3 mx-auto text-center">
              Start light, grow with confidence, and unlock deeper intelligence when you need it.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-1">
                {(['monthly', 'yearly'] as BillingCycle[]).map((cycle) => {
                  const active = billing === cycle
                  return (
                    <button
                      key={cycle}
                      type="button"
                      onClick={() => setBilling(cycle)}
                      className={`relative rounded-full px-4 py-1.5 text-[var(--type-13)] font-semibold transition-colors ${
                        active ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="billing-pill"
                          className="absolute inset-0 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] shadow-[var(--shadow-sm)]"
                        />
                      )}
                      <span className="relative z-10">
                        {cycle === 'monthly' ? 'Monthly' : 'Yearly · save 2 months'}
                      </span>
                    </button>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => setScholar((s) => !s)}
                aria-pressed={scholar}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[var(--type-13)] font-semibold transition-colors ${
                  scholar
                    ? 'border-[var(--amber)] bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] text-[var(--amber)]'
                    : 'border-[var(--border)] bg-[var(--warm-bg-secondary)] text-[var(--text-2)] hover:border-[var(--border-strong)]'
                }`}
              >
                <GraduationCap className="h-4 w-4" />
                {scholar ? 'Scholar pricing on · 50% off' : 'I’m a student — unlock 50%'}
              </button>
            </div>
            {scholar && (
              <p className="mt-3 text-[11px] text-[var(--text-3)]">
                <Link
                  href="/student"
                  className="font-semibold text-[var(--amber)] underline-offset-4 hover:underline"
                >
                  Verify your .edu email
                </Link>{' '}
                to lock in this price for the semester.
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {TRUST_SIGNALS.map((item) => {
                const Icon = item.icon
                return (
                  <span
                    key={item.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                )
              })}
            </div>

            {LIVE_PRICING_FEED.map((chip, idx) => (
              <motion.div
                key={chip.text}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: [0, -4, 0] }}
                transition={{ duration: 4.5 + idx, delay: idx * 0.2, repeat: Infinity, ease: 'easeInOut' }}
                className={`absolute top-2 hidden rounded-full border border-[var(--border)] bg-[var(--warm-bg)] px-3 py-1 text-[11px] font-medium text-[var(--text-3)] motion-reduce:animate-none lg:block ${
                  idx === 0 ? 'left-2' : 'right-2'
                }`}
              >
                {chip.text}
              </motion.div>
            ))}
          </div>
        </header>

        {currentPlan && currentPlan !== 'scout' && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-3 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 text-[var(--type-14)] text-[var(--text-2)]">
              <ShieldCheck className="h-4 w-4 text-[var(--green)]" />
              <span>
                You’re on{' '}
                <span className="font-semibold text-[var(--text-1)]">
                  {currentPlan === 'signal' ? 'Signal' : 'Command'}
                </span>
                {billingStatus?.interval ? ` (${billingStatus.interval})` : ''}
                {cancelScheduled && periodEndLabel
                  ? ` — cancels ${periodEndLabel}`
                  : ''}
                .
              </span>
            </div>
            {billingStatus?.has_billing_history && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { url } = await api.createPortalSession()
                    if (url) window.location.href = url
                  } catch (err) {
                    setErrorMessage(
                      err instanceof ApiError ? err.message : 'Could not open billing portal.',
                    )
                  }
                }}
                className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] hover:text-[var(--text-1)]"
              >
                Manage billing →
              </button>
            )}
          </div>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan, idx) => {
            const meta = priceMeta.find((p) => p.id === plan.id)!
            return (
              <motion.article
                key={plan.id}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.35, delay: idx * 0.05 }}
                whileHover={{ y: -6, boxShadow: '0 18px 38px -18px rgba(15, 23, 42, 0.18)' }}
                className={`group relative flex h-full flex-col rounded-2xl border p-6 transition-colors ${
                  plan.highlight
                    ? 'border-[var(--amber)] bg-[var(--warm-bg)] shadow-[var(--shadow-md)]'
                    : 'border-[var(--border)] bg-[var(--warm-bg)] shadow-[var(--shadow-sm)] hover:border-[var(--border-strong)]'
                }`}
              >
                {plan.popular && (
                  <span className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full border border-[var(--amber)] bg-[var(--amber)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[var(--shadow-sm)]">
                    <Star className="h-3 w-3 fill-white" />
                    Most Popular
                  </span>
                )}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[var(--type-12)] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">
                    {plan.name}
                  </p>
                </div>

                <div className="mt-3">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${plan.id}-${billing}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="flex items-end gap-2">
                        <p className="font-display text-[clamp(2rem,5vw,2.5rem)] font-bold text-[var(--text-1)]">{meta.amount}</p>
                        {meta.cadence && (
                          <p className="pb-1 text-[var(--type-14)] text-[var(--text-3)]">{meta.cadence}</p>
                        )}
                        {meta.strikethrough && (
                          <p className="pb-1 text-[var(--type-13)] text-[var(--text-4)] line-through">
                            {meta.strikethrough}
                          </p>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-4)]">{meta.footnote}</p>
                      {meta.savings && (
                        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-[var(--green)] bg-[color-mix(in_srgb,var(--green)_10%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--green)]">
                          <Sparkles className="h-3 w-3" />
                          {meta.savings}
                        </span>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <p className="mt-3 min-h-[44px] text-[var(--type-14)] text-[var(--text-3)]">{plan.blurb}</p>

                <ul className="mt-5 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-2)]">
                      <Check className="mt-0.5 h-4 w-4 text-[var(--green)]" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {(() => {
                  const priceKey = planPriceKey(plan.id)
                  const isThisCurrentPlan = currentPlan === plan.id
                  const isExactMatch = priceKey !== null && currentPriceKey === priceKey
                  const isLoading = priceKey !== null && pendingMatches(pending, priceKey)
                  const anyPending = pending !== null
                  const sharedClasses = `mt-6 inline-flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-[var(--type-14)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    plan.highlight
                      ? 'bg-[var(--text-1)] text-white hover:bg-black'
                      : 'border border-[var(--border)] text-[var(--text-1)] hover:bg-[var(--warm-bg-secondary)]'
                  }`

                  // Free Scout tile — shown for reference only. Paid users can't
                  // "downgrade" to free directly; they cancel from their current
                  // plan tile, which sets cancel_at_period_end and drops them to
                  // Scout when the cycle ends.
                  if (priceKey === null) {
                    if (isSignedIn && currentPlan && currentPlan !== 'scout') {
                      return (
                        <button
                          type="button"
                          disabled
                          className={`${sharedClasses} bg-[var(--warm-bg-secondary)] text-[var(--text-3)]`}
                        >
                          {cancelScheduled
                            ? `Drops to Scout ${periodEndLabel ?? 'at renewal'}`
                            : 'Cancel current plan to revert'}
                        </button>
                      )
                    }
                    if (isSignedIn && currentPlan === 'scout') {
                      return (
                        <button
                          type="button"
                          disabled
                          className={`${sharedClasses} bg-[var(--warm-bg-secondary)] text-[var(--text-3)]`}
                        >
                          Your current plan
                          <Check className="h-4 w-4" />
                        </button>
                      )
                    }
                    return (
                      <Link href={plan.href} className={sharedClasses}>
                        {plan.cta}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )
                  }

                  // Paid plan tile, currently active for this user (same price key)
                  if (isExactMatch) {
                    return (
                      <div className="mt-6 flex flex-col gap-2">
                        <button
                          type="button"
                          disabled
                          className={`${sharedClasses} mt-0 bg-[var(--warm-bg-secondary)] text-[var(--text-3)]`}
                        >
                          Your current plan
                          <Check className="h-4 w-4" />
                        </button>
                        {cancelScheduled ? (
                          <button
                            type="button"
                            onClick={handleResume}
                            disabled={pending?.kind === 'resume'}
                            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[var(--green)] px-3 py-1.5 text-[var(--type-13)] font-semibold text-[var(--green)] hover:bg-[color-mix(in_srgb,var(--green)_8%,transparent)] disabled:opacity-60"
                          >
                            {pending?.kind === 'resume' ? 'Resuming…' : `Resume — cancels ${periodEndLabel ?? 'soon'}`}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDowngrade(priceKey)}
                            disabled={anyPending}
                            className="inline-flex w-fit items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)] hover:text-[var(--text-2)] disabled:opacity-60"
                          >
                            Cancel anytime
                          </button>
                        )}
                        {confirmDowngrade === priceKey && !cancelScheduled && (
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-3 text-[var(--type-13)] text-[var(--text-2)]">
                            <p className="font-semibold text-[var(--text-1)]">Cancel at period end?</p>
                            <p className="mt-1 text-[var(--text-3)]">
                              You keep {plan.name} until {periodEndLabel ?? 'renewal'}, then drop to Scout. No partial refund.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={handleCancel}
                                disabled={pending?.kind === 'cancel'}
                                className="rounded-md bg-[var(--text-1)] px-3 py-1.5 text-[var(--type-13)] font-semibold text-white hover:bg-black disabled:opacity-60"
                              >
                                {pending?.kind === 'cancel' ? 'Scheduling…' : 'Confirm cancel'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDowngrade(null)}
                                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--type-13)] font-semibold text-[var(--text-2)] hover:bg-[var(--warm-bg)]"
                              >
                                Keep my plan
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  }

                  // User has a different active sub on this same plan tier
                  // (e.g. monthly when they're viewing yearly) → switch with proration.
                  if (isThisCurrentPlan && currentPriceKey) {
                    return (
                      <button
                        type="button"
                        disabled={isLoading || anyPending}
                        onClick={() => handleChangePlan(priceKey)}
                        className={sharedClasses}
                      >
                        {isLoading ? 'Loading preview…' : `Switch to ${billing === 'yearly' ? 'yearly' : 'monthly'}`}
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      </button>
                    )
                  }

                  // User has a different paid plan and is looking at this one → prorated upgrade/downgrade.
                  if (currentPriceKey) {
                    const isUpgrade =
                      currentPlan === 'signal' && plan.id === 'command'
                    const label = isUpgrade ? 'Upgrade (prorated)' : 'Switch plan (prorated)'
                    return (
                      <button
                        type="button"
                        disabled={isLoading || anyPending}
                        onClick={() => handleChangePlan(priceKey)}
                        className={sharedClasses}
                      >
                        {isLoading ? 'Loading preview…' : label}
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                      </button>
                    )
                  }

                  // Anonymous or scout user → fresh checkout.
                  return (
                    <button
                      type="button"
                      disabled={isLoading || anyPending}
                      onClick={() => launchCheckout(priceKey)}
                      className={sharedClasses}
                    >
                      {isLoading ? 'Redirecting…' : plan.cta}
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    </button>
                  )
                })()}
              </motion.article>
            )
          })}
          <motion.article
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, delay: 0.22 }}
            whileHover={{ y: -6, boxShadow: '0 18px 38px -18px rgba(15, 23, 42, 0.18)' }}
            className="relative flex h-full flex-col rounded-2xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] p-5 shadow-[var(--shadow-md)]"
          >
            <span className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full border border-[var(--green)] bg-[var(--green)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white shadow-[var(--shadow-sm)]">
              Included
            </span>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--warm-bg)]">
                  <Puzzle className="h-4 w-4 text-[var(--text-1)]" />
                </span>
                <p className="text-[var(--type-12)] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">
                  Chrome Extension
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-end gap-1">
              <p className="font-display text-[clamp(1.5rem,4vw,2rem)] font-bold text-[var(--text-1)]">Free</p>
              <p className="pb-1 text-[var(--type-14)] text-[var(--text-3)]">with any paid plan</p>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-4)]">No separate subscription</p>
            <ul className="mt-4 flex-1 space-y-2">
              <li className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-2)]">
                <Check className="mt-0.5 h-4 w-4 text-[var(--green)]" />
                <span>Live listing overlay on eBay + Marketplace</span>
              </li>
              <li className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-2)]">
                <Check className="mt-0.5 h-4 w-4 text-[var(--green)]" />
                <span>Negotiation scripts built in</span>
              </li>
              <li className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-2)]">
                <Check className="mt-0.5 h-4 w-4 text-[var(--green)]" />
                <span>Counts against your plan&apos;s monthly analyses</span>
              </li>
            </ul>
            <a
              href={CHROME_EXTENSION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-2 text-[var(--type-14)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
            >
              Get the Extension
              <ArrowRight className="h-4 w-4" />
            </a>
          </motion.article>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20px' }}
          transition={{ duration: 0.35 }}
          className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-5 shadow-[var(--shadow-sm)] md:flex-row md:items-center"
        >
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)]">
              <Sparkles className="h-4 w-4 text-[var(--amber)]" />
            </span>
            <div>
              <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                Ran out mid-month? Boost Pack — {centsToUSD(BOOST_PRICE_CENTS)} for {BOOST_CREDITS} extra analyses
              </p>
              <p className="mt-0.5 text-[var(--type-13)] text-[var(--text-3)]">
                One-time top-up. Stacks on any plan, including Scout. No subscription change.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => launchCheckout('boost')}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-2 text-[var(--type-14)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pendingMatches(pending, 'boost') ? 'Redirecting…' : 'Buy Boost'}
            {pendingMatches(pending, 'boost') ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          </button>
        </motion.div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-[var(--red)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-4 py-3 text-[var(--type-14)] text-[var(--red)]"
          >
            {errorMessage}
          </div>
        )}

        <AnimatePresence>
          {proration && (
            <motion.div
              key="proration-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
              onClick={() => pending?.kind !== 'change' && setProration(null)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="proration-title"
            >
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 10, opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">
                  Confirm switch
                </p>
                <h3
                  id="proration-title"
                  className="mt-2 font-display text-[22px] font-bold text-[var(--text-1)]"
                >
                  Switch to {proration.planName}{' '}
                  {proration.interval ? `(${proration.interval})` : ''}
                </h3>
                <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                  {proration.priceKey.includes('scholar')
                    ? 'Nothing is charged today. The credit for your unused time and the new plan’s rate are settled on your next bill.'
                    : 'Nothing is charged today. To confirm, we’ll send you to Stripe’s secure billing page where you can review and reauthorize your card if needed.'}
                </p>

                {(() => {
                  const p = proration.preview
                  const renewalLabel = p.next_invoice_at
                    ? new Date(p.next_invoice_at).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })
                    : null
                  return (
                    <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">
                        Your next invoice{renewalLabel ? ` · ${renewalLabel}` : ''}
                      </p>
                      {p.next_cycle_cents > 0 && (
                        <div className="mt-2 flex items-center justify-between text-[var(--type-14)] text-[var(--text-2)]">
                          <span>{proration.planName}{proration.interval ? ` (${proration.interval})` : ''} — regular rate</span>
                          <span className="font-mono text-[var(--text-1)]">
                            {formatMoney(p.next_cycle_cents, p.currency)}
                          </span>
                        </div>
                      )}
                      {p.proration_charge_cents > 0 && (
                        <div className="mt-1.5 flex items-center justify-between text-[var(--type-14)] text-[var(--text-2)]">
                          <span>Prorated charge for partial new-plan time</span>
                          <span className="font-mono text-[var(--text-1)]">
                            +{formatMoney(p.proration_charge_cents, p.currency)}
                          </span>
                        </div>
                      )}
                      {p.proration_credit_cents > 0 && (
                        <div className="mt-1.5 flex items-center justify-between text-[var(--type-14)] text-[var(--text-2)]">
                          <span>Credit for unused time on current plan</span>
                          <span className="font-mono text-[var(--green)]">
                            −{formatMoney(p.proration_credit_cents, p.currency)}
                          </span>
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[var(--type-14)]">
                        <span className="font-semibold text-[var(--text-1)]">Total on next invoice</span>
                        <span className="font-mono text-[16px] font-semibold text-[var(--text-1)]">
                          {formatMoney(Math.max(0, p.amount_due_cents), p.currency)}
                        </span>
                      </div>
                      {p.amount_due_cents <= 0 && (
                        <p className="mt-1.5 text-[11px] text-[var(--text-4)]">
                          Your credit covers the switch — nothing owed at next renewal.
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-[var(--text-4)]">
                        Today’s charge: $0.00 — adjustments apply at the next bill.
                      </p>
                    </div>
                  )
                })()}

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setProration(null)}
                    disabled={pending?.kind === 'change'}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-[var(--type-14)] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--warm-bg-secondary)] disabled:opacity-60"
                  >
                    Keep current plan
                  </button>
                  <button
                    type="button"
                    onClick={confirmProrationSwitch}
                    disabled={pending?.kind === 'change'}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--text-1)] px-4 py-2 text-[var(--type-14)] font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending?.kind === 'change' ? (
                      <>
                        {proration.priceKey.includes('scholar') ? 'Switching…' : 'Opening Stripe…'}
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </>
                    ) : (
                      <>
                        {proration.priceKey.includes('scholar') ? 'Confirm switch' : 'Continue on Stripe'}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-6 text-center text-[11px] text-[var(--text-4)]">
          No credit card required to start. Cancel in two clicks.
        </p>
      </div>
    </section>
  )
}
