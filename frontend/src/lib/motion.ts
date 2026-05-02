/**
 * Unified motion system — purposeful, Notion-inspired.
 * Every animation serves a function: entrance, feedback, or emphasis.
 * No decorative motion.
 */

// ── Durations ──
export const DUR = {
  fast: 0.12,     // button states, micro-feedback
  normal: 0.25,   // content reveals, hovers
  slow: 0.5,      // hero sections, major transitions
  slower: 0.7,    // number counters, dramatic reveals
} as const

// ── Easings ──
export const EASE = {
  out: [0.16, 1, 0.3, 1] as const,        // enters/reveals (fast start, gentle stop)
  inOut: [0.4, 0, 0.2, 1] as const,       // symmetric transitions
  spring: [0.34, 1.56, 0.64, 1] as const, // playful overshoot
}

// ── Spring configs ──
export const SPRING_KPI = {
  type: 'spring' as const,
  stiffness: 180,
  damping: 18,
  mass: 0.8,
}

export const SPRING_BOUNCE = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 24,
  mass: 0.6,
}

// ── Scroll-triggered reveal (whileInView) ──
export const scrollReveal = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: DUR.slow, ease: EASE.out, delay },
})

// ── Standard reveal (on mount) ──
export const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.slow, ease: EASE.out, delay },
})

// ── Stagger children ──
export const stagger = (delay = 0.06) => ({
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR.normal, ease: EASE.out, delay },
})

// ── Stagger for scroll-triggered lists ──
export const scrollStagger = (delay = 0.06) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: DUR.normal, ease: EASE.out, delay },
})

// ── Hero text cascade (word-by-word or line-by-line) ──
export const heroReveal = (delay = 0) => ({
  initial: { opacity: 0, y: 30, filter: 'blur(4px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  transition: { duration: DUR.slower, ease: EASE.out, delay },
})

// ── Scale-in (for badges, chips, numbers) ──
export const scaleIn = (delay = 0) => ({
  initial: { opacity: 0, scale: 0.85 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: DUR.normal, ease: EASE.spring, delay },
})

// ── Fade only (overlays, toasts) ──
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DUR.fast },
}

// ── Slide up (modals, bottom sheets) ──
export const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 10 },
  transition: { duration: DUR.normal, ease: EASE.out },
}

// ── Gauge draw-in ──
export const drawIn = (delay = 0.3) => ({
  initial: { scaleX: 0 },
  animate: { scaleX: 1 },
  transition: { duration: 0.8, ease: EASE.inOut, delay },
  style: { transformOrigin: 'left' },
})

// ── Card hover (use with whileHover on motion.div) ──
export const cardHover = {
  whileHover: {
    y: -3,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.1)',
    transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] },
  },
  whileTap: { scale: 0.985 },
}

// ── Button press ──
export const buttonPress = {
  whileTap: { scale: 0.96 },
  transition: { duration: 0.1 },
}

// ── Container for stagger children (use as parent) ──
export const staggerContainer = (staggerDelay = 0.08) => ({
  initial: 'hidden',
  animate: 'visible',
  variants: {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: 0.1,
      },
    },
  },
})

// ── Child variant (use with staggerContainer parent) ──
export const staggerChild = {
  variants: {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
    },
  },
}
