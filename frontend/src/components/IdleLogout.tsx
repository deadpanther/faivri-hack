'use client'

import { useAuth, useClerk } from '@clerk/nextjs'
import { useEffect, useRef } from 'react'

import { useToast } from '@/components/ui/Toast'

const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const ACTIVITY_KEY = 'faivri:lastActivityAt'
const ACTIVITY_EVENTS = [
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'pointermove',
] as const
// Throttle activity writes — `pointermove` fires hundreds of times per minute.
const WRITE_THROTTLE_MS = 5_000

/**
 * Auto-signs the user out after 60 min of inactivity.
 *
 * Activity = any input/scroll/pointer event (throttled). The last-activity
 * timestamp is mirrored into `localStorage` so multiple open tabs share one
 * idle clock — typing in tab A keeps tab B's session alive. On expiry we call
 * `clerk.signOut()` and show a toast so the user knows why they were bounced.
 */
export function IdleLogout(): null {
  const { isLoaded, isSignedIn } = useAuth()
  const clerk = useClerk()
  const { toast } = useToast()
  const lastWriteRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return

    function readLastActivity(): number {
      try {
        const raw = window.localStorage.getItem(ACTIVITY_KEY)
        const parsed = raw ? Number.parseInt(raw, 10) : NaN
        return Number.isFinite(parsed) ? parsed : Date.now()
      } catch {
        return Date.now()
      }
    }

    function writeActivity(now: number) {
      try {
        window.localStorage.setItem(ACTIVITY_KEY, String(now))
      } catch {
        // localStorage can throw in privacy mode — fall through, in-memory
        // timer still protects the current tab.
      }
    }

    async function expire() {
      // Re-check across tabs before firing — another tab may have refreshed
      // activity inside the last second.
      const last = readLastActivity()
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - last)
      if (remaining > 1_000) {
        scheduleCheck(remaining)
        return
      }
      try {
        window.localStorage.removeItem(ACTIVITY_KEY)
      } catch {}
      toast("Signed out after 1 hour of inactivity. Sign in again to continue.", 'info')
      try {
        await clerk.signOut()
      } catch {
        // If Clerk's sign-out network call fails, force a hard reload so the
        // app re-checks auth state on next render.
        window.location.assign('/')
      }
    }

    function scheduleCheck(delayMs: number) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(expire, Math.max(1_000, delayMs))
    }

    function recordActivity() {
      const now = Date.now()
      if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return
      lastWriteRef.current = now
      writeActivity(now)
      scheduleCheck(IDLE_TIMEOUT_MS)
    }

    function onStorage(event: StorageEvent) {
      if (event.key !== ACTIVITY_KEY || !event.newValue) return
      const remote = Number.parseInt(event.newValue, 10)
      if (!Number.isFinite(remote)) return
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - remote)
      scheduleCheck(remaining > 0 ? remaining : 1_000)
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      const remaining = IDLE_TIMEOUT_MS - (Date.now() - readLastActivity())
      if (remaining <= 0) {
        void expire()
      } else {
        scheduleCheck(remaining)
      }
    }

    // Seed the clock so a freshly-signed-in user gets a full hour even if no
    // localStorage entry existed yet.
    const seeded = readLastActivity()
    if (!window.localStorage.getItem(ACTIVITY_KEY)) writeActivity(seeded)
    scheduleCheck(IDLE_TIMEOUT_MS - (Date.now() - seeded))

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, recordActivity, { passive: true })
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, recordActivity)
      }
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isLoaded, isSignedIn, clerk, toast])

  return null
}
