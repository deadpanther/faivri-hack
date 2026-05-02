'use client'

import { useRef } from 'react'
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import type { ComponentType, SVGProps } from 'react'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

export type Step = {
  icon: IconComponent
  num: string
  title: string
  desc: string
}

interface Props {
  steps: Step[]
}

/**
 * Animated five-step rail.
 *
 * When the section enters view, a glowing pulse travels top-to-bottom down
 * the left rail. As it passes each icon, the icon lights up (scale bounce,
 * color accent, inner glow), and its row slides in from the left. The rail
 * segment above the pulse is filled with an accent gradient; below, it's
 * a muted border. The result: the reader sees the "flow" of the five steps
 * physically walking through them, not just a static list fading in.
 */
export default function HowItWorksSteps({ steps }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, margin: '-80px' })

  const PER_STEP = 0.45
  const STEP_DELAY = 0.15

  return (
    <div ref={containerRef} className="relative max-w-2xl mx-auto">
      {/* Rail background (muted) */}
      <div
        aria-hidden
        className="absolute left-[22px] top-6 bottom-6 w-[2px] rounded-full bg-[var(--border)]"
      />

      {/* Rail fill — grows top-to-bottom once section enters view */}
      <motion.div
        aria-hidden
        initial={{ scaleY: 0 }}
        animate={inView ? { scaleY: 1 } : { scaleY: 0 }}
        transition={{
          duration: steps.length * PER_STEP,
          ease: [0.65, 0, 0.35, 1],
          delay: STEP_DELAY,
        }}
        style={{ transformOrigin: 'top' }}
        className="absolute left-[22px] top-6 bottom-6 w-[2px] rounded-full bg-gradient-to-b from-[var(--text-1)] via-[var(--text-2)] to-[var(--text-3)]"
      />

      {/* Traveling pulse — a glowing dot that slides down the rail */}
      <TravelingPulse
        active={inView}
        totalDuration={steps.length * PER_STEP}
        delay={STEP_DELAY}
      />

      <ol className="relative space-y-0">
        {steps.map((step, i) => (
          <StepRow
            key={step.num}
            step={step}
            index={i}
            active={inView}
            stepDelay={STEP_DELAY + i * PER_STEP * 0.92}
            isLast={i === steps.length - 1}
          />
        ))}
      </ol>
    </div>
  )
}

function TravelingPulse({
  active,
  totalDuration,
  delay,
}: {
  active: boolean
  totalDuration: number
  delay: number
}) {
  return (
    <motion.div
      aria-hidden
      initial={{ top: '24px', opacity: 0 }}
      animate={
        active
          ? { top: 'calc(100% - 24px)', opacity: [0, 1, 1, 0] }
          : { top: '24px', opacity: 0 }
      }
      transition={{
        top: {
          duration: totalDuration,
          ease: [0.65, 0, 0.35, 1],
          delay,
        },
        opacity: {
          duration: totalDuration,
          times: [0, 0.05, 0.92, 1],
          delay,
        },
      }}
      className="absolute left-[18px] z-0 h-[10px] w-[10px] -translate-x-[0px] rounded-full bg-[var(--text-1)]"
      style={{
        boxShadow: '0 0 16px 4px var(--text-1), 0 0 32px 8px rgba(0,0,0,0.1)',
      }}
    />
  )
}

