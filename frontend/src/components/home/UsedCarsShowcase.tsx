'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Car,
  Camera,
  CheckCircle2,
  FileSearch,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

import { scrollReveal } from '@/lib/motion'

interface DiligenceChip {
  id: string
  label: string
  shortLabel: string
  icon: React.ComponentType<{ className?: string }>
  centsImpact: number
  reason: string
  kind: 'penalty' | 'credit'
}

const ASKING_CENTS = 1_450_000
const BASELINE_LOW = 1_320_000
const BASELINE_HIGH = 1_480_000
const BASELINE_MID = (BASELINE_LOW + BASELINE_HIGH) / 2

const CHIPS: DiligenceChip[] = [
  {
    id: 'salvage',
    label: 'Salvage / rebuilt title',
    shortLabel: 'Salvage title',
    icon: ShieldAlert,
    centsImpact: -435_000,
    reason: 'Salvage knocks 30% off market — expect insurance + financing headaches.',
    kind: 'penalty',
  },
  {
    id: 'timing_belt',
    label: 'Timing belt overdue',
    shortLabel: 'Belt overdue',
    icon: AlertTriangle,
    centsImpact: -100_000,
    reason: 'A snap can total the engine. Negotiate the $1,000 belt job off the price.',
    kind: 'penalty',
  },
  {
    id: 'smokes',
    label: 'Smokes on cold start',
    shortLabel: 'Smokes cold',
    icon: AlertTriangle,
    centsImpact: -200_000,
    reason: 'Blue smoke = engine wear. Walk in expecting a $2k+ repair.',
    kind: 'penalty',
  },
  {
    id: 'documented',
    label: 'Documented oil + service history',
    shortLabel: 'Full service log',
    icon: CheckCircle2,
    centsImpact: 50_000,
    reason: 'A full service log buys back $500 of confidence vs. an unknown engine.',
    kind: 'credit',
  },
  {
    id: 'recent_belt',
    label: 'Belt + water pump recently replaced',
    shortLabel: 'New belt',
    icon: CheckCircle2,
    centsImpact: 80_000,
    reason: 'A fresh belt is real value — credit the $800 it would cost you.',
    kind: 'credit',
  },
]

function formatPrice(cents: number): string {
  const dollars = Math.max(0, cents) / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars)
}

