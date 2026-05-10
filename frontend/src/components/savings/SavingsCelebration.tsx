'use client'

import { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, PartyPopper, Shield, TrendingDown } from 'lucide-react'

import { formatPrice } from '@/lib/constants'
import { DUR, EASE, fade } from '@/lib/motion'

interface SavingsCelebrationProps {
  savings: number
  serviceName: string
  locationCity: string
  outcome: string
  streak?: {
    monthly_dodged: number
    lifetime_saved: number
    level: string
    milestone_unlocked: string | null
  } | null
  onClose: () => void
}

const OUTCOME_BADGES: Record<string, { label: string; colorClass: string }> = {
  negotiated_down: { label: 'Negotiation Win', colorClass: 'outcome-badge--green' },
  found_alternative: { label: 'Smart Shopper', colorClass: 'outcome-badge--blue' },
  walked_away: { label: 'Walked Away, Saved Big', colorClass: 'outcome-badge--amber' },
  paid_full: { label: 'Paid Full Price', colorClass: 'outcome-badge--neutral' },
}

const CONFETTI_COLORS = [
  '#f43f5e', '#a855f7', '#3b82f6', '#22c55e',
  '#eab308', '#f97316', '#06b6d4', '#ec4899',
]
const PARTICLE_COUNT = 80
const GRAVITY = 0.12
const DRAG = 0.98

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  color: string
  rotation: number
  rotationSpeed: number
}

function createParticles(canvasWidth: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * canvasWidth,
    y: -20,
    vx: (Math.random() - 0.5) * 8,
    vy: Math.random() * 4 + 2,
    w: Math.random() * 8 + 4,
    h: Math.random() * 6 + 3,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    rotation: Math.random() * 360,
    rotationSpeed: (Math.random() - 0.5) * 12,
  }))
}

export default function SavingsCelebration({
  savings,
  serviceName,
  locationCity,
  outcome,
  streak,
  onClose,
}: SavingsCelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const particlesRef = useRef<Particle[]>([])

  const showConfetti = savings > 0

  const runConfetti = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    particlesRef.current = createParticles(canvas.width)

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      let aliveCount = 0
      for (const particle of particlesRef.current) {
        particle.vy += GRAVITY
        particle.vx *= DRAG
        particle.x += particle.vx
        particle.y += particle.vy
        particle.rotation += particle.rotationSpeed

        if (particle.y > canvas.height + 40) continue
        aliveCount++

        ctx.save()
        ctx.translate(particle.x, particle.y)
        ctx.rotate((particle.rotation * Math.PI) / 180)
        ctx.fillStyle = particle.color
        ctx.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h)
        ctx.restore()
      }

      if (aliveCount > 0) {
        animationRef.current = requestAnimationFrame(animate)
      }
    }

    animationRef.current = requestAnimationFrame(animate)
  }, [])

  useEffect(() => {
    if (!showConfetti) return

    runConfetti()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [showConfetti, runConfetti])

  const badge = OUTCOME_BADGES[outcome] ?? OUTCOME_BADGES.paid_full

  return (
    <AnimatePresence>
      <motion.div
        className="celebration-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DUR.normal }}
      >
        {showConfetti && (
          <canvas
            ref={canvasRef}
            className="confetti-canvas"
            aria-hidden="true"
          />
        )}

        <motion.div
          className="celebration-card glass-strong"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          transition={{ duration: DUR.slow, ease: EASE.out, delay: 0.1 }}
        >
          {showConfetti ? (
            <>
              <PartyPopper className="mx-auto h-10 w-10 text-[var(--blue)]" />

              <p className="mt-4 text-[var(--type-14)] text-[var(--text-3)]">
                {serviceName} in {locationCity}
              </p>

              <p className="savings-amount counter-animate mt-2">
                You saved {formatPrice(savings)}!
              </p>

              <span className={`outcome-badge ${badge.colorClass} mt-4`}>
                {badge.label}
              </span>

              {streak && (
                <div className="mt-5">
                  <span className="streak-badge">
                    <TrendingDown className="inline-block h-4 w-4 mr-1.5 align-middle" />
                    {streak.monthly_dodged} overcharges dodged this month
                  </span>
                  <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                    Lifetime saved: {formatPrice(streak.lifetime_saved)}
                    {' '}&middot; Level: {streak.level}
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <Shield className="mx-auto h-10 w-10 text-[var(--text-3)]" />

              <p className="mt-4 text-[var(--type-24)] font-semibold text-[var(--text-1)]">
                Thanks for reporting back.
              </p>

              <p className="mt-2 text-[var(--type-14)] text-[var(--text-3)]">
                Your feedback helps improve pricing intelligence for everyone.
              </p>

              <span className={`outcome-badge ${badge.colorClass} mt-4`}>
                {badge.label}
              </span>
            </>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/vault"
              className="ui-button-primary inline-flex items-center justify-center gap-2 px-5 py-3"
            >
              View My Savings
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-5 py-3 text-[var(--type-14)] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--border-accent)]"
            >
              Analyze Another Quote
            </Link>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="mt-4 text-[var(--type-14)] text-[var(--text-4)] underline-offset-2 hover:underline"
          >
            Close
          </button>
        </motion.div>

        {streak?.milestone_unlocked && (
          <motion.div
            className="milestone-toast"
            {...fade}
            transition={{ duration: DUR.normal, delay: 1.2 }}
          >
            <PartyPopper className="h-5 w-5 text-[var(--blue)]" />
            <span>{streak.milestone_unlocked}</span>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
