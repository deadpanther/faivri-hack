'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

/**
 * AnimatedCounter — Smooth counting animation for numbers.
 * Triggers when element scrolls into view. Counts from 0 to target.
 */

interface AnimatedCounterProps {
  target: number
  duration?: number     // seconds
  prefix?: string       // e.g. "$"
  suffix?: string       // e.g. "x", "%", "K"
  decimals?: number     // decimal places
  className?: string
  formatFn?: (value: number) => string
}

export default function AnimatedCounter({
  target,
  duration = 1.2,
  prefix = '',
  suffix = '',
  decimals = 0,
  className = '',
  formatFn,
}: AnimatedCounterProps) {
  const [value, setValue] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-40px' })
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!isInView || hasAnimated.current) return
    hasAnimated.current = true

    const startTime = performance.now()
    const startValue = 0

    const animate = (currentTime: number) => {
      const elapsed = (currentTime - startTime) / 1000
      const progress = Math.min(elapsed / duration, 1)

      // Ease out cubic for natural deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + (target - startValue) * eased

      setValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        setValue(target)
      }
    }

    requestAnimationFrame(animate)
  }, [isInView, target, duration])

  const displayValue = formatFn
    ? formatFn(value)
    : value.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })

  return (
    <span ref={ref} className={className}>
      {prefix}{displayValue}{suffix}
    </span>
  )
}