function StepRow({
  step,
  index,
  active,
  stepDelay,
  isLast,
}: {
  step: Step
  index: number
  active: boolean
  stepDelay: number
  isLast: boolean
}) {
  const Icon = step.icon
  const rowRef = useRef<HTMLLIElement>(null)

  const mouseY = useMotionValue(0)
  const tiltY = useSpring(useTransform(mouseY, [-30, 30], [1.5, -1.5]), {
    stiffness: 200,
    damping: 20,
  })

  return (
    <motion.li
      ref={rowRef}
      onMouseMove={(e) => {
        if (!rowRef.current) return
        const rect = rowRef.current.getBoundingClientRect()
        mouseY.set(e.clientY - rect.top - rect.height / 2)
      }}
      onMouseLeave={() => mouseY.set(0)}
      initial={{ opacity: 0, x: -24 }}
      animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: -24 }}
      transition={{
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
        delay: stepDelay,
      }}
      style={{ rotateX: tiltY }}
      className={`relative flex gap-5 py-5 ${
        isLast ? '' : 'border-b border-[var(--border)]'
      }`}
    >
      <div className="relative flex flex-col items-center w-[44px] shrink-0">
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={
            active ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }
          }
          transition={{
            duration: 0.4,
            delay: stepDelay + 0.1,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="font-mono text-[var(--type-12)] font-bold text-[var(--text-4)] tracking-wider"
        >
          {step.num}
        </motion.span>

        <motion.div
          initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
          animate={
            active
              ? { scale: 1, opacity: 1, rotate: 0 }
              : { scale: 0.4, opacity: 0, rotate: -20 }
          }
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 15,
            mass: 0.6,
            delay: stepDelay,
          }}
          whileHover={{ scale: 1.08, rotate: 3 }}
          className="relative mt-2 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--warm-bg)] border border-[var(--border)] z-10 shadow-sm"
        >
          {/* Glow halo — fades in after the step becomes active, sits behind icon. */}
          <motion.span
            aria-hidden
            initial={{ opacity: 0, scale: 0.6 }}
            animate={active ? { opacity: 0.35, scale: 1 } : { opacity: 0 }}
            transition={{
              duration: 0.6,
              delay: stepDelay + 0.1,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="absolute inset-0 rounded-2xl bg-[var(--text-2)] blur-[10px]"
          />

          {/* Ripple — one-shot as the pulse passes. */}
          <motion.span
            aria-hidden
            initial={{ scale: 1, opacity: 0 }}
            animate={
              active
                ? { scale: [1, 1.9, 2.1], opacity: [0.6, 0.2, 0] }
                : { scale: 1, opacity: 0 }
            }
            transition={{
              duration: 1.1,
              ease: 'easeOut',
              delay: stepDelay + 0.15,
            }}
            className="absolute inset-0 rounded-2xl border-2 border-[var(--text-1)]"
          />

          <motion.span
            initial={{ scale: 0.7, opacity: 0 }}
            animate={
              active ? { scale: 1, opacity: 1 } : { scale: 0.7, opacity: 0 }
            }
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 14,
              delay: stepDelay + 0.12,
            }}
            className="relative z-10"
          >
            <Icon className="h-[20px] w-[20px] text-[var(--text-1)]" />
          </motion.span>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={active ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
        transition={{
          duration: 0.5,
          delay: stepDelay + 0.18,
          ease: [0.16, 1, 0.3, 1],
        }}
        className="pt-1.5 flex-1"
      >
        <h3 className="font-display text-[var(--type-16)] font-semibold text-[var(--text-1)]">
          {step.title}
        </h3>
        <p className="mt-1 text-[var(--type-14)] leading-relaxed text-[var(--text-3)]">
          {step.desc}
        </p>
      </motion.div>

      {/* Subtle hover accent — soft gradient wash on the right edge. */}
      <motion.span
        aria-hidden
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        className="pointer-events-none absolute inset-y-0 right-0 w-1/3 rounded-r-2xl bg-gradient-to-l from-[var(--warm-bg-secondary)] to-transparent"
      />

      {/* Completion tick — only on the last step, fades in after the pulse arrives. */}
      {isLast && (
        <motion.span
          aria-hidden
          initial={{ scale: 0, opacity: 0 }}
          animate={
            active ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }
          }
          transition={{
            type: 'spring',
            stiffness: 280,
            damping: 16,
            delay: stepDelay + 0.5,
          }}
          className="absolute right-1 top-6 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--text-1)] text-[var(--warm-bg)]"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6.5L5 9.5L10 3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.span>
      )}
    </motion.li>
  )
}
