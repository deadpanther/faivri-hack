'use client'

import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  Zap,
  Search,
  Sparkles,
} from 'lucide-react'

import { scaleIn } from '@/lib/motion'

type DemoScene = {
  query: string
  domain: string
  quoted: number
  fair: [number, number]
  verdict: 'fair' | 'high' | 'very_high'
  confidence: number
  savings: number
  sources: string[]
}

const SCENES: DemoScene[] = [
  {
    query: 'Front brake pads replacement — 2020 Honda Civic',
    domain: 'Auto',
    quoted: 740,
    fair: [320, 480],
    verdict: 'very_high',
    confidence: 91,
    savings: 260,
    sources: ['repairpal.com', 'yelp.com', 'carfax.com', '+4 sources'],
  },
  {
    query: 'MRI — lower back, out-of-network',
    domain: 'Medical',
    quoted: 2450,
    fair: [800, 1400],
    verdict: 'very_high',
    confidence: 87,
    savings: 1050,
    sources: ['fairhealth.org', 'healthcarebluebook.com', 'mdsave.com', '+5 sources'],
  },
  {
    query: 'Water heater replacement — 50 gal gas',
    domain: 'Home',
    quoted: 2100,
    fair: [1400, 1900],
    verdict: 'high',
    confidence: 82,
    savings: 200,
    sources: ['homeadvisor.com', 'angi.com', 'homedepot.com', '+3 sources'],
  },
]

const verdictStyle: Record<DemoScene['verdict'], { bg: string; fg: string; label: string }> = {
  fair: { bg: 'var(--green-wash)', fg: 'var(--green-text)', label: 'Fair price' },
  high: { bg: 'var(--amber-wash)', fg: 'var(--amber-text)', label: 'Above market' },
  very_high: { bg: 'var(--red-wash)', fg: 'var(--red-text)', label: 'Overcharge detected' },
}

function useRotation<T>(items: T[], intervalMs: number): number {
  const [i, setI] = useState(0)
  useEffect(() => {
    // Respect reduced-motion: pause auto-rotation so the page isn't
    // reflowing under users who opted out of animation.
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      if (mq.matches) return
    }
    const id = setInterval(() => setI((p) => (p + 1) % items.length), intervalMs)
    return () => clearInterval(id)
  }, [items.length, intervalMs])
  return i
}

const formatUsd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function HeroDemoTile() {
  const idx = useRotation(SCENES, 5000)
  const scene = SCENES[idx]
  const vStyle = verdictStyle[scene.verdict]
  const overpayPct = Math.round(((scene.quoted - ((scene.fair[0] + scene.fair[1]) / 2)) / scene.quoted) * 100)

  return (
    <motion.div {...scaleIn(0.9)} className="relative mx-auto mt-12 w-full max-w-4xl">
      <div className="absolute -inset-x-6 -inset-y-4 rounded-[2rem] bg-gradient-to-b from-[var(--warm-bg-secondary)] to-transparent opacity-60 blur-2xl" aria-hidden />

      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.12)]">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--red)]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--amber)]/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--green)]/70" />
          <div className="ml-3 flex flex-1 items-center gap-2 rounded-md bg-white/90 px-3 py-1 text-[11px] text-[var(--text-4)]">
            <Search className="h-3 w-3" />
            faivri.com/analyze
          </div>
          <div className="hidden items-center gap-1.5 rounded-full bg-[var(--green-wash)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--green-text)] sm:inline-flex">
            <span className="h-1.5 w-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-[var(--green)]" />
            Live market data
          </div>
        </div>

        {/* Content */}
        <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
          {/* Query + verdict panel */}
          <motion.div
            key={`q-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="border-b border-[var(--border)] p-6 md:border-b-0 md:border-r"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-4)]">
              {scene.domain} · Confidence {scene.confidence}%
            </p>
            <h3 className="mt-3 font-display text-[var(--type-18)] font-semibold leading-snug text-[var(--text-1)]">
              {scene.query}
            </h3>

            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-mono text-[var(--type-14)] text-[var(--text-4)]">Quoted</span>
              <span className="font-display text-[28px] font-bold text-[var(--text-1)]">
                {formatUsd(scene.quoted)}
              </span>
            </div>

            <div
              className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: vStyle.bg, color: vStyle.fg }}
            >
              {scene.verdict === 'fair' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {vStyle.label} · +{overpayPct}%
            </div>

            <div className="mt-6 flex items-center gap-2 rounded-xl border border-[var(--green)]/20 bg-[var(--green-wash)] px-4 py-3">
              <TrendingDown className="h-4 w-4 text-[var(--green-text)]" />
              <div className="flex-1">
                <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--green-text)]">
                  Projected savings
                </p>
                <p className="font-display text-[22px] font-bold text-[var(--green-text)]">
                  {formatUsd(scene.savings)}
                </p>
              </div>
              <Sparkles className="h-4 w-4 text-[var(--green-text)]" />
            </div>
          </motion.div>

          {/* Fair range + evidence panel */}
          <motion.div
            key={`r-${idx}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="bg-[var(--warm-bg-secondary)] p-6"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-4)]">
              Fair market range
            </p>
            <p className="mt-3 font-display text-[22px] font-bold text-[var(--text-1)]">
              {formatUsd(scene.fair[0])} <span className="text-[var(--text-4)] font-normal">–</span>{' '}
              {formatUsd(scene.fair[1])}
            </p>

            {/* Range bar */}
            <div className="relative mt-5 h-2 w-full rounded-full bg-[var(--warm-bg-tertiary)]">
              <div
                className="absolute inset-y-0 rounded-full bg-[var(--green)]"
                style={{ left: '12%', right: '45%' }}
              />
              <motion.div
                initial={{ x: -4, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className="absolute -top-1 h-4 w-1.5 rounded-full bg-[var(--red)] shadow-md"
                style={{ right: '6%' }}
              />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)]">
              <span>Below market</span>
              <span>Your quote</span>
            </div>

            {/* Evidence chips */}
            <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-4)]">
              Signals used
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {scene.sources.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-[var(--border)] bg-white px-2.5 py-1 font-mono text-[10px] text-[var(--text-3)]"
                >
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-6 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2">
              <Zap className="h-3.5 w-3.5 text-[var(--amber)]" />
              <span className="font-mono text-[11px] text-[var(--text-3)]">
                Analyzed in <strong className="text-[var(--text-1)]">23s</strong>
              </span>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Scene pager */}
      <div className="mt-4 flex items-center justify-center gap-1.5">
        {SCENES.map((_, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === idx ? 24 : 6,
              background: i === idx ? 'var(--text-1)' : 'var(--border)',
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}
