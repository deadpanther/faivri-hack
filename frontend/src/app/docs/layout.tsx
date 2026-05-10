import type { Metadata } from 'next'

import { DocsHeader } from '@/components/docs/DocsHeader'
import { DocsMobileNav } from '@/components/docs/DocsMobileNav'
import { DocsNavTabs } from '@/components/docs/DocsNavTabs'
import { DocsPager } from '@/components/docs/DocsPager'
import { DocsSidebar } from '@/components/docs/DocsSidebar'
import { DocsTOC } from '@/components/docs/DocsTOC'

export const metadata: Metadata = {
  title: { default: 'Docs', template: '%s — Faivri Docs' },
  description:
    'Build with Faivri — Quickstart, the typed TypeScript SDK, and the REST surface that powers every verdict.',
}

/**
 * unmint-style docs shell — sticky logo header + tab strip on desktop,
 * 3-column body (sidebar | content | TOC), pager at the bottom.
 *
 * The main app Nav still sits above this whole thing; we anchor the
 * sub-header to `--nav-clearance` so the docs chrome lines up below it
 * on every breakpoint.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--warm-bg)]">
      <DocsHeader />
      <DocsNavTabs />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8 py-8 md:py-10">
          <DocsSidebar />
          <main
            data-docs-main="true"
            className="min-w-0 flex-1 [&_h2]:scroll-mt-32 [&_h3]:scroll-mt-32"
          >
            <DocsMobileNav />
            <article className="docs-prose">{children}</article>
            <DocsPager />
          </main>
          <DocsTOC />
        </div>
      </div>
    </div>
  )
}
