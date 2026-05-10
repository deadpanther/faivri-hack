'use client'

import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'

import { formatPrice } from '@/lib/constants'

interface ShareBarProps {
  lifetimeSavedCents: number
  currency: string
  levelLabel: string
  overchargesFound: number
}

const SITE_URL = 'https://faivri.com'

function buildCaptions(
  savedFormatted: string,
  levelLabel: string,
  overchargesFound: number,
) {
  const base = `I just saved ${savedFormatted} dodging overpriced quotes with Faivri — it checks any price against live market comps in seconds.`
  const withLevel = levelLabel ? ` I'm already a ${levelLabel} 👀` : ''
  const withCount =
    overchargesFound > 0
      ? ` It's flagged ${overchargesFound} overcharge${overchargesFound === 1 ? '' : 's'} for me so far.`
      : ''
  const cta = ' You should try it before your next quote — free to start.'
  // Instagram has no web share intent — captions go to clipboard so the
  // user can paste into a Story / DM after we open instagram.com.
  const igHashtags = ' #faivri #savings #pricecheck'

  return {
    whatsapp: `${base}${withLevel}${withCount}${cta} ${SITE_URL}`,
    telegram: `${base}${withLevel}${withCount}${cta}`,
    twitter: `${base}${withLevel}${withCount} You should try it 👉`,
    instagram: `${base}${withLevel}${withCount}${cta} ${SITE_URL}${igHashtags}`,
  }
}

function WhatsappIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17.5 14.4c-.3-.15-1.77-.87-2.05-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.17.2-.35.22-.65.08-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.08-.15-.68-1.63-.93-2.23-.25-.6-.5-.5-.68-.5h-.58c-.2 0-.52.08-.8.37-.28.3-1.05 1.03-1.05 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.48.71.3 1.26.48 1.69.62.71.22 1.35.19 1.86.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.13-.27-.2-.57-.35zM12 2a10 10 0 0 0-8.5 15.22L2 22l4.93-1.47A10 10 0 1 0 12 2z" />
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M9.78 15.39 9.62 19c.35 0 .5-.15.68-.32l1.63-1.56 3.38 2.47c.62.34 1.06.16 1.23-.57l2.23-10.46c.22-.93-.34-1.3-.94-1.08L4.1 12.27c-.9.36-.89.87-.16 1.1l3.56 1.11 8.26-5.2c.39-.25.75-.11.45.15z" />
    </svg>
  )
}

function TwitterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M18.244 2H21.5l-7.38 8.43L22.5 22h-6.86l-5.37-7.03L4.15 22H.9l7.9-9.02L.5 2h7.02l4.85 6.41L18.244 2zm-1.2 18h1.9L7.04 4H5l12.044 16z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 2.2c3.2 0 3.6 0 4.85.07 1.17.05 1.8.25 2.23.42.56.22.96.48 1.38.9.42.42.68.82.9 1.38.17.42.37 1.06.42 2.23.06 1.26.07 1.64.07 4.85s0 3.6-.07 4.85c-.05 1.17-.25 1.8-.42 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.17-1.06.37-2.23.42-1.26.06-1.64.07-4.85.07s-3.6 0-4.85-.07c-1.17-.05-1.8-.25-2.23-.42-.56-.22-.96-.48-1.38-.9-.42-.42-.68-.82-.9-1.38-.17-.42-.37-1.06-.42-2.23C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.85c.05-1.17.25-1.8.42-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.17 1.06-.37 2.23-.42C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.15 0-3.5 0-4.74.07-1.07.05-1.66.23-2.05.38-.51.2-.88.44-1.27.83-.39.39-.63.76-.83 1.27-.15.39-.33.98-.38 2.05C2.66 8.5 2.65 8.85 2.65 12s0 3.5.07 4.74c.05 1.07.23 1.66.38 2.05.2.51.44.88.83 1.27.39.39.76.63 1.27.83.39.15.98.33 2.05.38 1.24.06 1.59.07 4.74.07s3.5 0 4.74-.07c1.07-.05 1.66-.23 2.05-.38.51-.2.88-.44 1.27-.83.39-.39.63-.76.83-1.27.15-.39.33-.98.38-2.05.06-1.24.07-1.59.07-4.74s0-3.5-.07-4.74c-.05-1.07-.23-1.66-.38-2.05-.2-.51-.44-.88-.83-1.27-.39-.39-.76-.63-1.27-.83-.39-.15-.98-.33-2.05-.38C15.5 4 15.15 4 12 4zm0 3.06A4.94 4.94 0 1 1 7.06 12 4.94 4.94 0 0 1 12 7.06zm0 1.8A3.14 3.14 0 1 0 15.14 12 3.14 3.14 0 0 0 12 8.86zm5.13-2.91a1.16 1.16 0 1 1-1.15 1.16 1.16 1.16 0 0 1 1.15-1.16z" />
    </svg>
  )
}

export default function ShareBar({
  lifetimeSavedCents,
  currency,
  levelLabel,
  overchargesFound,
}: ShareBarProps) {
  const [copied, setCopied] = useState(false)
  const [igCopied, setIgCopied] = useState(false)

  if (lifetimeSavedCents <= 0) return null

  const savedFormatted = formatPrice(lifetimeSavedCents, currency)
  const captions = buildCaptions(savedFormatted, levelLabel, overchargesFound)

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(captions.whatsapp)}`
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(
    SITE_URL,
  )}&text=${encodeURIComponent(captions.telegram)}`
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    captions.twitter,
  )}&url=${encodeURIComponent(SITE_URL)}`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${captions.whatsapp}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  // Instagram doesn't support a web share intent. We do the next best thing:
  // copy a caption with hashtags + the Faivri URL, then open instagram.com
  // in a new tab so the user can paste into a Story or DM. On mobile, the
  // native Web Share API picks up Instagram automatically when present.
  const onShareInstagram = async () => {
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await navigator.share({
            title: 'I saved with Faivri',
            text: captions.instagram,
            url: SITE_URL,
          })
          return
        } catch {
          // user cancelled the system share sheet — fall through to copy
        }
      }
      await navigator.clipboard.writeText(captions.instagram)
      setIgCopied(true)
      window.setTimeout(() => setIgCopied(false), 2200)
      window.open('https://instagram.com/', '_blank', 'noopener,noreferrer')
    } catch {
      setIgCopied(false)
    }
  }

  return (
    <div className="mt-6 border-t border-[var(--border)] pt-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-4)]">
        Share your win
      </p>
      <p className="mt-1.5 text-sm text-[var(--text-3)]">
        Brag a little — help a friend catch their next overcharge.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
          aria-label="Share on WhatsApp"
        >
          <WhatsappIcon />
          WhatsApp
        </a>
        <a
          href={telegramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
          aria-label="Share on Telegram"
        >
          <TelegramIcon />
          Telegram
        </a>
        <a
          href={twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
          aria-label="Share on X"
        >
          <TwitterIcon />
          Post on X
        </a>
        <button
          type="button"
          onClick={onShareInstagram}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
          style={{
            background:
              'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
          }}
          aria-label="Share to Instagram"
        >
          <InstagramIcon />
          {igCopied ? 'Caption copied' : 'Instagram'}
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)]"
          aria-label="Copy share link"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Link2 className="h-4 w-4" />
              Copy
            </>
          )}
        </button>
      </div>
    </div>
  )
}
