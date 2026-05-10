import Link from 'next/link'
import { Compass, Home } from 'lucide-react'

export const metadata = {
  title: 'Page not found',
  description: 'That page doesn\u2019t exist on Faivri.',
}

export default function NotFound() {
  return (
    <section className="ui-section pb-24">
      <div className="ui-container max-w-2xl">
        <div className="relative overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-8 md:p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--blue)_18%,transparent)] text-[var(--blue)]">
            <Compass className="h-6 w-6" />
          </div>
          <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
            404
          </p>
          <h1 className="mt-2 font-display text-[28px] font-semibold text-[var(--text-1)] md:text-[34px]">
            That page isn&apos;t here.
          </h1>
          <p className="mt-3 text-[15px] text-[var(--text-2)]">
            The link may be broken, or the page was moved. Everything else on Faivri is still a
            click away.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#333]"
            >
              <Home className="h-4 w-4" />
              Back home
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-tertiary)]"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
