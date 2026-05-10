'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Database,
  ExternalLink,
  Flag,
  Home as HomeIcon,
  MapPin,
  MessageSquare,
  Pill,
  Shield,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api, VerdictData } from '@/lib/api'
import { formatPrice } from '@/lib/constants'
import { reveal, stagger, scrollReveal, scrollStagger, scaleIn, cardHover, DUR, EASE, SPRING_KPI } from '@/lib/motion'
import { SkeletonVerdictPage } from '@/components/ui/Skeleton'
import { FreshnessBadge } from '@/components/ui/FreshnessBadge'
import Recommendations from '@/components/ui/Recommendations'
import ProjectedSavings from '@/components/savings/ProjectedSavings'
import SavingsCelebration from '@/components/savings/SavingsCelebration'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import { useToast } from '@/components/ui/Toast'
import QuoteShareSheet from '@/components/share/QuoteShareSheet'

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  auto: Wrench,
  medical: Pill,
  home: HomeIcon,
  legal: Shield,
}

export default function ResultPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<VerdictData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  // Feedback form state
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportPrice, setReportPrice] = useState('')
  const [reportOutcome, setReportOutcome] = useState('negotiated_down')
  const [reportVendor, setReportVendor] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)

  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationData, setCelebrationData] = useState<{
    savings: number
    streak: { monthly_dodged: number; lifetime_saved: number; level: string; milestone_unlocked: string | null } | null
  } | null>(null)

  useEffect(() => {
    if (!params.id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    api
      .getVerdict(params.id as string)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Could not load this query. Please try again.'
        setLoadError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params.id, loadAttempt])

  const meta = useMemo(() => {
    if (!data) return null
    const isOvercharge = data.verdict === 'overcharge'
    const isHigh = data.verdict === 'high'
    const verdictLabel = isOvercharge ? 'Overcharged' : isHigh ? 'Above Average' : 'Fair Price'
    const verdictToneClass = isOvercharge ? 'text-[var(--red-text)]' : isHigh ? 'text-[var(--amber-text)]' : 'text-[var(--green-text)]'
    const verdictCardClass = isOvercharge ? 'card-danger' : isHigh ? 'card-warning' : 'card-green'
    return { isOvercharge, isHigh, verdictLabel, verdictToneClass, verdictCardClass }
  }, [data])

  if (loading) return <SkeletonVerdictPage />

  if (!data || !meta) {
    return (
      <section className="ui-section">
        <div className="ui-container text-center py-20">
          <p className="text-[var(--type-16)] text-[var(--text-2)]">
            {loadError || 'Query not found'}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {loadError && (
              <button
                onClick={() => setLoadAttempt((n) => n + 1)}
                className="ui-button-secondary"
              >
                Try again
              </button>
            )}
            <button onClick={() => router.push('/')} className="ui-button-secondary">
              Go home
            </button>
          </div>
        </div>
      </section>
    )
  }

  const DomainIcon = DOMAIN_ICONS[data.domain] || Wrench

  const maxPrice = data.quoted_price || data.fair_price_high * 1.5
  const safeMax = Math.max(maxPrice, 1)
  const fairStartPct = Math.min((data.fair_price_low / safeMax) * 100, 100)
  const fairWidthPct = Math.min(((data.fair_price_high - data.fair_price_low) / safeMax) * 100, 100 - fairStartPct)
  const quotedPct = data.quoted_price ? Math.min((data.quoted_price / safeMax) * 100, 100) : 0

  async function submitFeedback() {
    if (!reportPrice || !data) return
    setReportSubmitting(true)
    try {
      const finalPriceSmallest = Math.round(parseFloat(reportPrice) * 100)
      const response = await api.feedback({
        query_id: data.id,
        final_price: finalPriceSmallest,
        outcome: reportOutcome,
        vendor_name: reportVendor || undefined,
      })
      setShowReportModal(false)
      setCelebrationData({
        savings: response.savings,
        streak: response.streak,
      })
      setShowCelebration(true)
    } catch (err: unknown) {
      // Surface the failure — the user just gave us a real outcome, swallowing
      // it silently sends them back to the result page wondering if it saved.
      const msg = err instanceof Error ? err.message : 'Could not save your report. Please try again.'
      toast(msg, 'error')
    } finally {
      setReportSubmitting(false)
    }
  }

  return (
    <section className="ui-section">
      <div className="ui-container max-w-5xl mx-auto">
        <button
          onClick={() => {
            // Prefer browser back so users land on whatever they came from
            // (history, garage, community). Fall back to home only when the
            // tab opened directly into the result (no prior entry).
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back()
            } else {
              router.push('/')
            }
          }}
          className="btn-ghost mb-4 inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* ── Projected Savings Hero ── */}
        <motion.div {...reveal(0)} className="mb-5">
          <ProjectedSavings
            verdict={data.verdict as 'overcharge' | 'high' | 'fair'}
            quotedPrice={data.quoted_price ?? null}
            fairPriceHigh={data.fair_price_high}
            fairPriceLow={data.fair_price_low}
            dataPointsCount={data.data_points_count}
            locationCity={data.location_city}
            queryId={data.id}
          />
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          {/* ── Main content ── */}
          <main className="space-y-4">
            {/* Verdict card */}
            <motion.section {...reveal(0.06)} className="glass-strong perspective-stack rounded-2xl p-4 sm:rounded-3xl sm:p-6 md:p-7">
              <header className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-5">
                <div className="ui-chip !rounded-lg">
                  <DomainIcon className="h-4 w-4 text-[var(--blue)]" />
                  <span className="capitalize">
                    {data.domain === 'auto' ? 'Auto Repair' : data.domain} · {data.location_city}
                  </span>
                </div>
                <FreshnessBadge freshness={data.freshness} />
              </header>

              <div className={`${meta.verdictCardClass} rounded-2xl px-4 py-7 text-center sm:px-6 sm:py-10`}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={SPRING_KPI}
                >
                  <p className="font-display text-[clamp(2.5rem,11vw,6rem)] font-bold leading-none tracking-[-0.03em]">
                    <AnimatedCounter target={data.overcharge_multiplier} decimals={1} suffix="x" duration={1.0} />
                  </p>
                </motion.div>
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, duration: 0.3 }}
                  className={`mt-3 text-[var(--type-14)] font-bold uppercase tracking-[0.12em] ${meta.verdictToneClass}`}
                >
                  {meta.verdictLabel}
                </motion.p>

                {/* Price comparison pills */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.55, duration: 0.3 }}
                  className="mt-5 flex flex-wrap items-center justify-center gap-2"
                >
                  {data.quoted_price && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-strong)] bg-[var(--warm-bg)] px-3 py-1.5 text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                      Quoted {formatPrice(data.quoted_price, data.currency)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-1.5 text-[var(--type-14)] text-[var(--text-2)]">
                    Fair {formatPrice(data.fair_price_low, data.currency)} – {formatPrice(data.fair_price_high, data.currency)}
                    {data.fair_price_mid > 0 && (
                      <span className="text-[var(--text-4)]">
                        · median {formatPrice(data.fair_price_mid, data.currency)}
                      </span>
                    )}
                  </span>
                </motion.div>

                {/* Defensible overpay numbers — only shown when quote exceeds fair range */}
                {data.conservative_overpay > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7, duration: 0.3 }}
                    className="mt-4 grid gap-2 sm:grid-cols-2"
                  >
                    <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg)] px-4 py-3 text-left">
                      <p className="ui-caption text-[var(--text-4)]">Defensible overpay</p>
                      <p className="mt-1 text-[var(--type-20)] font-bold text-[var(--red-text)]">
                        {formatPrice(data.conservative_overpay, data.currency)}
                      </p>
                      <p className="mt-0.5 text-[var(--type-12)] text-[var(--text-4)]">
                        vs. fair ceiling — the number to cite in negotiation
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3 text-left">
                      <p className="ui-caption text-[var(--text-4)]">Expected overpay</p>
                      <p className="mt-1 text-[var(--type-20)] font-bold text-[var(--text-1)]">
                        {formatPrice(data.expected_overpay, data.currency)}
                      </p>
                      <p className="mt-0.5 text-[var(--type-12)] text-[var(--text-4)]">
                        vs. market median — full picture
                      </p>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.section>

            {/* Price gauge */}
            <motion.section {...reveal(0.1)} className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] p-5">
              <p className="ui-caption mb-4">Price position</p>
              <div className="relative">
                {/* Bar track */}
                <div className="rounded-full bg-[var(--warm-bg-tertiary)] p-0.5">
                  <div className="relative h-4 rounded-full bg-[var(--warm-bg-secondary)]">
                    {/* Fair range band */}
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(fairWidthPct, 2)}%` }}
                      transition={{ duration: 1, ease: EASE.inOut }}
                      className="absolute h-full rounded-full bg-[var(--green)]"
                      style={{ left: `${fairStartPct}%`, opacity: 0.25 }}
                    />
                    {/* Fair range solid center line */}
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(fairWidthPct, 2)}%` }}
                      transition={{ duration: 1, ease: EASE.inOut, delay: 0.1 }}
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--green)]"
                      style={{ left: `${fairStartPct}%` }}
                    />
                    {/* Quoted price marker */}
                    {quotedPct > 0 && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.5, duration: 0.3, ease: EASE.out }}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full border-2 border-[var(--warm-bg)] bg-[var(--red)] shadow-sm"
                        style={{ left: `${Math.min(quotedPct, 97)}%` }}
                      />
                    )}
                  </div>
                </div>
                {/* Labels below */}
                <div className="mt-3 flex items-center justify-between text-[var(--type-12)] text-[var(--text-4)]">
                  <span>{formatPrice(data.fair_price_low, data.currency)}</span>
                  <span className="font-medium text-[var(--green-text)]">Fair range</span>
                  <span>{formatPrice(data.fair_price_high, data.currency)}</span>
                </div>
                {data.quoted_price && (
                  <p className="mt-1 text-center text-[var(--type-12)] text-[var(--red-text)] font-medium">
                    Your quote: {formatPrice(data.quoted_price, data.currency)}
                  </p>
                )}
              </div>
            </motion.section>

            {/* Explanation */}
            <motion.section {...reveal(0.14)} className="rounded-xl border-l-4 border-l-[var(--blue)] border border-[var(--border)] bg-[var(--warm-bg)] p-5">
              <p className="ui-caption mb-2">Analysis</p>
              <p className="text-[var(--type-16)] leading-relaxed text-[var(--text-2)]">{data.explanation}</p>
            </motion.section>

            {/* Confidence + Evidence */}
            <motion.section {...reveal(0.18)} className="glass perspective-stack rounded-2xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="ui-caption">Confidence</p>
                  <p className="mt-1 text-[var(--type-16)] text-[var(--text-2)]">
                    <strong className="text-[var(--text-1)]">
                      {data.confidence_score >= 80 ? 'High' : data.confidence_score >= 50 ? 'Moderate' : 'Low'}
                    </strong>{' '}
                    — {data.data_points_count} data points
                  </p>
                </div>
                <motion.div {...scaleIn(0.3)} className="ui-chip !rounded-md !px-3"><AnimatedCounter target={data.confidence_score} suffix="%" duration={0.8} /></motion.div>
              </div>

              <details className="group mt-4">
                <summary className="flex cursor-pointer items-center justify-between text-[var(--type-14)] font-semibold text-[var(--text-2)] list-none">
                  <span className="inline-flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Evidence sources
                    {data.evidence?.sources?.length ? (
                      <span className="ui-chip !h-5 !rounded-md !px-2 !text-[var(--type-12)]">
                        {data.evidence.sources.length}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="mt-3 space-y-2">
                  {data.evidence?.sources?.length ? (
                    data.evidence.sources.map((src, index) => (
                      <motion.a
                        key={`${src.url}-${index}`}
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...stagger(index * 0.04)}
                        className="glass block rounded-lg px-3 py-2.5 text-[var(--type-14)] hover:border-[var(--border-accent)] transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text-1)]">
                            {src.domain}
                            {src.trust_weight >= 0.6 && (
                              <span className="ui-chip !h-4 !rounded-sm !px-1 !text-[var(--type-12)] !bg-[var(--green-bg)] !text-[var(--green-text)]">
                                trusted
                              </span>
                            )}
                            {src.is_local && (
                              <span className="inline-flex items-center gap-0.5 text-[var(--type-12)] text-[var(--blue)]">
                                <MapPin className="h-3 w-3" />
                                local
                              </span>
                            )}
                            <ExternalLink className="h-3 w-3 text-[var(--text-4)]" />
                          </span>
                          <span className="font-mono font-semibold text-[var(--text-2)]">
                            {formatPrice(src.price_cents, data.currency)}
                            <span className="ml-1 text-[var(--type-12)] font-normal text-[var(--text-4)]">
                              {src.price_type !== 'unknown' ? src.price_type : ''}
                            </span>
                          </span>
                        </div>
                        {src.snippet && (
                          <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)] line-clamp-2">
                            {src.snippet}
                          </p>
                        )}
                      </motion.a>
                    ))
                  ) : (
                    // Defensive: only render scalar entries here. Older rows
                    // can carry a nested `sources: [{...}, {...}]` array under
                    // `data.sources` (legacy mis-mapping of the evidence
                    // blob); without this filter `String(arr)` would surface
                    // as `[object Object],[object Object]`.
                    Object.entries(data.sources)
                      .filter(
                        ([, count]) =>
                          typeof count === 'number' ||
                          typeof count === 'boolean' ||
                          typeof count === 'string',
                      )
                      .map(([source, count], index) => (
                        <motion.div
                          key={source}
                          {...stagger(index * 0.04)}
                          className="glass flex items-center justify-between rounded-lg px-3 py-2 text-[var(--type-14)]"
                        >
                          <span className="capitalize text-[var(--text-2)]">
                            {source.replace(/_/g, ' ')}
                          </span>
                          <span className="font-mono text-[var(--text-3)]">{String(count)}</span>
                        </motion.div>
                      ))
                  )}
                </div>
              </details>
            </motion.section>
          </main>

          {/* ── Sidebar ── */}
          <aside className="space-y-4">
            {/* Red flags */}
            {data.red_flags.length > 0 && (
              <motion.section {...scrollReveal(0)} className="card-danger perspective-stack rounded-2xl p-4">
                <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--red-text)]">
                  <Flag className="h-4 w-4" />
                  Red flags
                </h3>
                <div className="space-y-2">
                  {data.red_flags.map((flag, index) => (
                    <motion.div key={`${flag}-${index}`} {...scrollStagger(index * 0.06)} className="glass rounded-xl px-3 py-2 text-[var(--type-14)] text-[var(--text-2)]">
                      {flag}
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Questions to ask */}
            {data.questions_to_ask.length > 0 && (
              <motion.section {...scrollReveal(0.08)} className="card-accent perspective-stack rounded-2xl p-4">
                <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--blue)]">
                  <MessageSquare className="h-4 w-4" />
                  Ask the vendor
                </h3>
                <div className="space-y-2">
                  {data.questions_to_ask.map((question, index) => (
                    <motion.div
                      key={`${question}-${index}`}
                      {...scrollStagger(index * 0.06)}
                      className="glass flex items-start gap-2 rounded-xl px-3 py-2"
                    >
                      <span className="ui-chip !h-5 !w-5 !justify-center !rounded-md !px-0 flex-shrink-0">{index + 1}</span>
                      <p className="text-[var(--type-14)] text-[var(--text-2)]">{question}</p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Actions */}
            <motion.section {...scrollReveal(0.12)} className="glass-strong perspective-stack rounded-2xl p-4">
              <h3 className="mb-3 inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                <Zap className="h-4 w-4 text-[var(--blue)]" />
                Take action
              </h3>

              {(data.verdict === 'overcharge' || data.verdict === 'high') && (
                <button
                  onClick={() => router.push(`/negotiate/${data.id}`)}
                  className="ui-button-primary inline-flex w-full items-center justify-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  Get negotiation script
                </button>
              )}

              <div className="mt-2">
                <QuoteShareSheet
                  kind="query"
                  recordId={data.id}
                  title={`${data.domain || 'service'} quote`}
                  domain={data.domain}
                  quotedPriceCents={data.quoted_price}
                  fairLowCents={data.fair_price_low}
                  fairHighCents={data.fair_price_high}
                  currency={data.currency}
                />
              </div>

              <button
                onClick={() => setShowReportModal(true)}
                className="ui-button-secondary mt-2 inline-flex w-full items-center justify-center gap-2"
              >
                <CheckCircle className="h-4 w-4" />
                Report final price
              </button>
            </motion.section>

            {/* Recommendations */}
            <motion.div {...scrollReveal(0.16)}>
              <Recommendations queryId={data.id} />
            </motion.div>
          </aside>
        </div>
      </div>

      {/* ── Feedback Modal ── */}
      <AnimatePresence>
        {showReportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.3)] backdrop-blur-sm p-4"
            onClick={() => setShowReportModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: DUR.normal, ease: EASE.out }}
              className="glass-strong w-full max-w-md rounded-3xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-display text-[var(--type-24)] font-semibold text-[var(--text-1)]">Report final price</h3>
              <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                What did you end up paying? This helps the community.
              </p>

              <label className="mt-4 block text-[var(--type-14)] font-semibold text-[var(--text-2)]">
                Final price ($)
              </label>
              <input
                type="number"
                value={reportPrice}
                onChange={(e) => setReportPrice(e.target.value)}
                placeholder="450"
                className="mt-1 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] text-[var(--text-1)] outline-none focus:border-[var(--border-accent)]"
              />

              <label className="mt-3 block text-[var(--type-14)] font-semibold text-[var(--text-2)]">Vendor (optional)</label>
              <input
                type="text"
                value={reportVendor}
                onChange={(e) => setReportVendor(e.target.value)}
                placeholder="e.g. Joe's Garage"
                className="mt-1 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] text-[var(--text-1)] outline-none focus:border-[var(--border-accent)]"
              />

              <label className="mt-3 block text-[var(--type-14)] font-semibold text-[var(--text-2)]">What happened?</label>
              <select
                value={reportOutcome}
                onChange={(e) => setReportOutcome(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] text-[var(--text-2)] outline-none focus:border-[var(--border-accent)]"
              >
                <option value="negotiated_down">Negotiated down</option>
                <option value="paid_full">Paid full price</option>
                <option value="walked_away">Walked away</option>
                <option value="found_alternative">Found alternative</option>
              </select>

              <div className="mt-5 flex gap-2">
                <button onClick={() => setShowReportModal(false)} className="ui-button-secondary flex-1">
                  Cancel
                </button>
                <button
                  onClick={submitFeedback}
                  disabled={!reportPrice || reportSubmitting}
                  className="ui-button-primary flex-1"
                >
                  {reportSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Savings Celebration ── */}
      <AnimatePresence>
        {showCelebration && celebrationData && data && (
          <SavingsCelebration
            savings={celebrationData.savings}
            serviceName={data.explanation?.slice(0, 80) || 'your service'}
            locationCity={data.location_city}
            outcome={reportOutcome}
            streak={celebrationData.streak}
            onClose={() => setShowCelebration(false)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
