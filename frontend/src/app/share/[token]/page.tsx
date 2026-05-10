import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { formatPrice } from '@/lib/constants'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const SITE_URL = 'https://faivri.com'

interface PublicShare {
  kind: 'query' | 'purchase'
  domain: string
  currency: string
  quoted_price_cents: number | null
  fair_low_cents: number | null
  fair_high_cents: number | null
  overcharge_multiplier: number | null
  verdict: string | null
  title: string
  subtitle: string | null
  created_at: string | null
  view_count: number
}

async function fetchShare(token: string): Promise<PublicShare | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/share/${encodeURIComponent(token)}`,
      { next: { revalidate: 60 } },
    )
    if (!res.ok) return null
    return (await res.json()) as PublicShare
  } catch {
    return null
  }
}

function verdictPalette(verdict: string | null) {
  switch (verdict) {
    case 'overcharge':
    case 'overpriced':
      return {
        label: 'Overcharge detected',
        text: '#7C2D12',
        bg: 'rgba(248, 113, 113, 0.12)',
        accent: 'var(--red, #DC2626)',
      }
    case 'high':
      return {
        label: 'On the high side',
        text: '#854D0E',
        bg: 'rgba(245, 158, 11, 0.12)',
        accent: 'var(--amber, #D97706)',
      }
    case 'fair':
    case 'fairly_priced':
      return {
        label: 'Fair price',
        text: '#065F46',
        bg: 'rgba(16, 185, 129, 0.12)',
        accent: 'var(--green, #059669)',
      }
    case 'low':
    case 'great_deal':
      return {
        label: 'Below market',
        text: '#1E3A8A',
        bg: 'rgba(59, 130, 246, 0.12)',
        accent: 'var(--blue, #2563EB)',
      }
    default:
      return {
        label: 'Verified by Faivri',
        text: 'var(--text-1)',
        bg: 'var(--warm-bg-tertiary)',
        accent: 'var(--text-1)',
      }
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const data = await fetchShare(token)
  if (!data) {
    return {
      title: 'Faivri — Shared verdict',
      description: 'AI-backed price check shared via Faivri.',
    }
  }
  const fair =
    data.fair_low_cents != null && data.fair_high_cents != null
      ? `${formatPrice(data.fair_low_cents, data.currency)}–${formatPrice(data.fair_high_cents, data.currency)}`
      : null
  const quoted =
    data.quoted_price_cents != null
      ? formatPrice(data.quoted_price_cents, data.currency)
      : null
  const overpay =
    data.quoted_price_cents != null &&
    data.fair_high_cents != null &&
    data.quoted_price_cents > data.fair_high_cents
      ? data.quoted_price_cents - data.fair_high_cents
      : null

  const headline = overpay
    ? `Faivri caught a ${formatPrice(overpay, data.currency)} overcharge on ${data.title}.`
    : quoted && fair
    ? `${data.title}: quoted ${quoted}, fair ${fair}.`
    : `${data.title} — price-checked by Faivri.`

  const description =
    'AI-backed price check with live market sources. Try Faivri before your next quote.'

  return {
    title: `${headline} · Faivri`,
    description,
    openGraph: {
      title: headline,
      description,
      url: `${SITE_URL}/share/${token}`,
      siteName: 'Faivri',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: headline,
      description,
    },
    robots: { index: false, follow: false },
  }
}

export default async function PublicSharePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const data = await fetchShare(token)
  if (!data) {
    notFound()
  }

  const palette = verdictPalette(data.verdict)
  const quoted =
    data.quoted_price_cents != null
      ? formatPrice(data.quoted_price_cents, data.currency)
      : null
  const fairLow =
    data.fair_low_cents != null
      ? formatPrice(data.fair_low_cents, data.currency)
      : null
  const fairHigh =
    data.fair_high_cents != null
      ? formatPrice(data.fair_high_cents, data.currency)
      : null
  const overpay =
    data.quoted_price_cents != null &&
    data.fair_high_cents != null &&
    data.quoted_price_cents > data.fair_high_cents
      ? data.quoted_price_cents - data.fair_high_cents
      : null
  const multiplier =
    data.overcharge_multiplier != null
      ? `${data.overcharge_multiplier.toFixed(2)}×`
      : null

  return (
    <main className="min-h-screen bg-[var(--warm-bg)] px-4 py-10 sm:py-16">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[var(--type-14)] font-semibold text-[var(--text-1)]"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-black text-[var(--type-12)] font-bold text-white"
              aria-hidden
            >
              F
            </span>
            Faivri
          </Link>
          <span className="text-[var(--type-12)] text-[var(--text-4)]">
            Public share · {data.view_count} {data.view_count === 1 ? 'view' : 'views'}
          </span>
        </header>

        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 shadow-sm sm:p-8">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-[var(--type-12)] font-semibold uppercase tracking-[0.14em]"
            style={{ backgroundColor: palette.bg, color: palette.text }}
          >
            {palette.label}
          </span>

          <h1 className="mt-4 text-[var(--type-28)] font-bold leading-tight text-[var(--text-1)] sm:text-[var(--type-32)]">
            {data.title}
          </h1>
          {data.subtitle && (
            <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
              {data.subtitle}
            </p>
          )}

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            {quoted && (
              <div className="rounded-2xl bg-[var(--warm-bg-tertiary)] p-4">
                <dt className="text-[var(--type-12)] font-semibold uppercase tracking-[0.14em] text-[var(--text-4)]">
                  Quoted
                </dt>
                <dd className="mt-1 text-[var(--type-24)] font-bold text-[var(--text-1)]">
                  {quoted}
                </dd>
              </div>
            )}
            {fairLow && fairHigh && (
              <div className="rounded-2xl bg-[var(--warm-bg-tertiary)] p-4">
                <dt className="text-[var(--type-12)] font-semibold uppercase tracking-[0.14em] text-[var(--text-4)]">
                  Fair range
                </dt>
                <dd className="mt-1 text-[var(--type-24)] font-bold text-[var(--text-1)]">
                  {fairLow} – {fairHigh}
                </dd>
              </div>
            )}
          </dl>

          {(overpay || multiplier) && (
            <div
              className="mt-5 rounded-2xl p-4"
              style={{ backgroundColor: palette.bg }}
            >
              <p
                className="text-[var(--type-12)] font-semibold uppercase tracking-[0.14em]"
                style={{ color: palette.text }}
              >
                Overcharge
              </p>
              <p className="mt-1 text-[var(--type-20)] font-bold" style={{ color: palette.text }}>
                {overpay ? `${formatPrice(overpay, data.currency)} above fair` : ''}
                {overpay && multiplier ? ' · ' : ''}
                {multiplier ? `${multiplier} the fair price` : ''}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-[var(--border)] bg-white p-6 sm:p-8">
          <h2 className="text-[var(--type-18)] font-semibold text-[var(--text-1)]">
            Want this for your next quote?
          </h2>
          <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
            Faivri pulls live market comps and runs an AI verdict in ten seconds. Free to start.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/"
              className="ui-button-primary inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[var(--type-14)] font-semibold"
            >
              Try Faivri free
            </Link>
            <Link
              href="/extension"
              className="ui-button-secondary inline-flex items-center justify-center gap-2 px-5 py-2.5 text-[var(--type-14)] font-semibold"
            >
              Get the Chrome extension
            </Link>
          </div>
        </section>

        <p className="text-center text-[var(--type-12)] text-[var(--text-4)]">
          This is a public share link. Faivri does not show the original receipt or vendor — only the
          headline figures.
        </p>
      </div>
    </main>
  )
}
