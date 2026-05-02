'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'

import { DOCS_TABS, DOCS_TREE, pathnameForSlug } from '@/lib/docs-nav'

/**
 * Below the lg breakpoint we don't have room for a permanent sidebar
 * or sticky tab strip — collapse the whole nav into a single
 * <details> at the top of the content area. Lightweight, no JS state.
 */
export function DocsMobileNav() {
  const pathname = usePathname()
  const activeTab =
    DOCS_TABS
      .filter((t) => pathname.startsWith(t.match))
      .sort((a, b) => b.match.length - a.match.length)[0] || DOCS_TABS[0]

  return (
    <details className="group mb-6 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] lg:hidden">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[13px] font-semibold text-[var(--text-1)] [&::-webkit-details-marker]:hidden">
        <span>
          <span className="text-[var(--text-3)]">Docs / </span>
          {activeTab.label}
        </span>
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="mb-3 flex items-center gap-2">
          {DOCS_TABS.map((tab) => {
            const isActive = activeTab.match === tab.match
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-[var(--text-1)] text-white'
                    : 'bg-[var(--warm-bg-secondary)] text-[var(--text-2)]'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>

        {DOCS_TREE.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.pages.map((page) => {
                const href = pathnameForSlug(page.slug)
                const isActive = pathname === href
                return (
                  <li key={page.slug || 'root'}>
                    <Link
                      href={href}
                      className={`block rounded-md px-2 py-1 text-[13px] transition-colors ${
                        isActive
                          ? 'bg-[var(--warm-bg-secondary)] font-semibold text-[var(--text-1)]'
                          : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
                      }`}
                    >
                      {page.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  )
}
