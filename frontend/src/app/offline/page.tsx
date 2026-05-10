import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Offline — Faivri',
  description: 'You appear to be offline. Reconnect to run a fresh price check.',
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1A1814] text-white shadow-[0_18px_44px_rgba(15,15,15,0.18)]">
        <span className="text-[32px] font-bold leading-none">F</span>
      </div>
      <h1 className="text-[28px] font-semibold tracking-tight text-[#1A1814]">
        You&apos;re offline
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#6B6B6B]">
        Faivri runs live web searches against current market data, so a fresh
        check needs an internet connection. Recently viewed verdicts in your
        Vault are still readable from cache.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1A1814]"
        >
          Try again
        </Link>
        <Link
          href="/vault"
          className="inline-flex items-center rounded-full border border-[rgba(55,53,47,0.12)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#37352F] transition-colors hover:bg-[#F7F6F3]"
        >
          Open Vault
        </Link>
      </div>
    </div>
  )
}
