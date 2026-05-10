'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(error)
    }
  }, [error])

  return (
    <section className="ui-section pb-24">
      <div className="ui-container max-w-2xl">
        <div className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--amber)_18%,transparent)] text-[var(--amber)]">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="mt-5 font-display text-[28px] font-semibold text-[var(--text-1)] md:text-[34px]">
            Something went sideways.
          </h1>
          <p className="mt-3 text-[15px] text-[var(--text-2)]">
            An unexpected error interrupted this page. It&apos;s not you — it&apos;s us. Try again, or
            head home.
          </p>
          {error?.digest ? (
            <p className="mt-2 text-[12px] text-[var(--text-3)]">
              Reference:{' '}
              <code className="rounded bg-[var(--warm-bg-tertiary)] px-1.5 py-0.5">
                {error.digest}
              </code>
            </p>
          ) : null}
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#333]"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)]"
            >
              Go home
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
