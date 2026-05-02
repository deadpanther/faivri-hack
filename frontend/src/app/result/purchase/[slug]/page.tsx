'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Car,
  Check,
  Clock,
  Handshake,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  Wrench,
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatPrice } from '@/lib/constants'
import { reveal, stagger } from '@/lib/motion'
import { FreshnessBadge } from '@/components/ui/FreshnessBadge'
import CarNegotiationCoach from '@/components/used-cars/CarNegotiationCoach'
import QuoteShareSheet from '@/components/share/QuoteShareSheet'

interface PurchaseVehicle {
  make?: string
  model?: string
  year?: number
  mileage_km?: number
}

interface PurchaseRange {
  low: number
  high: number
}

const KM_PER_MILE = 1.609

function kmToMiles(km?: number | null): number | null {
  if (typeof km !== 'number' || !Number.isFinite(km)) return null
  return Math.round(km / KM_PER_MILE)
}

interface PurchaseMaintenanceItem {
  label: string
  status: 'overdue' | 'upcoming' | 'ok'
  // LIVE-P0-02: per-service cost is null until the live pricing pipeline
  // produces a real figure. Anything non-null here is evidence-backed.
  estimated_cost: number | null
  due_at_km?: number
  km_until_due?: number
}

interface PurchaseRecall {
  component?: string
  summary?: string
}

interface PurchaseAdjustment {
  kind: 'penalty' | 'credit'
  label: string
  cents: number
  reason: string
  category?: string
}

interface PurchaseAdjustedPricing {
  baseline_low: number
  baseline_high: number
  adjustment_total: number
  adjusted_low: number
  adjusted_mid: number
  adjusted_high: number
  target_offer: number
  opening_offer: number
  walk_away_above: number
  overpay_amount: number
  asking_vs_baseline_pct: number
}

interface PurchaseSafetyAdvice {
  universal_tips: string[]
  contextual_tips: string[]
  scam_red_flags: string[]
}

interface PurchaseNegotiationLever {
  label: string
  cents_impact: number
  // Backend canonically returns `talking_point`. Older payloads used `reason`;
  // we accept either so cached analyses don't render blank rationale.
  talking_point?: string
  reason?: string
  category?: string
}

interface PurchaseNegotiationScriptTurn {
  speaker: 'buyer' | 'seller'
  phase: string
  title: string
  script: string
}

interface PurchaseResultData {
  id?: string
  currency?: string
  freshness?: {
    source: string
    live_search: boolean
    fetched_at?: string
    web_results_count?: number
    knowledge_results_count?: number
  }
  vehicle?: PurchaseVehicle
  asking_price: number
  asking_price_verdict?: 'overcharge' | 'high' | 'fair'
  overcharge_multiplier?: number
  fair_price_range?: PurchaseRange
  // LIVE-P0-02: null until per-service live pricing is wired. UI must not
  // fabricate a number when the backend flags the projection unavailable.
  true_cost_of_ownership: number | null
  cost_projection_12mo?: {
    available?: boolean
    is_estimate?: boolean
    estimate_low?: number
    estimate_high?: number
    total?: number
    basis?: string
    reliability_factor?: number
    upcoming_services?: { service: string; due_at_km: number }[]
  }
  maintenance_audit?: PurchaseMaintenanceItem[]
  red_flags?: string[]
  questions_for_seller?: string[]
  recalls?: PurchaseRecall[]
  explanation?: string
  adjusted_pricing?: PurchaseAdjustedPricing
  adjustments?: PurchaseAdjustment[]
  safety_advice?: PurchaseSafetyAdvice
  negotiation_leverage?: PurchaseNegotiationLever[]
  negotiation_script?: PurchaseNegotiationScriptTurn[]
}

function normalize(input: unknown): PurchaseResultData | null {
  if (!input || typeof input !== 'object') return null
  const parsed = input as Partial<PurchaseResultData>
  if (typeof parsed.asking_price !== 'number') {
    return null
  }
  if (
    parsed.true_cost_of_ownership !== null &&
    parsed.true_cost_of_ownership !== undefined &&
    typeof parsed.true_cost_of_ownership !== 'number'
  ) {
    return null
  }
  return {
    ...parsed,
    maintenance_audit: parsed.maintenance_audit || [],
    red_flags: parsed.red_flags || [],
    questions_for_seller: parsed.questions_for_seller || [],
    recalls: parsed.recalls || [],
  } as PurchaseResultData
}

