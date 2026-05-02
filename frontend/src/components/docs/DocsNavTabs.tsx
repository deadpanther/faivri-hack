'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { DOCS_TABS } from '@/lib/docs-nav'

/**
 * Sticky tab strip below the docs sub-header. Picks the most-specific
 * matching tab as active so /docs/sdk highlights "SDK" and not "Guides".
 */
export function DocsNavTabs() {
  const pathname = usePathname()

  const active = DOCS_TABS
    .filter((tab) => pathname.startsWith(tab.match))
    .sort((a, b) => b.match.length - a.match.length)[0]

  return (
    <div className="sticky top-[calc(env(safe-area-inset-top,0px)+var(--nav-clearance,64px)+12px+56px)] z-20 hidden border-b border-[var(--border)] bg-white/95 backdrop-blur-sm lg:block">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-1">
          {DOCS_TABS.map((tab) => {
            const isActive = active?.match === tab.match
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative px-4 py-3 text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'text-[var(--text-1)]'
                    : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
                }`}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute bottom-[-1px] left-3 right-3 h-0.5 rounded-full bg-[var(--text-1)]" />
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
