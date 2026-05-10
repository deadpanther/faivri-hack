'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Cookie, X } from 'lucide-react'

const CONSENT_KEY = 'faivri_cookie_consent_v1'

export function CookieConsent() {
  // Start hidden so the server-rendered HTML and the first client render
  // match (both produce `null`). We then check localStorage after mount and
  // reveal the banner if no prior consent is recorded. Doing this in
  // `useEffect` is what avoids the hydration mismatch.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(CONSENT_KEY)) {
        setVisible(true)
      }
    } catch {
      // Private-mode Safari can throw on localStorage access — show the
      // banner anyway so the user still gets the disclosure.
      setVisible(true)
    }
  }, [])

  function dismiss(accepted: boolean) {
    try {
      window.localStorage.setItem(
        CONSENT_KEY,
        JSON.stringify({ accepted, at: new Date().toISOString() }),
      )
    } catch {
      // Ignore — we've disclosed, that's what matters.
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie notice"
      className="fixed inset-x-3 bottom-3 z-[60] md:inset-x-auto md:bottom-5 md:left-5 md:right-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border border-[var(--border)] bg-white/95 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur md:flex-row md:items-center md:gap-4 md:p-4">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--warm-bg-tertiary)] text-[var(--text-1)]">
            <Cookie className="h-4 w-4" />
          </div>
          <p className="text-[13.5px] font-semibold text-[var(--text-1)] md:hidden">
            Cookies on Faivri
          </p>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--text-2)] md:flex-1">
          <span className="hidden font-semibold text-[var(--text-1)] md:inline">
            Cookies on Faivri.{' '}
          </span>
          We use strictly necessary cookies for sign-in (Clerk) and to remember your language
          preference. No ad trackers, no analytics cookies.{' '}
          <Link
            href="/privacy"
            className="font-medium text-[var(--blue)] underline-offset-4 hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="inline-flex items-center justify-center rounded-full bg-black px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#333]"
          >
            Got it
          </button>
          <button
            type="button"
            aria-label="Dismiss cookie notice"
            onClick={() => dismiss(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[var(--text-2)] transition-colors hover:bg-[var(--warm-bg-tertiary)] hover:text-[var(--text-1)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
