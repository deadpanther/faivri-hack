'use client'

import { useEffect, useRef } from 'react'

import { SESSION_REVOKED_EVENT } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'

const SUPPRESS_WINDOW_MS = 60_000

export function SessionRevokedToast(): null {
  const { toast } = useToast()
  const lastFiredAtRef = useRef<number>(0)

  useEffect(() => {
    function onRevoked() {
      // The first failed request after the cap kicks in usually triggers a
      // burst of retries (page reload, refetched widgets). Coalesce so the
      // user sees one toast, not five.
      const now = Date.now()
      if (now - lastFiredAtRef.current < SUPPRESS_WINDOW_MS) return
      lastFiredAtRef.current = now
      toast(
        "You've been signed out — you logged in on another device. Faivri caps active sessions at 2.",
        'info',
      )
    }
    window.addEventListener(SESSION_REVOKED_EVENT, onRevoked)
    return () => window.removeEventListener(SESSION_REVOKED_EVENT, onRevoked)
  }, [toast])

  return null
}
