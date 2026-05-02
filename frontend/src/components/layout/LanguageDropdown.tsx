'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, Globe } from 'lucide-react'

const LANGUAGES = [
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'es', label: 'Español', flag: 'ES' },
  { code: 'es-419', label: 'Español (MX)', flag: 'MX' },
  { code: 'fr', label: 'Français', flag: 'FR' },
  { code: 'pt', label: 'Português', flag: 'PT' },
  { code: 'de', label: 'Deutsch', flag: 'DE' },
  { code: 'hi', label: 'हिन्दी', flag: 'HI' },
  { code: 'gu', label: 'ગુજરાતી', flag: 'GU' },
  { code: 'mr', label: 'मराठी', flag: 'MR' },
  { code: 'te', label: 'తెలుగు', flag: 'TE' },
  { code: 'ur', label: 'اردو', flag: 'UR' },
  { code: 'ar', label: 'العربية', flag: 'AR' },
  { code: 'zh-CN', label: '中文', flag: 'ZH' },
  { code: 'ja', label: '日本語', flag: 'JA' },
] as const

declare global {
  interface Window {
    googleTranslateElementInit?: () => void
    google?: {
      translate?: {
        TranslateElement: new (config: Record<string, unknown>, elementId: string) => unknown
      }
    }
  }
}

const GT_SCRIPT_ID = 'faivri-google-translate-script'

function readCurrentLanguage(): string {
  if (typeof document === 'undefined') return 'en'
  const match = document.cookie.match(/googtrans=\/[^/]+\/([^;]+)/)
  return match?.[1] ?? 'en'
}

function setGoogleLanguage(code: string): void {
  const host = window.location.hostname
  const rootDomain = host.split('.').slice(-2).join('.')
  const expire = 'path=/; max-age=31536000'
  const clear = 'path=/; max-age=0'

  document.cookie = `googtrans=; ${clear}`
  document.cookie = `googtrans=; domain=${host}; ${clear}`
  document.cookie = `googtrans=; domain=.${rootDomain}; ${clear}`

  if (code !== 'en') {
    document.cookie = `googtrans=/en/${code}; ${expire}`
    document.cookie = `googtrans=/en/${code}; domain=${host}; ${expire}`
    document.cookie = `googtrans=/en/${code}; domain=.${rootDomain}; ${expire}`
  }

  window.location.reload()
}

export default function LanguageDropdown() {
  const [open, setOpen] = useState(false)
  const [current] = useState(() => readCurrentLanguage())
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (document.getElementById(GT_SCRIPT_ID)) return

    window.googleTranslateElementInit = () => {
      if (!window.google?.translate) return
      new window.google.translate.TranslateElement(
        {
          pageLanguage: 'en',
          autoDisplay: false,
          layout: 0,
        },
        'faivri-gt-host',
      )
    }

    const script = document.createElement('script')
    script.id = GT_SCRIPT_ID
    script.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    script.async = true
    document.body.appendChild(script)
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = LANGUAGES.find((lang) => lang.code === current) ?? LANGUAGES[0]

  return (
    <div ref={rootRef} className="relative notranslate" translate="no">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Change language"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(55,53,47,0.09)] bg-white/80 px-2.5 py-1.5 text-[12px] font-semibold text-[#37352F] transition-colors hover:bg-[#F1F1EF] md:px-3 md:text-[13px]"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="hidden md:inline">{active.label}</span>
        <span className="font-mono text-[10px] text-[#9B9A97] md:hidden">{active.flag}</span>
        {current !== 'en' && (
          <span
            aria-label="Page translated by Google Translate"
            title="Translated by Google"
            className="ml-1 inline-flex items-center rounded-md bg-[#F1F1EF] px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none tracking-wider text-[#4285F4]"
          >
            G·T
          </span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 overflow-hidden rounded-2xl border border-[rgba(55,53,47,0.09)] bg-white p-1 shadow-[0_12px_32px_rgba(0,0,0,0.12)]"
            role="menu"
          >
            <div className="max-h-[60vh] overflow-y-auto">
              {LANGUAGES.map((lang) => {
                const isActive = lang.code === current
                return (
                  <button
                    key={lang.code}
                    type="button"
                    role="menuitem"
                    onClick={() => setGoogleLanguage(lang.code)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${
                      isActive
                        ? 'bg-[#F1F1EF] font-semibold text-[#37352F]'
                        : 'text-[#37352F] hover:bg-[#F7F7F5]'
                    }`}
                  >
                    <span className="inline-flex h-6 w-8 items-center justify-center rounded-md bg-[#F1F1EF] font-mono text-[10px] font-bold text-[#6B6B6B]">
                      {lang.flag}
                    </span>
                    <span className="flex-1">{lang.label}</span>
                    {isActive && <Check className="h-3.5 w-3.5 text-[#37352F]" />}
                  </button>
                )
              })}
            </div>
            <a
              href="https://translate.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center justify-between gap-2 border-t border-[rgba(55,53,47,0.09)] px-3 py-2 text-[10px] font-medium text-[#6B6B6B] transition-colors hover:bg-[#F7F7F5] hover:text-[#37352F]"
            >
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white font-mono text-[9px] font-bold leading-none text-[#4285F4] ring-1 ring-[rgba(66,133,244,0.35)]">
                  G
                </span>
                <span>Powered by Google Translate</span>
              </span>
              <span aria-hidden className="text-[#B4B4B0]">↗</span>
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      <div id="faivri-gt-host" className="hidden" />
    </div>
  )
}
