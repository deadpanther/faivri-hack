'use client'

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * MagneticButton — Button that pulls toward cursor on hover.
 * Phenomenon Studio signature effect. Subtle and premium.
 */

interface MagneticButtonProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  strength?: number  // magnetic pull strength (default 0.3)
  disabled?: boolean
  type?: 'button' | 'submit'
}

export default function MagneticButton({
  children,
  className = '',
  onClick,
  strength = 0.3,
  disabled = false,
  type = 'button',
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current || disabled) return
    const rect = ref.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = (e.clientX - centerX) * strength
    const deltaY = (e.clientY - centerY) * strength
    setPosition({ x: deltaX, y: deltaY })
  }

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 })
  }

  return (
    <motion.button
      ref={ref}
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: 'spring', stiffness: 350, damping: 15, mass: 0.2 }}
      whileTap={{ scale: 0.96 }}
    >
      {children}
    </motion.button>
  )
}
