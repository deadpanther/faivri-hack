'use client'

/**
 * Per-quote share sheet for /result/[id] and /result/purchase/[slug].
 *
 * Mirrors components/savings/ShareBar.tsx (Vault) — same platform set,
 * same client-side intent URLs (wa.me / t.me / twitter.com/intent / IG).
 * Difference: the share URL is a public `/share/[token]` capability we
 * mint server-side via POST /api/v1/share, so social previews render the
 * verdict instead of the homepage.
 *
 * Token mint is lazy: nothing happens server-side until the user actually
 * opens the sheet. Once minted, the same token is reused for every
 * subsequent platform click in this session — saves a round-trip and
 * keeps social tracking parameters consistent.
 */

import { useState } from 'react'
import { Check, Link2, Loader2, Share2 } from 'lucide-react'

import { api } from '@/lib/api'
import { formatPrice } from '@/lib/constants'

interface QuoteShareSheetProps {
  kind: 'query' | 'purchase'
  recordId: string
  // Headline figures for the dynamic caption. All in smallest-units (cents).
  quotedPriceCents?: number | null
  fairLowCents?: number | null
  fairHighCents?: number | null
  currency?: string
  // Display title (e.g. "2018 Honda Civic" or "Brake pads").
  title: string
  domain?: string
}

const SITE_URL = 'https://faivri.com'

function buildCaptions(opts: {
  shareUrl: string
  title: string
  domain?: string
  quotedPriceCents?: number | null
  fairLowCents?: number | null
  fairHighCents?: number | null
  currency: string
}) {
  const {
    shareUrl, title, domain, quotedPriceCents, fairLowCents, fairHighCents, currency,
  } = opts

  const fairFmt =
    typeof fairLowCents === 'number' && typeof fairHighCents === 'number'
      ? `${formatPrice(fairLowCents, currency)}–${formatPrice(fairHighCents, currency)}`
      : null

  const overpay =
    typeof quotedPriceCents === 'number' &&
    typeof fairHighCents === 'number' &&
    quotedPriceCents > fairHighCents
      ? quotedPriceCents - fairHighCents
      : null

  const isCar = domain === 'used_cars'
  const verb = isCar ? 'listed at' : 'quoted'

  let headline: string
  if (overpay) {
    headline = `Faivri caught a $${Math.round(overpay / 100).toLocaleString()} overcharge on ${title}.`
  } else if (typeof quotedPriceCents === 'number' && fairFmt) {
    headline = `Just price-checked ${title} (${verb} ${formatPrice(quotedPriceCents, currency)}). Fair: ${fairFmt}.`
  } else if (fairFmt) {
    headline = `Fair price on ${title}: ${fairFmt}. Verified by Faivri.`
  } else {
    headline = `Just price-checked ${title} with Faivri.`
  }

  const cta = ' Try it before your next quote — free to start.'
  const igHashtags = ' #faivri #pricecheck #savings'

  return {
    whatsapp: `${headline}${cta} ${shareUrl}`,
    telegram: `${headline}${cta}`,
    twitter: `${headline} You should try it 👉`,
    instagram: `${headline}${cta} ${shareUrl}${igHashtags}`,
    full: `${headline}${cta} ${shareUrl}`,
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

export default function QuoteShareSheet({
  kind, recordId, title, domain,
  quotedPriceCents, fairLowCents, fairHighCents, currency = 'USD',
}: QuoteShareSheetProps) {
  const [open, setOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [igCopied, setIgCopied] = useState(false)

  // Lazy mint — only the first time the sheet is opened. Subsequent opens
  // reuse the cached URL. Failure falls back to the homepage URL so the
  // share buttons still work even if the backend mint route is hiccupping.
  const ensureUrl = async (): Promise<string> => {
    if (shareUrl) return shareUrl
    setMinting(true)
    setMintError(null)
    try {
      const res = await api.createShareToken(kind, recordId)
      setShareUrl(res.url)
      return res.url
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not generate share link.'
      setMintError(msg)
      // Soft-fail to homepage so the rest of the buttons still work.
      const fallback = SITE_URL
      setShareUrl(fallback)
      return fallback
    } finally {
      setMinting(false)
    }
  }

  const onOpen = async () => {
    setOpen(true)
    await ensureUrl()
  }

  const captions = (() => {
    if (!shareUrl) return null
    return buildCaptions({
      shareUrl, title, domain, quotedPriceCents, fairLowCents, fairHighCents, currency,
    })
  })()

  const onCopy = async () => {
    if (!captions) return
    try {
      await navigator.clipboard.writeText(captions.full)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  const onShareInstagram = async () => {
    if (!captions) return
    try {
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await navigator.share({
            title: 'Faivri price check',
            text: captions.instagram,
            url: shareUrl || SITE_URL,
          })
          return
        } catch {
          // User cancelled — fall through to the clipboard path.
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

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-[var(--type-13)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
        aria-label="Share this verdict"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
      </button>
    )
  }

  const whatsappUrl = captions
    ? `https://wa.me/?text=${encodeURIComponent(captions.whatsapp)}`
    : '#'
  const telegramUrl = captions && shareUrl
    ? `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(captions.telegram)}`
    : '#'
  const twitterUrl = captions && shareUrl
    ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(captions.twitter)}&url=${encodeURIComponent(shareUrl)}`
    : '#'

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-4)]">
          <Share2 className="h-3 w-3" />
          Share this verdict
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[var(--type-12)] text-[var(--text-3)] underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      {minting && (
        <p className="mb-3 inline-flex items-center gap-1.5 text-[var(--type-12)] text-[var(--text-3)]">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating link…
        </p>
      )}

      {mintError && (
        <p className="mb-2 text-[var(--type-12)] text-[var(--amber-dim)]">
          {mintError} Falling back to faivri.com.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={whatsappUrl}
          aria-disabled={!captions}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md ${captions ? '' : 'pointer-events-none opacity-50'}`}
        >
          <WhatsappIcon />
          WhatsApp
        </a>
        <a
          href={telegramUrl}
          aria-disabled={!captions}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md ${captions ? '' : 'pointer-events-none opacity-50'}`}
        >
          <TelegramIcon />
          Telegram
        </a>
        <a
          href={twitterUrl}
          aria-disabled={!captions}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md ${captions ? '' : 'pointer-events-none opacity-50'}`}
        >
          <TwitterIcon />
          Post on X
        </a>
        <button
          type="button"
          disabled={!captions}
          onClick={onShareInstagram}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
          style={{
            background: 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
          }}
        >
          <InstagramIcon />
          {igCopied ? 'Caption copied' : 'Instagram'}
        </button>
        <button
          type="button"
          disabled={!captions}
          onClick={onCopy}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)] disabled:opacity-50"
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
              Copy link
            </>
          )}
        </button>
      </div>

      {shareUrl && (
        <p className="mt-3 truncate text-[var(--type-12)] text-[var(--text-4)]">
          Public link: <span className="font-mono">{shareUrl}</span>
        </p>
      )}
    </div>
  )
}
