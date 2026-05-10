'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'

/**
 * Sub-header that sits below the main app Nav on every /docs page.
 *
 * Mirrors unmint's docs-header (sticky + search trigger) with
 * Faivri's warm color tokens. Search is a stub for
 * now — we have no docs index to query yet, so it dispatches a
 * `keydown:k+meta` listener up the page in case we wire it in later.
 */
export function DocsHeader() {
  return (
    <header
      className="sticky z-30 border-b border-[var(--border)] bg-white/90 backdrop-blur-sm"
      style={{
        top: 'calc(env(safe-area-inset-top, 0px) + var(--nav-clearance, 64px) + 12px)',
      }}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/docs" className="flex items-center">
          <span className="font-display text-[15px] font-semibold tracking-tight text-[var(--text-1)]">
            Faivri Docs
          </span>
        </Link>

        <div className="flex flex-1 justify-center px-2 sm:px-4">
          <button
            type="button"
            className="hidden w-full max-w-sm items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-1.5 text-left text-[13px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)] sm:inline-flex"
            aria-label="Search docs"
            disabled
          >
            <Search className="h-4 w-4" />
            <span className="flex-1">Search docs…</span>
            <kbd className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--text-3)] shadow-[inset_0_-1px_0_var(--border)]">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>
    </header>
  )
}