export default function UsedCarsShowcase() {
  const [active, setActive] = useState<Set<string>>(new Set(['timing_belt', 'documented']))

  const toggle = (id: string) => {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedChips = CHIPS.filter((c) => active.has(c.id))
  const totalAdjustment = selectedChips.reduce((sum, c) => sum + c.centsImpact, 0)

  const adjustedMid = BASELINE_MID + totalAdjustment
  const adjustedHigh = BASELINE_HIGH + totalAdjustment
  const target = Math.max(0, Math.round(adjustedMid))
  const opening = Math.max(0, Math.round(target * 0.92))
  const walkAway = Math.max(0, Math.round(adjustedHigh * 1.05))

  const overpay = ASKING_CENTS - adjustedHigh
  const overpayPct = useMemo(() => {
    if (adjustedHigh <= 0) return 0
    return Math.max(0, ((ASKING_CENTS - adjustedHigh) / adjustedHigh) * 100)
  }, [adjustedHigh])

  const targetMv = useMotionValue(target)
  const springTarget = useSpring(targetMv, { stiffness: 120, damping: 22, mass: 0.8 })
  const animatedTarget = useTransform(springTarget, (v) => formatPrice(v))

  const overpayMv = useMotionValue(overpayPct)
  const overpaySpring = useSpring(overpayMv, { stiffness: 100, damping: 22 })
  const animatedOverpayPct = useTransform(overpaySpring, (v) => v.toFixed(1))

  useEffect(() => {
    targetMv.set(target)
  }, [target, targetMv])

  useEffect(() => {
    overpayMv.set(overpayPct)
  }, [overpayPct, overpayMv])

  return (
    <section className="ui-section relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 80% 0%, color-mix(in srgb, var(--blue) 10%, transparent), transparent 70%), radial-gradient(50% 60% at 10% 100%, color-mix(in srgb, var(--amber) 10%, transparent), transparent 70%)',
        }}
      />

      <div className="ui-container">
        <motion.div {...scrollReveal(0)} className="text-center mb-10">
          <p className="ui-kicker justify-center">
            <Car className="h-3.5 w-3.5" />
            New: Used Cars
          </p>
          <h2 className="ui-title-section mt-3 text-[var(--text-1)]">
            Don&apos;t buy a used car blind.
          </h2>
          <p className="ui-lead mt-3 mx-auto max-w-2xl text-center">
            Drop a VIN, paste a listing, or upload a screenshot. Answer what you know about
            the car — we move the price target in real time and hand you a script for the lot.
          </p>
        </motion.div>

        <motion.div
          {...scrollReveal(0.05)}
          className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.15fr_0.85fr]"
        >
          {/* ─── LEFT: Interactive playground ─── */}
          <div className="ui-surface-strong perspective-stack relative overflow-hidden rounded-3xl p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border-accent)] bg-[var(--accent-wash)]">
                  <Car className="h-5 w-5 text-[var(--accent-bright)]" />
                </div>
                <div>
                  <p className="text-[var(--type-12)] uppercase tracking-wider text-[var(--text-3)]">
                    2018 Honda Civic EX · 78,000 mi
                  </p>
                  <p className="font-display text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                    Asking {formatPrice(ASKING_CENTS)}
                  </p>
                </div>
              </div>
              <div className="rounded-full border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-1 text-[var(--type-12)] text-[var(--text-3)]">
                Live preview · no signup
              </div>
            </div>

            <p className="mt-5 text-[var(--type-14)] text-[var(--text-3)]">
              Toggle what you&apos;ve learned during the test drive — the target offer
              follows along.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {CHIPS.map((chip) => {
                const Icon = chip.icon
                const isOn = active.has(chip.id)
                const isPenalty = chip.kind === 'penalty'
                const onClass = isPenalty
                  ? 'border-[var(--red-dim)] bg-[color-mix(in_srgb,var(--red-dim)_12%,transparent)] text-[var(--red-dim)]'
                  : 'border-[var(--green-dim)] bg-[color-mix(in_srgb,var(--green-dim)_12%,transparent)] text-[var(--green-dim)]'
                const offClass =
                  'border-[var(--border)] bg-[var(--warm-bg-secondary)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:border-[var(--border-strong)]'
                return (
                  <motion.button
                    key={chip.id}
                    type="button"
                    onClick={() => toggle(chip.id)}
                    whileTap={{ scale: 0.96 }}
                    className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[var(--type-14)] font-medium transition-colors ${
                      isOn ? onClass : offClass
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {chip.shortLabel}
                    <span className="text-[var(--type-12)] opacity-70">
                      {chip.centsImpact < 0 ? '−' : '+'}
                      {formatPrice(Math.abs(chip.centsImpact)).replace(/\.\d+$/, '')}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {/* Target gauge */}
            <div className="mt-7 rounded-2xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="ui-caption">Your target offer</p>
                  <motion.p className="mt-1 font-display text-[var(--type-40)] font-semibold leading-none text-gradient-hero">
                    {animatedTarget}
                  </motion.p>
                </div>
                <div className="text-right">
                  <p className="text-[var(--type-12)] text-[var(--text-3)]">Walk away above</p>
                  <p className="font-mono text-[var(--type-16)] font-semibold text-[var(--red-dim)]">
                    {formatPrice(walkAway)}
                  </p>
                </div>
              </div>

              {/* Visual price track */}
              <div className="mt-5">
                <PriceTrack
                  asking={ASKING_CENTS}
                  baselineLow={BASELINE_LOW}
                  baselineHigh={BASELINE_HIGH}
                  adjustedMid={adjustedMid}
                  walkAway={walkAway}
                />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[var(--type-12)] text-[var(--text-3)]">Open</p>
                  <p className="font-mono text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                    {formatPrice(opening)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--type-12)] text-[var(--text-3)]">Target</p>
                  <p className="font-mono text-[var(--type-16)] font-semibold text-[var(--accent-bright)]">
                    {formatPrice(target)}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--type-12)] text-[var(--text-3)]">Walk</p>
                  <p className="font-mono text-[var(--type-16)] font-semibold text-[var(--red-dim)]">
                    {formatPrice(walkAway)}
                  </p>
                </div>
              </div>
            </div>

            {/* Live overpay indicator */}
            <AnimatePresence>
              {overpay > 0 && (
                <motion.div
                  key="overpay"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--amber-dim)] bg-[color-mix(in_srgb,var(--amber-dim)_10%,transparent)] px-3 py-2 text-[var(--type-14)] text-[var(--text-2)]"
                >
                  <TrendingUp className="h-4 w-4 text-[var(--amber-dim)]" />
                  Asking is{' '}
                  <strong className="font-semibold text-[var(--text-1)]">
                    {formatPrice(overpay)}
                  </strong>{' '}
                  over your adjusted ceiling.{' '}
                  <motion.span className="font-mono text-[var(--text-3)]">
                    (<motion.span>{animatedOverpayPct}</motion.span>%)
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ─── RIGHT: Adjustments stack + CTA ─── */}
          <div className="flex flex-col gap-4">
            <div className="ui-surface perspective-stack rounded-3xl p-5">
              <div className="flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                  <FileSearch className="h-4 w-4 text-[var(--accent-bright)]" />
                  Live adjustments
                </h3>
                <span className="text-[var(--type-12)] text-[var(--text-3)]">
                  {selectedChips.length} active
                </span>
              </div>

              <div className="mt-3 min-h-[170px]">
                <AnimatePresence mode="popLayout">
                  {selectedChips.length === 0 && (
                    <motion.p
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-[var(--type-14)] italic text-[var(--text-3)]"
                    >
                      Click a chip on the left — adjustments will stack here with the dollar
                      reason.
                    </motion.p>
                  )}
                  {selectedChips.map((chip) => {
                    const isPenalty = chip.kind === 'penalty'
                    const Icon = chip.icon
                    return (
                      <motion.div
                        layout
                        key={chip.id}
                        initial={{ opacity: 0, x: 12, scale: 0.98 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: -12, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        className={`mb-2 flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                          isPenalty
                            ? 'border-[var(--red-dim)]/30 bg-[color-mix(in_srgb,var(--red-dim)_6%,transparent)]'
                            : 'border-[var(--green-dim)]/30 bg-[color-mix(in_srgb,var(--green-dim)_6%,transparent)]'
                        }`}
                      >
                        <Icon
                          className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                            isPenalty ? 'text-[var(--red-dim)]' : 'text-[var(--green-dim)]'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                            {chip.label}
                          </p>
                          <p className="mt-0.5 text-[var(--type-12)] text-[var(--text-3)]">
                            {chip.reason}
                          </p>
                        </div>
                        <span
                          className={`font-mono text-[var(--type-14)] font-semibold ${
                            isPenalty ? 'text-[var(--red-dim)]' : 'text-[var(--green-dim)]'
                          }`}
                        >
                          {chip.centsImpact < 0 ? '−' : '+'}
                          {formatPrice(Math.abs(chip.centsImpact))}
                        </span>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>

              {selectedChips.length > 0 && (
                <motion.div
                  layout
                  className="mt-2 flex items-center justify-between rounded-xl bg-[var(--warm-bg-secondary)] px-3 py-2"
                >
                  <span className="text-[var(--type-14)] font-semibold text-[var(--text-2)]">
                    Net move
                  </span>
                  <span
                    className={`font-mono text-[var(--type-16)] font-semibold ${
                      totalAdjustment < 0 ? 'text-[var(--red-dim)]' : 'text-[var(--green-dim)]'
                    }`}
                  >
                    {totalAdjustment < 0 ? '−' : '+'}
                    {formatPrice(Math.abs(totalAdjustment))}
                  </span>
                </motion.div>
              )}
            </div>

            <div className="ui-surface-strong perspective-stack overflow-hidden rounded-3xl p-5">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-accent)] bg-[var(--accent-wash)]">
                  <Camera className="h-4 w-4 text-[var(--accent-bright)]" />
                </div>
                <div className="flex-1">
                  <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                    Skip the typing.
                  </p>
                  <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                    Drop a CarGurus / Marketplace screenshot — we read VIN, year, mileage,
                    asking price, even title status, and pre-fill the form.
                  </p>
                </div>
              </div>

              <Link
                href="/used-cars"
                className="ui-button-primary mt-4 inline-flex w-full items-center justify-center gap-2 !py-3"
              >
                Try it on your next listing
                <ArrowRight className="h-4 w-4" />
              </Link>
              <ul className="mt-3 space-y-1.5 text-[var(--type-12)] text-[var(--text-3)]">
                <li className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-[var(--accent-bright)]" />
                  No quota burned by the screenshot reader
                </li>
                <li className="flex items-center gap-1.5">
                  <TrendingDown className="h-3 w-3 text-[var(--green-dim)]" />
                  Anti-scam playbook ships with every result
                </li>
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ── Visual price track ────────────────────────────────────────────────────

function PriceTrack({
  asking,
  baselineLow,
  baselineHigh,
  adjustedMid,
  walkAway,
}: {
  asking: number
  baselineLow: number
  baselineHigh: number
  adjustedMid: number
  walkAway: number
}) {
  const min = Math.min(baselineLow * 0.6, adjustedMid * 0.85)
  const max = Math.max(asking * 1.08, walkAway * 1.05, baselineHigh * 1.05)

  const pct = (value: number) =>
    `${Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))}%`

  const targetPct = pct(adjustedMid)
  const askingPct = pct(asking)
  const walkPct = pct(walkAway)
  const lowPct = pct(baselineLow)
  const highPct = pct(baselineHigh)

  return (
    <div className="relative h-9">
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--text-3)_18%,transparent)]" />
      {/* Fair range */}
      <motion.div
        layout
        className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--green-dim)_55%,transparent)]"
        style={{ left: lowPct, right: `calc(100% - ${highPct})` }}
      />
      {/* Asking marker */}
      <div
        className="absolute -top-1 h-11 w-[3px] -translate-x-1/2 rounded-full bg-[var(--text-1)]"
        style={{ left: askingPct }}
      >
        <span className="absolute left-1/2 -top-5 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--text-1)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Asking
        </span>
      </div>
      {/* Walk away marker */}
      <div
        className="absolute top-0 h-9 w-[2px] -translate-x-1/2 rounded-full bg-[var(--red-dim)]"
        style={{ left: walkPct }}
      >
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-[var(--red-dim)]">
          Walk
        </span>
      </div>
      {/* Target needle (animated) */}
      <motion.div
        animate={{ left: targetPct }}
        transition={{ type: 'spring', stiffness: 140, damping: 20 }}
        className="absolute -top-2 h-13 w-[3px] -translate-x-1/2 rounded-full bg-[var(--accent-bright)]"
        style={{ height: 44 }}
      >
        <motion.span
          layout
          className="absolute left-1/2 -bottom-6 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--accent-bright)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
        >
          Target
        </motion.span>
      </motion.div>
    </div>
  )
}
