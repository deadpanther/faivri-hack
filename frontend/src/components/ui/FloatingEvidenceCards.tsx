'use client'

import { motion } from 'framer-motion'

interface EvidenceCard {
  label: string
  price: string
  verdict: 'overcharge' | 'fair' | 'high'
  domain: string
}

interface FloatingEvidenceCardsProps {
  cards?: EvidenceCard[]
  className?: string
}

const DEFAULT_CARDS: EvidenceCard[] = [
  { label: 'Brake pads', price: '$340', verdict: 'overcharge', domain: 'Auto' },
  { label: 'Oil change', price: '$89', verdict: 'fair', domain: 'Auto' },
  { label: 'Lab panel', price: '$420', verdict: 'high', domain: 'Medical' },
  { label: 'Roof repair', price: '$1,200', verdict: 'overcharge', domain: 'Home' },
  { label: 'Prescription', price: '$34', verdict: 'fair', domain: 'Medical' },
  { label: 'Consultation', price: '$680', verdict: 'high', domain: 'Legal' },
]

const POSITIONS = [
  { top: '8%', left: '4%' },
  { top: '14%', left: '82%' },
  { top: '50%', left: '2%' },
  { top: '58%', left: '86%' },
  { top: '30%', left: '12%' },
  { top: '38%', left: '78%' },
]

const VERDICT_STYLES: Record<EvidenceCard['verdict'], { tint: string; label: string }> = {
  overcharge: { tint: 'var(--red)', label: 'Overcharge' },
  fair: { tint: 'var(--green)', label: 'Fair' },
  high: { tint: 'var(--amber)', label: 'High' },
}

export default function FloatingEvidenceCards({
  cards = DEFAULT_CARDS,
  className = '',
}: FloatingEvidenceCardsProps) {
  const items = cards.slice(0, 6)
  if (items.length === 0) return null

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      {items.map((card, index) => {
        const pos = POSITIONS[index % POSITIONS.length]
        const { tint, label } = VERDICT_STYLES[card.verdict]
        const floatY = index % 2 === 0 ? -12 : 12
        const floatX = index % 2 === 0 ? 8 : -8
        return (
          <motion.div
            key={`${card.label}-${index}`}
            className="absolute motion-reduce:hidden"
            style={pos}
            initial={{ opacity: 0, y: 10, scale: 0.92 }}
            animate={{
              opacity: [0.35, 0.62, 0.35],
              y: [0, floatY, 0],
              x: [0, floatX, 0],
              rotate: [0, index % 2 === 0 ? 1.5 : -1.5, 0],
            }}
            transition={{
              duration: 10 + index * 1.2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: index * 0.4,
            }}
          >
            <div
              className="flex min-w-[132px] items-center gap-2 rounded-xl border bg-[var(--warm-bg)] px-3 py-2 shadow-[0_4px_14px_rgba(0,0,0,0.05)]"
              style={{ borderColor: `color-mix(in srgb, ${tint} 30%, var(--border))` }}
            >
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: tint, boxShadow: `0 0 8px color-mix(in srgb, ${tint} 55%, transparent)` }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold leading-none text-[var(--text-1)]">
                  {card.label} <span className="font-mono">· {card.price}</span>
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: tint }}>
                  {label}
                </p>
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
