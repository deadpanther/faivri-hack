'use client'

import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

/**
 * SplitText — Staggered letter-by-letter animation.
 * Each character animates in with delay. Triggers on scroll into view.
 */

interface SplitTextProps {
  text: string
  className?: string
  delay?: number         // initial delay in seconds
  staggerDelay?: number  // delay between each character
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span'
}

export default function SplitText({
  text,
  className = '',
  delay = 0,
  staggerDelay = 0.03,
  as: Tag = 'span',
}: SplitTextProps) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  const words = text.split(' ')

  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((word, wordIdx) => (
        <span key={wordIdx} className="inline-block">
          {word.split('').map((char, charIdx) => {
            const totalIdx = words.slice(0, wordIdx).join(' ').length + (wordIdx > 0 ? 1 : 0) + charIdx
            return (
              <motion.span
                key={`${wordIdx}-${charIdx}`}
                className="inline-block"
                initial={{ opacity: 0, y: 10, rotateX: -40 }}
                animate={isInView ? { opacity: 1, y: 0, rotateX: 0 } : {}}
                transition={{
                  duration: 0.4,
                  delay: delay + totalIdx * staggerDelay,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
              >
                {char}
              </motion.span>
            )
          })}
          {wordIdx < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </Tag>
  )
}
