'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Activity, Car, Home as HomeIcon, Pill, Search, Shield, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api, HistoryItemData, PurchaseHistoryItemData, SavingsProfileData } from '@/lib/api'
import { formatPrice } from '@/lib/constants'
import { scrollReveal, scrollStagger } from '@/lib/motion'
import SavingsProfile from '@/components/savings/SavingsProfile'
import { SkeletonListPage } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'

const PAGE_SIZE = 10

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  auto: Wrench,
  medical: Pill,
  home: HomeIcon,
  legal: Shield,
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

const DOMAIN_FILTERS = [
  { label: 'All', value: null },
  { label: 'Auto', value: 'auto' },
  { label: 'Medical', value: 'medical' },
  { label: 'Home', value: 'home' },
  { label: 'Legal', value: 'legal' },
]

type VaultTab = 'quotes' | 'cars'

export default function VaultPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<VaultTab>('quotes')
  const [history, setHistory] = useState<HistoryItemData[]>([])
  const [purchases, setPurchases] = useState<PurchaseHistoryItemData[]>([])
  const [profile, setProfile] = useState<SavingsProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [historyAttempt, setHistoryAttempt] = useState(0)
  const [filterDomain, setFilterDomain] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setHistoryError(null)
    setProfileLoading(true)
    setProfileError(null)

    Promise.all([
      api.getHistory().catch((err) => {
        if (cancelled) return [] as HistoryItemData[]
        const msg = err instanceof Error ? err.message : 'Could not load your vault. Please try again.'
        setHistoryError(msg)
        return [] as HistoryItemData[]
      }),
      // Purchase history is optional — failing to load it shouldn't block the
      // main quotes view from rendering.
      api.getPurchaseHistory().catch(() => [] as PurchaseHistoryItemData[]),
    ])
      .then(([quoteRows, purchaseRows]) => {
        if (cancelled) return
        setHistory(quoteRows)
        setPurchases(purchaseRows)
        setHasMore(quoteRows.length >= PAGE_SIZE)
        setPage(1)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    api.getSavingsProfile()
      .then((data) => {
        if (!cancelled) setProfile(data)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Could not load your savings profile.'
        setProfileError(msg)
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [historyAttempt])

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      if (filterDomain && item.domain !== filterDomain) return false
      return true
    })
  }, [history, filterDomain])

  async function handleLoadMore() {
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const nextItems = await api.getHistory(page + 1)
      // Only a short page means we've hit the end — a fetch *failure* is a
      // separate signal that we now surface via loadMoreError + retry button
      // instead of collapsing both into "no more results" (FE-P1-05).
      if (nextItems.length < PAGE_SIZE) setHasMore(false)
      setHistory((prev) => [...prev, ...nextItems])
      setPage((prev) => prev + 1)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not load more history. Please try again.'
      setLoadMoreError(msg)
      toast(msg, 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) {
    return <SkeletonListPage rows={6} />
  }

  if (historyError && history.length === 0) {
    return (
      <section className="ui-section">
        <div className="ui-container max-w-md mx-auto text-center py-20">
          <p className="text-[var(--type-16)] text-[var(--text-2)]">{historyError}</p>
          <button
            onClick={() => setHistoryAttempt((n) => n + 1)}
            className="ui-button-secondary mt-4"
          >
            Try again
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-4xl mx-auto space-y-6">
        {/* ── Savings Profile Hero ── */}
        <SavingsProfile data={profile} loading={profileLoading} />

        {/* ── Tabs ── */}
        <motion.div {...scrollReveal(0)} className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-1 w-fit">
          <button
            onClick={() => setActiveTab('quotes')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[var(--type-12)] font-medium transition-colors ${
              activeTab === 'quotes'
                ? 'bg-[var(--surface-up)] text-[var(--text-1)] shadow-sm'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            <Activity className="h-3.5 w-3.5" /> Quotes
            <span className="ml-1 rounded-full bg-[var(--warm-bg-secondary)] px-1.5 text-[10px] text-[var(--text-3)]">
              {history.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('cars')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[var(--type-12)] font-medium transition-colors ${
              activeTab === 'cars'
                ? 'bg-[var(--surface-up)] text-[var(--text-1)] shadow-sm'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            <Car className="h-3.5 w-3.5" /> Car Checks
            <span className="ml-1 rounded-full bg-[var(--warm-bg-secondary)] px-1.5 text-[10px] text-[var(--text-3)]">
              {purchases.length}
            </span>
          </button>
        </motion.div>

        {/* ── Filters (quotes only) ── */}
        {activeTab === 'quotes' && (
          <motion.div {...scrollReveal(0)} className="flex flex-wrap items-center gap-2">
            {DOMAIN_FILTERS.map((filter) => (
              <button
                key={filter.label}
                onClick={() => setFilterDomain(filter.value)}
                className={`rounded-full border px-3 py-1.5 text-[var(--type-12)] font-medium transition-colors ${
                  filterDomain === filter.value
                    ? 'border-[var(--border-accent)] bg-[var(--accent-wash)] text-[var(--blue)]'
                    : 'border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-2)]'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </motion.div>
        )}

        {/* ── Car Checks tab ── */}
        {activeTab === 'cars' && (
          <motion.section {...scrollReveal(0.05)}>
            <div className="mb-3 flex items-center gap-2">
              <Car className="h-4 w-4 text-[var(--text-3)]" />
              <h2 className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">Saved car checks</h2>
            </div>
            {purchases.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-10 text-center">
                <Car className="mx-auto mb-3 h-8 w-8 text-[var(--text-4)]" />
                <p className="text-[var(--type-16)] font-medium text-[var(--text-2)]">No car checks yet</p>
                <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                  Run a used-car analysis from /used-cars to start building your saved deals.
                </p>
                <button onClick={() => router.push('/used-cars')} className="btn-primary mt-4 inline-flex items-center gap-2">
                  <Car className="h-4 w-4" /> Check a car
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {purchases.map((p, index) => {
                  const verdictColor =
                    p.asking_price_verdict === 'overcharge'
                      ? 'border-[var(--red)]/25'
                      : p.asking_price_verdict === 'fair'
                        ? 'border-[var(--green)]/25'
                        : 'border-[var(--amber)]/25'
                  const verdictTextColor =
                    p.asking_price_verdict === 'overcharge'
                      ? 'text-[var(--red)]'
                      : p.asking_price_verdict === 'fair'
                        ? 'text-[var(--green)]'
                        : 'text-[var(--amber)]'
                  const targetSavings = p.target_offer && p.asking_price && p.asking_price > p.target_offer
                    ? p.asking_price - p.target_offer
                    : 0
                  return (
                    <motion.button
                      key={p.id}
                      {...scrollStagger(index * 0.04)}
                      whileHover={{ y: -2, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}
                      whileTap={{ scale: 0.985 }}
                      onClick={() => router.push(`/result/purchase/${p.id}`)}
                      className={`glass w-full cursor-pointer rounded-xl border ${verdictColor} p-4 text-left transition-all hover:border-[var(--border-accent)] hover:bg-[rgba(55,53,47,0.04)]`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Car className="h-4 w-4 flex-shrink-0 text-[var(--blue)]" />
                            <span className="truncate text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                              {p.year} {p.make} {p.model}
                            </span>
                          </div>
                          <p className="mt-1 text-[var(--type-12)] text-[var(--text-4)]">
                            {p.mileage_miles?.toLocaleString() || '—'} mi · Ask {formatPrice(p.asking_price, p.currency)}
                            {p.city ? ` · ${p.city}` : ''} · {timeAgo(p.created_at)}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {p.overcharge_multiplier ? (
                            <span className={`font-mono text-[var(--type-14)] font-bold ${verdictTextColor}`}>
                              {p.overcharge_multiplier.toFixed(1)}x
                            </span>
                          ) : null}
                          {targetSavings > 0 && (
                            <p className="text-[var(--type-12)] text-[var(--green-text)]">
                              Aim {formatPrice(targetSavings, p.currency)} less
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            )}
          </motion.section>
        )}

        {/* ── Quotes tab — History Log ── */}
        {activeTab === 'quotes' && (
        <motion.section {...scrollReveal(0.05)}>
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--text-3)]" />
            <h2 className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">History</h2>
          </div>
          {filteredHistory.length === 0 ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-10 text-center">
              <Search className="mx-auto mb-3 h-8 w-8 text-[var(--text-4)]" />
              <p className="text-[var(--type-16)] font-medium text-[var(--text-2)]">
                {history.length === 0 ? 'No analyses yet' : 'No results match your filter'}
              </p>
              <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                {history.length === 0 ? 'Check your first quote to start building your savings history.' : 'Try a different filter.'}
              </p>
              {history.length === 0 && (
                <button onClick={() => router.push('/')} className="btn-primary mt-4 inline-flex items-center gap-2">
                  <Search className="h-4 w-4" /> Check a quote
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredHistory.map((item, index) => {
                const Icon = DOMAIN_ICONS[item.domain] || Wrench
                const savingsValue = item.quoted_price && item.fair_price_high ? Math.max(item.quoted_price - item.fair_price_high, 0) : 0
                const verdictColor =
                  item.verdict === 'overcharge'
                    ? 'border-[var(--red)]/25'
                    : item.verdict === 'fair'
                      ? 'border-[var(--green)]/25'
                      : 'border-[var(--amber)]/25'
                const verdictTextColor =
                  item.verdict === 'overcharge'
                    ? 'text-[var(--red)]'
                    : item.verdict === 'fair'
                      ? 'text-[var(--green)]'
                      : 'text-[var(--amber)]'

                return (
                  <motion.button
                    key={item.id}
                    {...scrollStagger(index * 0.04)}
                    whileHover={{ y: -2, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => router.push(`/result/${item.id}`)}
                    className={`glass w-full cursor-pointer rounded-xl border ${verdictColor} p-4 text-left transition-all hover:border-[var(--border-accent)] hover:bg-[rgba(55,53,47,0.04)]`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 flex-shrink-0 text-[var(--blue)]" />
                          <span className="truncate text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                            {item.input_text}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--type-12)] text-[var(--text-4)]">
                          {item.location_city} · {timeAgo(item.created_at)}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {item.overcharge_multiplier ? (
                          <span className={`font-mono text-[var(--type-14)] font-bold ${verdictTextColor}`}>
                            {item.overcharge_multiplier.toFixed(1)}x
                          </span>
                        ) : null}
                        {savingsValue > 0 && (
                          <p className="text-[var(--type-12)] text-[var(--green-text)]">
                            Save {formatPrice(savingsValue, item.currency)}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          )}
        </motion.section>
        )}

        {/* ── Load More (quotes tab) ── */}
        {activeTab === 'quotes' && hasMore && history.length >= PAGE_SIZE && (
          <div className="flex flex-col items-center gap-2 pt-2">
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-secondary"
            >
              {loadingMore ? 'Loading...' : loadMoreError ? 'Retry loading more' : 'Load more'}
            </button>
            {loadMoreError && (
              <p className="text-[var(--type-12)] text-[var(--red-text)]">{loadMoreError}</p>
            )}
          </div>
        )}

        {/* Soft notice when the savings profile endpoint errors — the rest of
           the page is still usable so we don't want a full-page error state. */}
        {profileError && !profileLoading && !profile && (
          <p className="text-center text-[var(--type-12)] text-[var(--text-4)]">
            Savings summary unavailable. Showing history only.
          </p>
        )}
      </div>
    </section>
  )
}
