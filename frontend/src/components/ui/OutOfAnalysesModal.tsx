'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Sparkles, X, Zap } from 'lucide-react'

import { getBoostCheckout, type QuotaExhaustedDetail } from '@/lib/api'

interface Props {
  detail: QuotaExhaustedDetail | null
  onClose: () => void
}

function formatResetDate(iso: string | null): string {
  if (!iso) return 'next cycle'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return 'next cycle'
  }
}

function centsToUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function OutOfAnalysesModal({ detail, onClose }: Props) {
  const [boostLoading, setBoostLoading] = useState(false)
  const [boostError, setBoostError] = useState<string | null>(null)

  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, onClose])

  if (!detail) return null

  const boostPrice = detail.boost?.price_cents ?? 499
  const boostCredits = detail.boost?.credits_per_pack ?? 10
  const resetLabel = formatResetDate(detail.reset_at)
  const planLabel = detail.plan.charAt(0).toUpperCase() + detail.plan.slice(1)

  const handleBuyBoost = async () => {
    setBoostLoading(true)
    setBoostError(null)
    try {
      const res = await getBoostCheckout()
      if (!res.configured || !res.checkout_url) {
        setBoostError('Boost Pack is not set up yet. Please upgrade your plan.')
        return
      }
      window.open(res.checkout_url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setBoostError(err instanceof Error ? err.message : 'Could not start checkout.')
    } finally {
      setBoostLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        key="oom-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 shadow-[var(--shadow-lg)]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--warm-bg-secondary)] hover:text-[var(--text-1)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)]">
              <Zap className="h-4 w-4 text-[var(--amber)]" />
            </span>
            <p className="text-[var(--type-12)] font-semibold uppercase tracking-[0.08em] text-[var(--text-4)]">
              Out of analyses
            </p>
          </div>

          <h2 className="mt-3 font-display text-[clamp(1.25rem,2.6vw,1.5rem)] font-semibold text-[var(--text-1)]">
            You&apos;ve used all your {planLabel} analyses this month
          </h2>
          <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
            Your plan resets on <span className="font-semibold text-[var(--text-2)]">{resetLabel}</span>.
            Keep going today with a Boost Pack, or move up a plan for more headroom every month.
          </p>

          <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                  Boost Pack
                </p>
                <p className="mt-0.5 text-[var(--type-13)] text-[var(--text-3)]">
                  {boostCredits} extra analyses · one-time · never expires
                </p>
              </div>
              <p className="font-display text-[var(--type-18)] font-bold text-[var(--text-1)]">
                {centsToUSD(boostPrice)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleBuyBoost}
              disabled={boostLoading}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--text-1)] px-4 py-2 text-[var(--type-14)] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
            >
              {boostLoading ? 'Opening checkout…' : 'Get Boost Pack'}
              <Sparkles className="h-4 w-4" />
            </button>
            {boostError && (
              <p className="mt-2 text-[var(--type-12)] text-[var(--red)]">{boostError}</p>
            )}
          </div>

          <Link
            href="/pricing"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-2 text-[var(--type-14)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
          >
            See plans
            <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
