'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

const DISMISS_STORAGE_KEY = 'faivri:pwa-prompt-dismissed-at'
const DISMISS_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari sets navigator.standalone when launched from home screen
  // (typed loosely because TS lib doesn't include it)
  const navAny = window.navigator as Navigator & { standalone?: boolean }
  if (navAny.standalone === true) return true
  return false
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return false
    const at = Number.parseInt(raw, 10)
    if (Number.isNaN(at)) return false
    return Date.now() - at < DISMISS_COOLDOWN_MS
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()))
  } catch {
    // localStorage may be blocked; ignore
  }
}

export function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isStandalone()) return
    if (recentlyDismissed()) return

    const ua = window.navigator.userAgent || ''
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
    const isSafari = isIos && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    const onInstalled = () => {
      setVisible(false)
      setDeferred(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari never fires beforeinstallprompt, so we surface a hint
    // after a short delay to give the page time to settle.
    if (isSafari) {
      const t = window.setTimeout(() => {
        setIosHint(true)
        setVisible(true)
      }, 4000)
      return () => {
        window.clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', onPrompt)
        window.removeEventListener('appinstalled', onInstalled)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    markDismissed()
    setVisible(false)
  }

  const install = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'dismissed') markDismissed()
    } catch {
      // ignore — browser may have already shown the native UI
    }
    setDeferred(null)
    setVisible(false)
  }

  return (
    <div
      className="fixed inset-x-0 z-[60] mx-auto w-[calc(100%-1.25rem)] max-w-[420px] rounded-2xl border border-[rgba(55,53,47,0.12)] bg-white/95 px-4 py-3 shadow-[0_18px_44px_rgba(15,15,15,0.18)] backdrop-blur-sm"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
      role="dialog"
      aria-label="Install Faivri"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1A1814] to-black text-white">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight text-[#37352F]">
            Install Faivri
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-[#6B6B6B]">
            {iosHint
              ? 'Tap Share, then "Add to Home Screen" to install.'
              : 'Add to your home screen for one-tap price checks.'}
          </p>
          {!iosHint && (
            <button
              type="button"
              onClick={install}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#1A1814] active:bg-[#000]"
            >
              Install app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="-m-1 rounded-full p-1 text-[#6B6B6B] transition-colors hover:bg-[#F1F1EF] hover:text-[#37352F]"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
