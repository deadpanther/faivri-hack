'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, LifeBuoy } from 'lucide-react'

import { DOCS_TREE, pathnameForSlug } from '@/lib/docs-nav'

const SUPPORT_HREF = 'mailto:support@faivri.com'

/**
 * Left rail. Quick-links block on top, then groups → pages from
 * `DOCS_TREE`. Active page gets the warm accent treatment.
 */
export function DocsSidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      <nav className="sticky top-[calc(env(safe-area-inset-top,0px)+var(--nav-clearance,64px)+12px+56px+48px+24px)] max-h-[calc(100dvh-12rem)] overflow-y-auto pb-10 pr-4">
        <div className="mb-5 border-b border-[var(--border)] pb-5">
          <ul className="space-y-1">
            <SidebarQuickLink
              href="/docs"
              label="Documentation"
              icon={<BookOpen className="h-4 w-4" />}
              tone="accent"
            />
            <SidebarQuickLink
              href={SUPPORT_HREF}
              label="Support"
              icon={<LifeBuoy className="h-4 w-4" />}
            />
          </ul>
        </div>

        {DOCS_TREE.map((group) => (
          <div key={group.label} className="mb-5">
            <h5 className="mb-1.5 text-[13px] font-semibold text-[var(--text-1)]">
              {group.label}
            </h5>
            <ul className="space-y-0.5">
              {group.pages.map((page) => {
                const href = pathnameForSlug(page.slug)
                const isActive = pathname === href
                return (
                  <li key={page.slug || 'root'} className="list-none">
                    <Link
                      href={href}
                      className={`flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${
                        isActive
                          ? 'bg-[var(--warm-bg-secondary)] font-semibold text-[var(--text-1)]'
                          : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
                      }`}
                    >
                      <span>{page.title}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}

function SidebarQuickLink({
  href,
  label,
  icon,
  tone,
}: {
  href: string
  label: string
  icon: React.ReactNode
  tone?: 'accent'
}) {
  const baseTone =
    tone === 'accent'
      ? 'text-[var(--text-1)] font-semibold'
      : 'text-[var(--text-3)] hover:text-[var(--text-1)]'

  const inner = (
    <span className="flex items-center gap-2.5 py-1 text-[13px]">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--warm-bg-secondary)] text-[var(--text-2)]">
        {icon}
      </span>
      {label}
    </span>
  )

  return (
    <li className="list-none">
      <Link href={href} className={`block transition-colors ${baseTone}`}>
        {inner}
      </Link>
    </li>
  )
}
