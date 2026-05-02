'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * TextScramble — Phenomenon Studio-style cipher decode effect.
 * Characters scramble through random glyphs before resolving to the final text.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*'

interface TextScrambleProps {
  text: string
  className?: string
  delay?: number        // ms before starting
  speed?: number        // ms per character resolve (lower = faster)
  scrambleDuration?: number // how many frames each char scrambles before resolving
}

export default function TextScramble({
  text,
  className = '',
  delay = 0,
  speed = 30,
  scrambleDuration = 6,
}: TextScrambleProps) {
  const [display, setDisplay] = useState('')
  const [started, setStarted] = useState(false)
  const frameRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  useEffect(() => {
    if (!started) {
      setDisplay(text.replace(/[^ ]/g, ' '))
      return
    }

    let resolvedCount = 0
    let frame = 0

    const animate = () => {
      frame++
      const nextResolveAt = resolvedCount * scrambleDuration

      if (frame >= nextResolveAt + scrambleDuration && resolvedCount < text.length) {
        resolvedCount++
      }

      let output = ''
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') {
          output += ' '
        } else if (i < resolvedCount) {
          output += text[i]
        } else {
          output += CHARS[Math.floor(Math.random() * CHARS.length)]
        }
      }

      setDisplay(output)

      if (resolvedCount < text.length) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        setDisplay(text)
      }
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [started, text, speed, scrambleDuration])

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: started ? 1 : 0 }}
      transition={{ duration: 0.2 }}
      className={className}
      aria-label={text}
    >
      {display}
    </motion.span>
  )
}
