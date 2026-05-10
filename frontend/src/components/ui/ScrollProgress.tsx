'use client'

import { motion, useScroll, useSpring } from 'framer-motion'

export default function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 22,
    mass: 0.4,
  })

  return (
    <motion.div
      aria-hidden
      style={{ scaleX, transformOrigin: '0% 50%' }}
      className="fixed left-0 right-0 top-0 z-[60] h-[2px] bg-gradient-to-r from-[var(--amber)] via-[var(--red)] to-[var(--amber)] shadow-[0_1px_6px_rgba(217,115,13,0.45)] motion-reduce:hidden"
    />
  )
}
