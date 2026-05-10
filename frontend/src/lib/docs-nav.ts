/**
 * Static page-tree for the docs section.
 *
 * Drives the unmint-style sidebar + tab bar + prev/next pager on every
 * page under /docs. Adding a doc page = appending a `DocPage` here and
 * creating the route. No MDX, no Fumadocs.
 */

export type DocPage = {
  /** Stable slug — also the route under /docs (root page is empty string). */
  slug: string
  /** Title shown in sidebar + browser tab. */
  title: string
  /** One-line summary used by /docs index cards and search. */
  summary?: string
}

export type DocGroup = {
  /** Heading shown above this group in the sidebar. */
  label: string
  /** Optional sub-route prefix; defaults to `/docs`. */
  href?: string
  pages: DocPage[]
}

export type DocTab = {
  label: string
  /** Path the tab navigates to when clicked. */
  href: string
  /** Pathname prefix for "is this tab active?" matching. */
  match: string
}

export const DOCS_TABS: DocTab[] = [
  { label: 'Guides', href: '/docs', match: '/docs' },
  { label: 'SDK', href: '/docs/sdk', match: '/docs/sdk' },
]

export const DOCS_TREE: DocGroup[] = [
  {
    label: 'Get started',
    pages: [
      {
        slug: '',
        title: 'Introduction',
        summary: 'What Faivri is, who it’s for, and how to ship in five minutes.',
      },
    ],
  },
  {
    label: 'Build with Faivri',
    pages: [
      {
        slug: 'sdk',
        title: 'TypeScript SDK',
        summary: 'Install, authenticate, analyze, negotiate, and handle errors.',
      },
    ],
  },
]

/** Flatten the tree into a linear order for prev/next navigation. */
export function flattenDocs(): DocPage[] {
  const out: DocPage[] = []
  for (const group of DOCS_TREE) {
    for (const page of group.pages) {
      out.push(page)
    }
  }
  return out
}

export function pathnameForSlug(slug: string): string {
  return slug ? `/docs/${slug}` : '/docs'
}

export function slugForPathname(pathname: string): string {
  if (pathname === '/docs' || pathname === '/docs/') return ''
  return pathname.replace(/^\/docs\//, '').replace(/\/$/, '')
}

export function findAdjacent(slug: string): {
  previous?: DocPage
  next?: DocPage
} {
  const flat = flattenDocs()
  const idx = flat.findIndex((p) => p.slug === slug)
  if (idx === -1) return {}
  return {
    previous: idx > 0 ? flat[idx - 1] : undefined,
    next: idx < flat.length - 1 ? flat[idx + 1] : undefined,
  }
}
