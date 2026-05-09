'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { insforge } from '@/lib/insforge'
import { setAuthTokenGetter, setPersistedToken } from '@/lib/api'

/**
 * AuthTokenBridge — wires the InsForge auth token into the API client
 * so every backend request carries Authorization: Bearer ***
 *
 * Strategy:
 * 1. On sign-in, the InsForge SDK stores the access token in memory.
 * 2. We also persist it to sessionStorage as a backup.
 * 3. If the in-memory token is lost (HMR, navigation), the API client
 *    falls back to the persisted token.
 * 4. If both are empty, try refreshSession() to get a new token.
 */
export function AuthTokenBridge(): null {
  const { user } = useAuth()

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        // Fast path: return in-memory token if available
        let token = insforge.getAccessToken()
        if (token) {
          setPersistedToken(token)
          return token
        }

        // In-memory token lost — try persisted backup
        const persisted = sessionStorage.getItem('faivri:insforge-access-token')
        if (persisted) {
          console.log('[AuthTokenBridge] using persisted token backup')
          return persisted
        }

        // Both empty — try to refresh the session via httpOnly cookie
        console.log('[AuthTokenBridge] attempting session refresh...')
        const { data, error } = await insforge.auth.refreshSession()
        if (error) {
          console.warn('[AuthTokenBridge] refresh failed:', error.message)
          return null
        }
        token = data?.accessToken ?? insforge.getAccessToken()
        if (token) {
          setPersistedToken(token)
        }
        return token ?? null
      } catch (err) {
        console.warn('[AuthTokenBridge] token getter error:', err)
        return null
      }
    })
  }, [user])

  return null
}
