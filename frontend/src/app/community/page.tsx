'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  Clock3,
  Search,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { api, type CommunityPriceData, type TrendPointData } from '@/lib/api'
import { DOMAINS, formatPrice } from '@/lib/constants'
import { reveal, scrollReveal, scrollStagger } from '@/lib/motion'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import LivePulse from '@/components/ui/LivePulse'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function MultiplierBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = value <= 1.2 ? 'var(--green)' : value <= 1.8 ? 'var(--amber)' : 'var(--red)'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-[var(--warm-bg-tertiary)]">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-mono text-[11px] font-semibold" style={{ color }}>{value.toFixed(1)}x</span>
    </div>
  )
}

export default function CommunityPage() {
  const [domain, setDomain] = useState('')
  const [prices, setPrices] = useState<CommunityPriceData[]>([])
  const [trends, setTrends] = useState<TrendPointData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  function handleDomainChange(value: string) {
    setLoading(true)
    setLoadError(null)
    setDomain(value)
  }

  useEffect(() => {
    const params = { domain: domain || undefined }
    let cancelled = false
    Promise.all([
      api.getCommunityPrices(params),
      domain ? api.getTrends(domain) : Promise.resolve([] as TrendPointData[]),
    ])
      .then(([priceRows, trendRows]) => {
        if (cancelled) return
        setLoadError(null)
        setPrices(priceRows)
        setTrends(trendRows)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Previously every failure was swallowed into `[]`, so a flaky
        // backend looked identical to a genuinely empty feed. Surface the
        // real error so the user knows to retry.
        const msg = err instanceof Error ? err.message : 'Could not load community data. Please try again.'
        setLoadError(msg)
        setPrices([])
        setTrends([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [domain, loadAttempt])

  const maxMultiplier = trends.length > 0 ? Math.max(...trends.map((t) => t.avg_multiplier ?? 0), 2) : 2
  const hasData = prices.length > 0 || trends.length > 0
  const visiblePrices = prices.slice(0, 10)
  const visibleTrends = trends.slice(0, 7)

  const dashboardStats = useMemo(() => {
    const distinctDomains = new Set(prices.map((p) => p.domain)).size
      const avgMultiplier = trends.length
        ? trends.reduce((sum, t) => sum + (t.avg_multiplier ?? 0), 0) / trends.length
        : 0
    const latestPriceAt = prices[0]?.created_at || null
    return [
      { label: 'Reports', counter: prices.length, value: prices.length.toString(), suffix: '', decimals: 0, tone: 'text-[var(--text-1)]' },
      { label: 'Active domains', counter: distinctDomains, value: distinctDomains.toString(), suffix: '', decimals: 0, tone: 'text-[var(--text-1)]' },
      { label: 'Avg overpay signal', counter: avgMultiplier || null, value: avgMultiplier ? `${avgMultiplier.toFixed(1)}x` : '--', suffix: 'x', decimals: 1, tone: 'text-[var(--text-1)]' },
      { label: 'Latest update', counter: null, value: latestPriceAt ? timeAgo(latestPriceAt) : '--', suffix: '', decimals: 0, tone: 'text-[var(--text-3)]' },
    ]
  }, [prices, trends])

  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-6xl mx-auto space-y-8">
        <motion.header {...reveal(0)} className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 md:p-8">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle_at_center,rgba(35,131,226,0.18),transparent_70%)] blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <LivePulse label="Live feed" />
            </div>
            <h1 className="ui-title-section mt-3">Live market intelligence</h1>
            <p className="mt-2 max-w-2xl text-[var(--type-16)] text-[var(--text-3)]">
              Community reports and trend pressure, refreshed from real usage data.
            </p>
          </div>
        </motion.header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {dashboardStats.map((stat, i) => (
            <motion.article
              key={stat.label}
              {...scrollStagger(i * 0.04)}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-4)]">{stat.label}</p>
              <p className={`mt-1 font-display text-[var(--type-20)] font-semibold ${stat.tone}`}>
                {stat.counter !== null ? (
                  <AnimatedCounter target={stat.counter} suffix={stat.suffix} decimals={stat.decimals} duration={1.1} />
                ) : (
                  stat.value
                )}
              </p>
            </motion.article>
          ))}
        </div>

        <motion.div {...scrollReveal(0)} className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[var(--type-14)] font-medium text-[var(--text-3)]">Filter:</span>
            {[{ label: 'All', value: '' }, ...DOMAINS].map((d) => (
              <button
                key={d.label}
                onClick={() => handleDomainChange('value' in d ? d.value : d.id)}
                className={`rounded-full border px-3 py-1 text-[var(--type-12)] font-medium transition-colors ${
                  domain === ('value' in d ? d.value : d.id)
                    ? 'border-[var(--border-accent)] bg-[var(--accent-wash)] text-[var(--blue)]'
                    : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-[var(--type-14)] font-medium text-[var(--blue)] hover:underline">
            Analyze a quote <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </motion.div>

        {loading ? (
          <div className="flex min-h-[24vh] items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] motion-reduce:animate-none" />
          </div>
        ) : loadError ? (
          <motion.div {...reveal(0.08)} className="rounded-2xl border border-[var(--red-border)] bg-[var(--red-bg)] p-8 text-center">
            <p className="text-[var(--type-16)] font-medium text-[var(--red-text)]">Could not load the feed</p>
            <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">{loadError}</p>
            <button
              onClick={() => {
                setLoading(true)
                setLoadError(null)
                setLoadAttempt((n) => n + 1)
              }}
              className="ui-button-secondary mt-4"
            >
              Try again
            </button>
          </motion.div>
        ) : !hasData ? (
          <motion.div {...reveal(0.08)} className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-10 text-center">
            <Search className="mx-auto mb-3 h-8 w-8 text-[var(--text-4)]" />
            <p className="text-[var(--type-16)] font-medium text-[var(--text-2)]">No community prices yet</p>
            <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
              Analyze a quote and report what you paid to start the feed.
            </p>
            <Link href="/" className="btn-primary mt-4 inline-flex items-center gap-2">
              Check a quote <ArrowRight className="h-4 w-4" />
            </Link>
          </motion.div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <motion.section {...scrollReveal(0)} className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4 md:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--text-3)]" />
                <h2 className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">Recent prices</h2>
                <span className="ml-auto text-[var(--type-12)] text-[var(--text-4)]">
                  {visiblePrices.length} of {prices.length}
                </span>
              </div>
              <div className="space-y-2">
                {visiblePrices.map((price, i) => (
                  <motion.article
                    key={price.id}
                    {...scrollStagger(i * 0.02)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 transition-all hover:border-[var(--border-strong)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[var(--type-14)] font-medium text-[var(--text-1)]">{price.service_type}</p>
                        <p className="truncate text-[var(--type-12)] text-[var(--text-4)]">
                          {price.city}
                          {price.vendor_name ? ` · ${price.vendor_name}` : ''}
                          {price.created_at ? ` · ${timeAgo(price.created_at)}` : ''}
                        </p>
                      </div>
                      <p className="font-mono text-[var(--type-14)] font-semibold text-[var(--text-1)] flex-shrink-0">
                        {formatPrice(price.price_paid, price.currency)}
                      </p>
                    </div>
                  </motion.article>
                ))}
              </div>
            </motion.section>

            <motion.section {...scrollReveal(0.06)} className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4 md:p-5">
              <div className="mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[var(--text-3)]" />
                <h2 className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">Trend pressure</h2>
                <span className="ml-auto inline-flex items-center gap-1 text-[var(--type-12)] text-[var(--text-4)]">
                  <Clock3 className="h-3.5 w-3.5" />
                  recent
                </span>
              </div>
              {visibleTrends.length === 0 ? (
                <p className="text-[var(--type-14)] text-[var(--text-3)]">No trend points for this domain yet.</p>
              ) : (
                <div className="space-y-3">
                  {visibleTrends.map((trend, i) => (
                    <motion.div key={`${trend.date || 'unknown'}-${i}`} {...scrollStagger(i * 0.02)}>
                      <div className="mb-1 flex items-center justify-between text-[var(--type-12)] text-[var(--text-4)]">
                        <span>
                          {trend.date
                            ? new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : 'Unknown date'}
                        </span>
                        <span className="font-mono">{trend.query_count} reports</span>
                      </div>
                      <MultiplierBar value={trend.avg_multiplier ?? 0} max={maxMultiplier} />
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          </div>
        )}
      </div>
    </section>
  )
}
