'use client'

import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

/**
 * ParallaxText — Text/element that moves at a different rate than scroll.
 * Subtle parallax for premium depth feel.
 */

interface ParallaxTextProps {
  children: React.ReactNode
  className?: string
  speed?: number   // negative = moves up faster, positive = moves down slower
  as?: 'div' | 'h1' | 'h2' | 'h3' | 'p' | 'section'
}

export default function ParallaxText({
  children,
  className = '',
  speed = -30,
  as: Tag = 'div',
}: ParallaxTextProps) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  })

  const y = useTransform(scrollYProgress, [0, 1], [0, speed])

  return (
    <Tag ref={ref} className={className} style={{ position: 'relative' }}>
      <motion.div style={{ y }}>
        {children}
      </motion.div>
    </Tag>
  )
}
