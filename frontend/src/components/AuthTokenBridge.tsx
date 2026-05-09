'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { insforge } from '@/lib/insforge'
import { setAuthTokenGetter } from '@/lib/api'

/**
 * AuthTokenBridge — wires the InsForge auth token into the API client
 * so every backend request carries Authorization: Bearer <token>.
 */
export function AuthTokenBridge(): null {
  const { user } = useAuth()

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        const token = insforge.getAccessToken()
        return token ?? null
      } catch {
        return null
      }
    })
  }, [user])

  return null
}
