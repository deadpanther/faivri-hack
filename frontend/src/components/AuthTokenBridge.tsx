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
 * 1. InsForgeClient does NOT expose getAccessToken() publicly.
 *    Instead, we use getHttpClient().getHeaders() which returns
 *    { Authorization: "Bearer <token>" } if a token is set.
 * 2. We also persist the raw token to sessionStorage as backup.
 * 3. If both are empty, try refreshSession() to get a new token.
 *
 * CRITICAL: This component MUST be rendered inside InsForgeAuthProvider
 * so that useAuth() works. It's placed in Providers.tsx.
 */
export function AuthTokenBridge(): null {
  const { user } = useAuth()

  useEffect(() => {
    // Register the token getter IMMEDIATELY — don't wait for user to be non-null.
    setAuthTokenGetter(async () => {
      try {
        // Method 1: Use InsForge SDK's HTTP client headers
        // getHeaders() returns { Authorization: "Bearer <token>" } when token is set
        const headers = insforge.getHttpClient().getHeaders()
        if (headers.Authorization || headers.authorization) {
          const authHeader = headers.Authorization || headers.authorization
          const token = authHeader.replace(/^Bearer\s+/i, '')
          if (token) {
            setPersistedToken(token)
            return token
          }
        }

        // Method 2: Check sessionStorage backup
        const persisted = sessionStorage.getItem('faivri:insforge-access-token')
        if (persisted) {
          console.log('[AuthTokenBridge] using persisted token backup')
          // Re-set it on the SDK so future SDK calls also work
          insforge.setAccessToken(persisted)
          return persisted
        }

        // Method 3: Try to refresh the session via httpOnly cookie
        console.log('[AuthTokenBridge] attempting session refresh...')
        const { data, error } = await insforge.auth.refreshSession()
        if (error) {
          console.warn('[AuthTokenBridge] refresh failed:', error.message)
          return null
        }
        // After refresh, the SDK should have the token internally
        const refreshedHeaders = insforge.getHttpClient().getHeaders()
        const refreshedAuth = refreshedHeaders.Authorization || refreshedHeaders.authorization
        if (refreshedAuth) {
          const token = refreshedAuth.replace(/^Bearer\s+/i, '')
          if (token) {
            setPersistedToken(token)
            return token
          }
        }
        return null
      } catch (err) {
        console.warn('[AuthTokenBridge] token getter error:', err)
        return null
      }
    })

    return () => setAuthTokenGetter(null)
  }, []) // Register once

  // Keep sessionStorage in sync when user changes
  useEffect(() => {
    if (user) {
      const headers = insforge.getHttpClient().getHeaders()
      const authHeader = headers.Authorization || headers.authorization
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '')
        if (token) setPersistedToken(token)
      }
    }
  }, [user])

  return null
}
