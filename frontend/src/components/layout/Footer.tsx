'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Show, SignUpButton } from '@clerk/nextjs'
import {
  ArrowRight,
  LifeBuoy,
  Mail,
  Puzzle,
  Sparkles,
} from 'lucide-react'

import BrandMark from '@/components/ui/BrandMark'
import { CHROME_EXTENSION_URL } from '@/lib/constants'

const SUPPORT_EMAIL = 'support@faivri.com'

const productLinks = [
  { href: '/', label: 'Analyze a quote' },
  { href: '/community', label: 'Market Intelligence' },
  { href: '/vault', label: 'Your Vault' },
  { href: '/pricing', label: 'Pricing' },
]

const companyLinks: { href: string; label: string; external?: boolean }[] = [
  { href: '/docs', label: 'Docs', external: true },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/refund', label: 'Refunds' },
]

// Builds a mailto link with a prefilled template so users give us enough
// context to actually debug. Captures the URL they're on and their browser
// string — things they usually forget to include when firing off a support
// email. `navigator` lookup guarded for SSR.
function supportMailto(pathname: string | null): string {
  const ua =
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const body = [
    'Describe what happened:',
    '',
    '',
    '',
    'What did you expect to happen?',
    '',
    '',
    '',
    '— page: ' + (pathname || '/'),
    '— browser: ' + ua,
  ].join('\n')
  const params = new URLSearchParams({
    subject: 'Faivri support request',
    body,
  })
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`
}

export function Footer() {
  const pathname = usePathname()

  return (
    <footer data-app-footer="true" className="mt-12 md:mt-24">
      {/* ── CTA banner (signed-out only) ──────────────────────────────── */}
      <Show when="signed-out">
        <section className="ui-container pb-8">
          <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-10">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-60 motion-reduce:hidden"
              style={{
                background:
                  'radial-gradient(circle, color-mix(in srgb, var(--amber) 30%, transparent) 0%, transparent 70%)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -left-24 bottom-0 h-52 w-52 rounded-full opacity-50 motion-reduce:hidden"
              style={{
                background:
                  'radial-gradient(circle, color-mix(in srgb, var(--blue) 25%, transparent) 0%, transparent 70%)',
              }}
            />
            <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-2)]">
                  <Sparkles className="h-3 w-3" />
                  Free to start
                </div>
                <h3 className="mt-3 font-display text-[24px] font-semibold leading-tight text-[var(--text-1)] md:text-[30px]">
                  Ready to catch your next overcharge?
                </h3>
                <p className="mt-2 text-sm text-[var(--text-2)] md:text-[15px]">
                  Ten seconds, one quote, honest answer — with the comps to
                  back it up.
                </p>
              </div>
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <SignUpButton>
                  <button className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#333]">
                    Start free
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </SignUpButton>
                <a
                  href={CHROME_EXTENSION_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)]"
                >
                  <Puzzle className="h-4 w-4" />
                  Add to Chrome
                </a>
              </div>
            </div>
          </div>
        </section>
      </Show>

      {/* ── Main footer grid ─────────────────────────────────────────── */}
      <div className="border-t border-[var(--border)] bg-[var(--warm-bg)]">
        <div className="ui-container py-12">
          <div className="grid gap-10 md:grid-cols-12">
            {/* Brand column */}
            <div className="md:col-span-5">
              <Link href="/" className="inline-flex items-center gap-2.5">
                <BrandMark size="md" />
                <div>
                  <p className="font-display text-[18px] font-semibold leading-none tracking-tight text-[var(--text-1)]">
                    Faivri
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-3)]">
                    Pricing Intelligence OS
                  </p>
                </div>
              </Link>
              <p className="mt-4 max-w-sm text-sm text-[var(--text-2)]">
                Know if you&apos;re being overcharged in under ten seconds.
                Live market comps, not opinions — every verdict cites its
                sources.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/80 px-3 py-1.5 text-xs text-[var(--text-2)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--green)] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--green)]" />
                </span>
                All systems operational
              </div>
            </div>

            {/* Product column */}
            <div className="md:col-span-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                Product
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {productLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <a
                    href={CHROME_EXTENSION_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                  >
                    Chrome extension
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </li>
              </ul>
            </div>

            {/* Company column */}
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                Company
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {companyLinks.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Support column */}
            <div className="md:col-span-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                Need help?
              </p>
              <a
                href={supportMailto(pathname)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--text-1)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all hover:border-[var(--border-hover)] hover:bg-[var(--warm-bg-tertiary)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)]"
              >
                <LifeBuoy className="h-4 w-4" />
                Contact support
              </a>
              <p className="mt-3 text-[11px] text-[var(--text-3)]">
                We reply within one business day.
              </p>
            </div>
          </div>
        </div>

        {/* ── Bottom bar ─────────────────────────────────────────────── */}
        <div className="border-t border-[var(--border)]">
          <div className="ui-container flex flex-col items-start justify-between gap-3 py-5 text-xs text-[var(--text-3)] md:flex-row md:items-center">
            <span>© {new Date().getFullYear()} Faivri. Built for consumers.</span>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/70 px-3 py-1.5 text-[var(--text-2)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-1)]"
            >
              <Mail className="h-3.5 w-3.5" />
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
