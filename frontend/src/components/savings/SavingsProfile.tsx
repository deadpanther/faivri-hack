'use client'

import { motion } from 'framer-motion'
import { TrendingUp, Shield, Flame, Award } from 'lucide-react'

import { formatPrice, formatPriceShort } from '@/lib/constants'
import { reveal } from '@/lib/motion'
import AnimatedCounter from '@/components/ui/AnimatedCounter'
import ShareBar from '@/components/savings/ShareBar'

export interface SavingsProfileData {
  lifetime_saved: number
  potential_saved: number
  monthly_streak: number
  total_queries: number
  overcharges_found: number
  level: string
  level_label: string
  next_level: string
  next_level_label: string
  next_level_threshold: number
  progress_to_next: number
  currency: string
}

interface SavingsProfileProps {
  data: SavingsProfileData | null
  loading: boolean
}

export default function SavingsProfile({ data, loading }: SavingsProfileProps) {
  if (loading) {
    return (
      <div className="glass-strong rounded-3xl p-8 text-center animate-pulse">
        <div className="mx-auto h-12 w-48 rounded-lg bg-[var(--warm-bg-secondary)]" />
        <div className="mx-auto mt-4 h-6 w-32 rounded-lg bg-[var(--warm-bg-secondary)]" />
        <div className="mx-auto mt-6 h-3 w-64 rounded-full bg-[var(--warm-bg-secondary)]" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="glass-strong rounded-3xl p-8 text-center">
        <p className="text-[var(--text-4)]">No savings data available yet.</p>
      </div>
    )
  }

  const confirmedFormatted = formatPrice(data.lifetime_saved, data.currency)
  const potentialFormatted = formatPrice(data.potential_saved, data.currency)
  const lifetimeFormatted = formatPrice(data.lifetime_saved, data.currency)
  const amountToNext = data.next_level_threshold - data.lifetime_saved
  const amountToNextFormatted = formatPriceShort(
    Math.max(amountToNext, 0),
    data.currency,
  )

  return (
    <motion.div
      {...reveal(0)}
      className="glass-strong rounded-3xl p-6 md:p-8 text-center"
    >
      {/* Lifetime savings hero */}
      <motion.div {...reveal(0.04)}>
        <p className="savings-amount text-gradient-green text-4xl font-bold md:text-5xl">
          <AnimatedCounter
            target={data.lifetime_saved / 100}
            prefix="$"
            duration={1.5}
            formatFn={(v) => v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          />
        </p>
        <p className="mt-1 text-sm text-[var(--text-4)]">Lifetime Savings</p>
      </motion.div>

      {/* Level badge */}
      <motion.div
        {...reveal(0.08)}
        className="mt-4 inline-flex items-center gap-2"
      >
        <Award className="h-5 w-5 text-amber-400" />
        <span className="text-lg font-semibold text-[var(--text-1)]">
          {data.level_label}
        </span>
      </motion.div>

      {/* Progress bar */}
      <motion.div {...reveal(0.12)} className="mx-auto mt-4 max-w-sm">
        <div className="level-progress h-3 w-full overflow-hidden rounded-full bg-[var(--warm-bg-secondary)]">
          <div
            className="level-progress-fill h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-700"
            style={{ width: `${data.progress_to_next}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-[var(--text-3)]">
          {amountToNextFormatted} to {data.next_level_label}
        </p>
      </motion.div>

      {/* Confirmed vs Potential */}
      <motion.p {...reveal(0.16)} className="mt-4 text-sm text-[var(--text-2)]">
        Confirmed: {confirmedFormatted} | Potential: {potentialFormatted}
      </motion.p>

      {/* Streak badge */}
      <motion.div {...reveal(0.2)} className="mt-4">
        <span className="streak-badge inline-flex items-center gap-1.5 rounded-full bg-orange-500/15 px-3 py-1 text-sm font-medium text-[var(--amber-text)]">
          <Flame className="h-4 w-4" />
          {data.monthly_streak} dodged this month
        </span>
      </motion.div>

      {/* Stat grid */}
      <motion.div
        {...reveal(0.24)}
        className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3"
      >
        <div className="ui-stat rounded-xl p-3 text-center">
          <TrendingUp className="mx-auto h-5 w-5 text-emerald-400" />
          <p className="mt-1 text-lg font-bold text-[var(--text-1)]">
            {data.total_queries}
          </p>
          <p className="text-xs text-[var(--text-4)]">Queries</p>
        </div>

        <div className="ui-stat rounded-xl p-3 text-center">
          <Shield className="mx-auto h-5 w-5 text-blue-400" />
          <p className="mt-1 text-lg font-bold text-[var(--text-1)]">
            {data.overcharges_found}
          </p>
          <p className="text-xs text-[var(--text-4)]">Overcharges Found</p>
        </div>

        <div className="ui-stat col-span-2 rounded-xl p-3 text-center md:col-span-1">
          <Flame className="mx-auto h-5 w-5 text-orange-400" />
          <p className="mt-1 text-lg font-bold text-[var(--text-1)]">
            {data.monthly_streak}
          </p>
          <p className="text-xs text-[var(--text-4)]">Monthly Streak</p>
        </div>
      </motion.div>

      <motion.div {...reveal(0.28)}>
        <ShareBar
          lifetimeSavedCents={data.lifetime_saved}
          currency={data.currency}
          levelLabel={data.level_label}
          overchargesFound={data.overcharges_found}
        />
      </motion.div>
    </motion.div>
  )
}
