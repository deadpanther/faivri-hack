'use client'

import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { useEffect, useState } from 'react'
import { useToast } from '@/components/ui/Toast'

/**
 * Signs the user out after 30 minutes of inactivity.
 * Now uses InsForge auth instead of Clerk.
 */
export function IdleLogout(): null {
  const { user, signOut } = useAuth()
  const { toast } = useToast()
  const [idleSeconds, setIdleSeconds] = useState(0)

  useEffect(() => {
    if (!user) return

    let seconds = 0
    const interval = setInterval(() => {
      seconds += 1
      setIdleSeconds(seconds)
    }, 1000)

    const resetTimer = () => {
      seconds = 0
      setIdleSeconds(0)
    }

    window.addEventListener('mousemove', resetTimer)
    window.addEventListener('keydown', resetTimer)
    window.addEventListener('scroll', resetTimer)
    window.addEventListener('touchstart', resetTimer)

    return () => {
      clearInterval(interval)
      window.removeEventListener('mousemove', resetTimer)
      window.removeEventListener('keydown', resetTimer)
      window.removeEventListener('scroll', resetTimer)
      window.removeEventListener('touchstart', resetTimer)
    }
  }, [user])

  useEffect(() => {
    if (idleSeconds >= 1800) {
      signOut()
      toast('You have been signed out due to inactivity.')
    }
  }, [idleSeconds, signOut, toast])

  return null
}
