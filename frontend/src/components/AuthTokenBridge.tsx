'use client'

import { useAuth } from '@clerk/nextjs'
import { useEffect } from 'react'

import { setAuthTokenGetter } from '@/lib/api'

/**
 * Registers Clerk's `getToken()` with the shared `api` client so every call
 * out of `api.ts` includes `Authorization: Bearer <jwt>`. Must live inside a
 * <ClerkProvider>. Without this, signed-in users still hit 401 on
 * `require_user_id` endpoints (history detail, negotiate, feedback, etc.).
 */
export function AuthTokenBridge(): null {
  const { getToken, isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) {
      setAuthTokenGetter(null)
      return
    }
    setAuthTokenGetter(() => getToken())
    return () => {
      setAuthTokenGetter(null)
    }
  }, [getToken, isLoaded, isSignedIn])

  return null
}
