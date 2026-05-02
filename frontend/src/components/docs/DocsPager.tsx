'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { findAdjacent, pathnameForSlug, slugForPathname } from '@/lib/docs-nav'

/**
 * Bottom-of-page prev/next pair, computed from the flattened DOCS_TREE.
 * Renders nothing on pages outside the tree (e.g. dynamic SDK subpages).
 */
export function DocsPager() {
  const pathname = usePathname()
  const slug = slugForPathname(pathname)
  const { previous, next } = findAdjacent(slug)

  if (!previous && !next) return null

  return (
    <nav className="mt-16 flex items-stretch justify-between gap-3 border-t border-[var(--border)] pt-6">
      {previous ? (
        <Link
          href={pathnameForSlug(previous.slug)}
          className="group flex max-w-[48%] flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-3 transition-colors hover:border-[var(--border-strong)]"
        >
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            <ArrowLeft className="h-3 w-3" />
            Previous
          </span>
          <span className="text-[14px] font-semibold text-[var(--text-1)] group-hover:underline">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next ? (
        <Link
          href={pathnameForSlug(next.slug)}
          className="group ml-auto flex max-w-[48%] flex-col items-end gap-1 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-3 text-right transition-colors hover:border-[var(--border-strong)]"
        >
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Next
            <ArrowRight className="h-3 w-3" />
          </span>
          <span className="text-[14px] font-semibold text-[var(--text-1)] group-hover:underline">
            {next.title}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  )
}
