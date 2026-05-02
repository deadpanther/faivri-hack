'use client'

import { motion } from 'framer-motion'

interface LivePulseProps {
  label?: string
  tint?: string
  className?: string
}

export default function LivePulse({
  label = 'Live',
  tint = 'var(--green)',
  className = '',
}: LivePulseProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${className}`}
      style={{
        borderColor: `color-mix(in srgb, ${tint} 28%, var(--border))`,
        background: `color-mix(in srgb, ${tint} 8%, var(--warm-bg-secondary))`,
        color: tint,
      }}
    >
      <span className="relative inline-flex h-1.5 w-1.5">
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full motion-reduce:hidden"
          style={{ background: tint }}
          animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.35, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="relative rounded-full" style={{ background: tint, width: '100%', height: '100%' }} />
      </span>
      {label}
    </span>
  )
}
