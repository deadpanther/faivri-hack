'use client'

import { useEffect } from 'react'

/**
 * SmoothScroll — Lenis-style smooth scrolling via CSS.
 * No library needed — uses scroll-behavior + scroll-timeline for buttery feel.
 * Falls back gracefully on older browsers and respects prefers-reduced-motion.
 */

export default function SmoothScroll() {
  useEffect(() => {
    // Apply smooth scroll to html
    document.documentElement.style.scrollBehavior = 'smooth'

    // Check for reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (mediaQuery.matches) {
      document.documentElement.style.scrollBehavior = 'auto'
    }

    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.style.scrollBehavior = e.matches ? 'auto' : 'smooth'
    }

    mediaQuery.addEventListener('change', handler)

    return () => {
      document.documentElement.style.scrollBehavior = ''
      mediaQuery.removeEventListener('change', handler)
    }
  }, [])

  return null
}
