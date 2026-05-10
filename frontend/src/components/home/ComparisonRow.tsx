'use client'

import { motion } from 'framer-motion'
import { Wrench, Pill, Home, Scale } from 'lucide-react'

import { scrollReveal, scrollStagger } from '@/lib/motion'
import SplitText from '@/components/ui/SplitText'

type Row = {
  icon: typeof Wrench
  domain: string
  example: string
  typical: number
  fair: number
  savings: number
}

const ROWS: Row[] = [
  { icon: Wrench, domain: 'Auto Repair',   example: 'Brake pads + rotors',     typical: 740,  fair: 400,  savings: 340 },
  { icon: Pill,   domain: 'Medical',        example: 'Out-of-network MRI',      typical: 2450, fair: 1100, savings: 1350 },
  { icon: Home,   domain: 'Home Services', example: 'Water heater install',    typical: 2100, fair: 1650, savings: 450 },
  { icon: Scale,  domain: 'Legal',          example: 'LLC formation + filing',  typical: 1800, fair: 900,  savings: 900 },
]

const formatUsd = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export default function ComparisonRow() {
  const maxTypical = Math.max(...ROWS.map((r) => r.typical))

  return (
    <section className="ui-section">
      <div className="ui-container">
        <motion.div {...scrollReveal(0)} className="text-center mb-10">
          <p className="ui-kicker justify-center">The Gap</p>
          <SplitText
            text="What you pay now vs. what Faivri catches."
            className="ui-title-section mt-3 text-[var(--text-1)]"
            as="h2"
            delay={0.15}
          />
          <p className="ui-lead mt-3 mx-auto text-center">
            Real quotes, real market ranges. The difference is what you get to keep.
          </p>
        </motion.div>

        <div className="mx-auto max-w-3xl space-y-4">
          {ROWS.map((row, i) => {
            const Icon = row.icon
            const typicalW = (row.typical / maxTypical) * 100
            const fairW = (row.fair / maxTypical) * 100

            return (
              <motion.article
                key={row.domain}
                {...scrollStagger(i * 0.08)}
                className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-5"
              >
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)]">
                      <Icon className="h-[18px] w-[18px] text-[var(--text-2)]" />
                    </div>
                    <div>
                      <h3 className="font-display text-[var(--type-16)] font-semibold text-[var(--text-1)]">{row.domain}</h3>
                      <p className="text-[var(--type-12)] text-[var(--text-4)]">{row.example}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-4)]">You save</p>
                    <p className="font-display text-[var(--type-18)] font-bold text-[var(--green-text)]">
                      {formatUsd(row.savings)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
                      <span className="text-[var(--text-4)]">Typical quote</span>
                      <span className="text-[var(--red-text)]">{formatUsd(row.typical)}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-[var(--warm-bg-secondary)]">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${typicalW}%` }}
                        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                        viewport={{ once: true }}
                        className="absolute inset-y-0 left-0 rounded-full bg-[var(--red)]/70"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
                      <span className="text-[var(--text-4)]">Faivri target</span>
                      <span className="text-[var(--green-text)]">{formatUsd(row.fair)}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-[var(--warm-bg-secondary)]">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${fairW}%` }}
                        transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                        viewport={{ once: true }}
                        className="absolute inset-y-0 left-0 rounded-full bg-[var(--green)]"
                      />
                    </div>
                  </div>
                </div>
              </motion.article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