export default function PurchaseResultPage() {
  const router = useRouter()
  const params = useParams<{ slug: string }>()
  const analysisId = params?.slug

  const [data, setData] = useState<PurchaseResultData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!analysisId) return
    let cancelled = false
    api
      .getPurchaseAnalysis(analysisId)
      .then((raw) => {
        if (cancelled) return
        const normalized = normalize(raw)
        if (!normalized) {
          setError('This analysis came back in an unexpected shape. Please rerun it.')
        } else {
          setError(null)
          setData(normalized)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load purchase analysis.'
        setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [analysisId, attempt])

  if (loading) {
    return (
      <section className="ui-section">
        <div className="ui-container flex flex-col items-center justify-center py-24 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-bright)]" />
          <p className="mt-3 text-[var(--type-16)] text-[var(--text-3)]">Loading your purchase analysis…</p>
        </div>
      </section>
    )
  }

  if (error || !data) {
    return (
      <section className="ui-section">
        <div className="ui-container text-center py-20">
          <p className="text-[var(--type-16)] text-[var(--text-2)]">
            {error || 'No purchase analysis data found.'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => {
                setLoading(true)
                setError(null)
                setAttempt((n) => n + 1)
              }}
              className="ui-button-secondary"
            >
              Try again
            </button>
            <button onClick={() => router.push('/')} className="ui-button-secondary">
              Go home
            </button>
          </div>
        </div>
      </section>
    )
  }

  const currency = data.currency || 'USD'
  const vehicle = data.vehicle || {}
  const isOvercharge = data.asking_price_verdict === 'overcharge'
  const isHigh = data.asking_price_verdict === 'high'
  const verdictClass = isOvercharge ? 'card-danger' : isHigh ? 'card-warning' : 'card-green'
  const verdictLabel = isOvercharge ? 'Overpriced' : isHigh ? 'Above Average' : 'Fair Price'
  const maintenance = data.maintenance_audit || []
  // Projection is shown when backend flags `available: true`. The newer
  // `is_estimate: true` shape means the figure is a coarse band, not live —
  // we render it with explicit "estimate, not live" framing so users can
  // calibrate trust.
  const projection = data.cost_projection_12mo
  const projectionAvailable = projection?.available === true
  const projectionIsEstimate = projection?.is_estimate === true
  const upcomingServices = projection?.upcoming_services || []
  const tcoAvailable = projectionAvailable && typeof data.true_cost_of_ownership === 'number'
  const adjusted = data.adjusted_pricing
  const adjustments = data.adjustments || []
  const safety = data.safety_advice
  const leverage = data.negotiation_leverage || []
  const negotiationScript = data.negotiation_script || []
  const hasDiligence = adjustments.length > 0 || (adjusted && adjusted.adjustment_total !== 0)

  return (
    <section className="ui-section">
      <div className="ui-container">
        <button onClick={() => router.push('/')} className="ui-button-secondary mb-4 inline-flex items-center gap-1.5 !py-2 sm:mb-5">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </button>

        <motion.header {...reveal(0)} className="ui-surface-strong perspective-stack mb-4 rounded-2xl p-4 sm:mb-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-accent)] bg-[var(--accent-wash)]">
              <Car className="h-5 w-5 text-[var(--accent-bright)]" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[var(--type-20)] font-semibold leading-tight text-[var(--text-1)] sm:text-[var(--type-24)]">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h1>
              <p className="mt-0.5 text-[var(--type-13)] text-[var(--text-3)] sm:text-[var(--type-14)]">
                {kmToMiles(vehicle.mileage_km)?.toLocaleString() || 'Mileage unavailable'} mi · Asking {formatPrice(data.asking_price, currency)}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 sm:mt-0 sm:border-0 sm:pt-0">
            <FreshnessBadge freshness={data.freshness} />
            {analysisId && (
              <div className="ml-auto">
                <QuoteShareSheet
                  kind="purchase"
                  recordId={analysisId}
                  title={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Used car'}
                  domain="used_cars"
                  quotedPriceCents={data.asking_price}
                  fairLowCents={data.fair_price_range?.low}
                  fairHighCents={data.fair_price_range?.high}
                  currency={currency}
                />
              </div>
            )}
          </div>
        </motion.header>

        <div className="grid gap-4 lg:grid-cols-3">
          <motion.section {...reveal(0.08)} className="ui-surface-strong perspective-stack lg:col-span-2 rounded-2xl p-5 text-center">
            <div className="flex items-center justify-center gap-2">
              <p className="ui-caption">True cost of ownership (12 months)</p>
              {projectionIsEstimate && (
                <span className="rounded-full border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                  Estimate · not live
                </span>
              )}
            </div>
            {tcoAvailable ? (
              <>
                <p className="mt-2 font-display text-[clamp(1.75rem,6vw,2.75rem)] font-semibold text-gradient-hero">
                  {formatPrice(data.true_cost_of_ownership as number, currency)}
                </p>
                <p className="mt-1.5 text-[var(--type-14)] text-[var(--text-2)]">
                  {formatPrice(data.asking_price, currency)} purchase +{' '}
                  {formatPrice(projection?.total || 0, currency)} maintenance
                </p>
                {projectionIsEstimate && projection?.estimate_low && projection?.estimate_high && (
                  <p className="mt-1.5 text-[var(--type-12)] text-[var(--text-3)]">
                    12-mo maintenance band: {formatPrice(projection.estimate_low, currency)} – {formatPrice(projection.estimate_high, currency)}
                    {projection.basis ? ` · typical for ${projection.basis}` : ''}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-3 font-display text-[clamp(1.5rem,5vw,2.25rem)] font-semibold text-[var(--text-2)]">
                  Estimate unavailable
                </p>
                <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                  {upcomingServices.length > 0
                    ? `${upcomingServices.length} service${upcomingServices.length === 1 ? '' : 's'} due in the next 12 months — see schedule below.`
                    : 'Re-run the analysis to try again.'}
                </p>
                <button
                  onClick={() => {
                    setLoading(true)
                    setError(null)
                    setAttempt((n) => n + 1)
                  }}
                  className="ui-button-secondary mt-3 !py-2"
                >
                  Retry
                </button>
              </>
            )}
          </motion.section>

          <motion.section {...reveal(0.12)} className={`${verdictClass} perspective-stack rounded-2xl p-5 text-center`}>
            <p className="ui-caption">Asking price verdict</p>
            <p className="mt-2 font-display text-[var(--type-32)] font-semibold text-[var(--text-1)]">
              {data.overcharge_multiplier?.toFixed(1) || '1.0'}x
            </p>
            <p className="mt-1 text-[var(--type-16)] font-semibold text-[var(--text-2)]">{verdictLabel}</p>
            {data.fair_price_range && (
              <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                Fair: {formatPrice(data.fair_price_range.low, currency)} - {formatPrice(data.fair_price_range.high, currency)}
              </p>
            )}
          </motion.section>
        </div>

        {adjusted && (
          <motion.section {...reveal(0.14)} className="ui-surface-strong perspective-stack mt-4 rounded-2xl p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                <Handshake className="h-4 w-4 text-[var(--accent-bright)]" />
                Negotiation playbook
              </h2>
              <span className="text-[var(--type-12)] text-[var(--text-3)]">
                Based on your diligence answers
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[var(--border-accent)] bg-[var(--accent-wash)] p-4">
                <p className="ui-caption inline-flex items-center gap-1.5">
                  <Target className="h-3 w-3" />
                  Opening offer
                </p>
                <p className="mt-2 font-display text-[var(--type-24)] font-semibold text-[var(--text-1)]">
                  {formatPrice(adjusted.opening_offer, currency)}
                </p>
                <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)]">
                  Start ~8% below your target. Leaves room to meet at fair price.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] p-4">
                <p className="ui-caption">Target (your fair price)</p>
                <p className="mt-2 font-display text-[var(--type-24)] font-semibold text-[var(--text-1)]">
                  {formatPrice(adjusted.target_offer, currency)}
                </p>
                <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)]">
                  Adjusted range: {formatPrice(adjusted.adjusted_low, currency)} – {formatPrice(adjusted.adjusted_high, currency)}
                </p>
              </div>
              <div className="card-danger rounded-xl p-4">
                <p className="ui-caption inline-flex items-center gap-1.5">
                  <ShieldAlert className="h-3 w-3" />
                  Walk-away above
                </p>
                <p className="mt-2 font-display text-[var(--type-24)] font-semibold text-[var(--red-dim)]">
                  {formatPrice(adjusted.walk_away_above, currency)}
                </p>
                <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)]">
                  Pay more than this and you&apos;re overpaying. There are other cars.
                </p>
              </div>
            </div>

            {adjusted.overpay_amount > 0 && (
              <div className="card-warning mt-4 flex items-start gap-2 rounded-xl px-4 py-3">
                <TrendingUp className="mt-0.5 h-4 w-4 text-[var(--amber-dim)]" />
                <p className="text-[var(--type-14)] text-[var(--text-2)]">
                  Asking is <strong>{formatPrice(adjusted.overpay_amount, currency)}</strong> over the
                  adjusted top of fair range. Use the diligence findings below as leverage.
                </p>
              </div>
            )}
          </motion.section>
        )}

        {analysisId && (
          <CarNegotiationCoach
            purchaseId={analysisId}
            vehicleLabel={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'this car'}
            askingPriceCents={data.asking_price}
            fairLowCents={data.fair_price_range?.low}
            fairHighCents={data.fair_price_range?.high}
            targetCents={adjusted?.target_offer}
            walkAwayCents={adjusted?.walk_away_above}
            currency={currency}
            diligenceFlags={(adjustments || [])
              .filter((a) => a.kind === 'penalty')
              .map((a) => a.label)
              .slice(0, 3)}
          />
        )}

        {hasDiligence && adjustments.length > 0 && (
          <motion.section {...reveal(0.16)} className="ui-surface perspective-stack mt-4 rounded-2xl p-5">
            <h2 className="mb-3 inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
              <TrendingDown className="h-4 w-4 text-[var(--accent-bright)]" />
              Price adjustments from your answers
            </h2>
            <div className="space-y-2">
              {adjustments.map((adj, index) => {
                const isPenalty = adj.kind === 'penalty'
                const cardClass = isPenalty ? 'card-danger' : 'card-green'
                const sign = isPenalty ? '−' : '+'
                return (
                  <motion.article
                    key={`${adj.label}-${index}`}
                    {...stagger(index * 0.03)}
                    className={`${cardClass} flex items-start gap-3 rounded-xl px-4 py-3`}
                  >
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-up)]">
                      {isPenalty ? (
                        <TrendingDown className="h-4 w-4 text-[var(--red-dim)]" />
                      ) : (
                        <TrendingUp className="h-4 w-4 text-[var(--green-dim)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">{adj.label}</p>
                      <p className="text-[var(--type-12)] text-[var(--text-3)]">{adj.reason}</p>
                    </div>
                    <span className={`font-mono text-[var(--type-14)] font-semibold ${isPenalty ? 'text-[var(--red-dim)]' : 'text-[var(--green-dim)]'}`}>
                      {sign}{formatPrice(Math.abs(adj.cents), currency)}
                    </span>
                  </motion.article>
                )
              })}
            </div>
            {adjusted && adjusted.adjustment_total !== 0 && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-3">
                <span className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">Net adjustment</span>
                <span className={`font-mono text-[var(--type-16)] font-semibold ${adjusted.adjustment_total < 0 ? 'text-[var(--red-dim)]' : 'text-[var(--green-dim)]'}`}>
                  {adjusted.adjustment_total < 0 ? '−' : '+'}{formatPrice(Math.abs(adjusted.adjustment_total), currency)}
                </span>
              </div>
            )}
          </motion.section>
        )}

        {negotiationScript.length > 0 && (
          <motion.section {...reveal(0.17)} className="ui-surface-strong perspective-stack mt-4 rounded-2xl p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                <Handshake className="h-4 w-4 text-[var(--accent-bright)]" />
                Practice the back-and-forth
              </h2>
              <span className="text-[var(--type-12)] text-[var(--text-3)]">
                Sample dialogue · adapt to your tone
              </span>
            </div>
            <div className="space-y-2.5">
              {negotiationScript.map((turn, index) => {
                const isBuyer = turn.speaker === 'buyer'
                const bubbleClass = isBuyer
                  ? 'border-[var(--border-accent)] bg-[var(--accent-wash)]'
                  : 'border-[var(--border)] bg-[var(--warm-bg-secondary)]'
                return (
                  <motion.div
                    key={`${turn.phase}-${index}`}
                    {...stagger(index * 0.03)}
                    className={`flex ${isBuyer ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[88%] rounded-2xl border ${bubbleClass} px-4 py-3`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                        {isBuyer ? 'You' : 'Seller'} · {turn.title}
                      </p>
                      <p className="mt-1 text-[var(--type-14)] leading-relaxed text-[var(--text-2)]">
                        “{turn.script}”
                      </p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </motion.section>
        )}

        {leverage.length > 0 && (
          <motion.section {...reveal(0.18)} className="card-accent perspective-stack mt-4 rounded-2xl p-5">
            <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--accent-bright)]">
              <Handshake className="h-4 w-4" />
              Top negotiation levers
            </h3>
            <div className="space-y-2">
              {leverage.map((lever, index) => (
                <div key={`${lever.label}-${index}`} className="ui-surface flex items-start gap-3 rounded-lg px-3 py-2">
                  <span className="ui-chip !h-6 !w-6 !justify-center !rounded-md !px-0">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">{lever.label}</p>
                    <p className="text-[var(--type-12)] text-[var(--text-3)]">{lever.talking_point || lever.reason}</p>
                  </div>
                  <span className="font-mono text-[var(--type-12)] font-semibold text-[var(--red-dim)]">
                    −{formatPrice(Math.abs(lever.cents_impact), currency)}
                  </span>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {safety && (safety.universal_tips.length > 0 || safety.scam_red_flags.length > 0) && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {safety.scam_red_flags.length > 0 && (
              <motion.section {...reveal(0.2)} className="card-danger perspective-stack rounded-2xl p-5">
                <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--red-dim)]">
                  <ShieldAlert className="h-4 w-4" />
                  Scam red flags for this deal
                </h3>
                <ul className="space-y-2">
                  {safety.scam_red_flags.map((flag, index) => (
                    <li key={`${flag}-${index}`} className="ui-surface rounded-lg px-3 py-2 text-[var(--type-14)] text-[var(--text-2)]">
                      {flag}
                    </li>
                  ))}
                </ul>
              </motion.section>
            )}

            {(safety.universal_tips.length > 0 || safety.contextual_tips.length > 0) && (
              <motion.section
                {...reveal(0.22)}
                className={`card-evidence perspective-stack rounded-2xl p-5 ${safety.scam_red_flags.length === 0 ? 'lg:col-span-2' : ''}`}
              >
                <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                  <ShieldCheck className="h-4 w-4 text-[var(--accent-bright)]" />
                  Safety brief — bring this to the meetup
                </h3>
                {safety.contextual_tips.length > 0 && (
                  <div className="mb-3">
                    <p className="ui-caption mb-1.5">Specific to this listing</p>
                    <ul className="space-y-1.5">
                      {safety.contextual_tips.map((tip, index) => (
                        <li key={`ctx-${index}`} className="flex items-start gap-2 text-[var(--type-14)] text-[var(--text-2)]">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--amber-dim)]" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {safety.universal_tips.length > 0 && (
                  <details className="group rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2">
                    <summary className="flex cursor-pointer items-center justify-between text-[var(--type-12)] font-semibold uppercase tracking-wide text-[var(--text-3)] [&::-webkit-details-marker]:hidden">
                      <span>Universal anti-scam checklist · {safety.universal_tips.length} tips</span>
                      <span className="text-[var(--text-3)] transition-transform group-open:rotate-90">›</span>
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {safety.universal_tips.map((tip, index) => (
                        <li key={`tip-${index}`} className="flex items-start gap-2 text-[var(--type-12)] text-[var(--text-3)]">
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[var(--green-dim)]" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </motion.section>
            )}
          </div>
        )}

        <motion.section {...reveal(0.24)} className="ui-surface perspective-stack mt-4 rounded-2xl p-5">
          <h2 className="mb-3 inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
            <Wrench className="h-4 w-4 text-[var(--accent-bright)]" />
            Maintenance audit
          </h2>

          {maintenance.length === 0 ? (
            <p className="text-[var(--type-14)] text-[var(--text-3)]">No maintenance events found in this analysis.</p>
          ) : (
            <div className="space-y-2">
              {maintenance.map((item, index) => {
                const statusClass =
                  item.status === 'overdue'
                    ? 'card-danger'
                    : item.status === 'upcoming'
                      ? 'card-warning'
                      : 'card-green'
                return (
                  <motion.article
                    key={`${item.label}-${index}`}
                    {...stagger(index * 0.04)}
                    className={`${statusClass} flex items-center gap-3 rounded-xl px-4 py-3`}
                  >
                    <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-up)]">
                      {item.status === 'overdue' ? (
                        <AlertTriangle className="h-4 w-4 text-[var(--red-dim)]" />
                      ) : item.status === 'upcoming' ? (
                        <Clock className="h-4 w-4 text-[var(--amber-dim)]" />
                      ) : (
                        <Check className="h-4 w-4 text-[var(--green-dim)]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">{item.label}</p>
                      <p className="text-[var(--type-14)] text-[var(--text-3)]">
                        {item.status === 'overdue'
                          ? `Overdue — due at ${kmToMiles(item.due_at_km)?.toLocaleString() || 'N/A'} mi`
                          : item.status === 'upcoming'
                            ? `Due in ${kmToMiles(item.km_until_due)?.toLocaleString() || 'N/A'} mi`
                            : `Due at ${kmToMiles(item.due_at_km)?.toLocaleString() || 'N/A'} mi`}
                      </p>
                    </div>
                    <span className="font-mono text-[var(--type-14)] text-[var(--text-3)]">
                      {typeof item.estimated_cost === 'number'
                        ? formatPrice(item.estimated_cost, currency)
                        : '—'}
                    </span>
                  </motion.article>
                )
              })}
            </div>
          )}
        </motion.section>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {data.red_flags && data.red_flags.length > 0 && (
            <motion.section {...reveal(0.2)} className="card-danger perspective-stack rounded-2xl p-4">
              <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--red-dim)]">
                <AlertTriangle className="h-4 w-4" />
                Red flags
              </h3>
              <div className="space-y-2">
                {data.red_flags.map((flag, index) => (
                  <div key={`${flag}-${index}`} className="ui-surface rounded-lg px-3 py-2 text-[var(--type-14)] text-[var(--text-2)]">
                    {flag}
                  </div>
                ))}
              </div>
            </motion.section>
          )}

          {data.questions_for_seller && data.questions_for_seller.length > 0 && (
            <motion.section {...reveal(0.24)} className="card-accent perspective-stack rounded-2xl p-4">
              <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--accent-bright)]">
                <Shield className="h-4 w-4" />
                Ask the seller
              </h3>
              <div className="space-y-2">
                {data.questions_for_seller.map((question, index) => (
                  <div key={`${question}-${index}`} className="ui-surface flex items-start gap-2 rounded-lg px-3 py-2">
                    <span className="ui-chip !h-5 !w-5 !justify-center !rounded-md !px-0">{index + 1}</span>
                    <p className="text-[var(--type-14)] text-[var(--text-2)]">{question}</p>
                  </div>
                ))}
              </div>
            </motion.section>
          )}
        </div>

        {data.recalls && data.recalls.length > 0 && (
          <motion.section {...reveal(0.28)} className="card-danger perspective-stack mt-4 rounded-2xl p-5">
            <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--red-dim)]">
              <AlertTriangle className="h-4 w-4" />
              Open recalls ({data.recalls.length})
            </h3>
            <div className="space-y-2">
              {data.recalls.map((recall, index) => (
                <div key={`${recall.component || 'recall'}-${index}`} className="ui-surface rounded-lg px-3 py-2">
                  <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">{recall.component || 'Component unavailable'}</p>
                  <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                    {recall.summary?.slice(0, 180) || 'No summary provided.'}
                  </p>
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {data.explanation && (
          <motion.section {...reveal(0.32)} className="card-evidence perspective-stack mt-4 rounded-2xl p-5">
            <p className="ui-caption mb-2">Analysis notes</p>
            <p className="text-[var(--type-16)] leading-relaxed text-[var(--text-2)]">{data.explanation}</p>
          </motion.section>
        )}
      </div>
    </section>
  )
}
