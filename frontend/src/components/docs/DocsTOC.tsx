'use client'

import { useEffect, useState } from 'react'

type Heading = {
  id: string
  text: string
  depth: 2 | 3
}

/**
 * Right-rail "On this page" — observes h2/h3 inside the docs <main>
 * after mount. Pages are responsible for giving their headings stable
 * ids; anything without an id is skipped.
 */
export function DocsTOC() {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    const main = document.querySelector('main[data-docs-main="true"]')
    if (!main) return

    const nodes = Array.from(
      main.querySelectorAll('h2[id], h3[id]'),
    ) as HTMLHeadingElement[]
    const list: Heading[] = nodes.map((el) => ({
      id: el.id,
      text: el.textContent?.trim() || el.id,
      depth: el.tagName === 'H3' ? 3 : 2,
    }))
    const rafId = window.requestAnimationFrame(() => {
      setHeadings(list)
      if (list.length > 0) setActiveId(list[0].id)
    })

    if (list.length === 0) {
      return () => window.cancelAnimationFrame(rafId)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-120px 0px -66% 0px' },
    )

    nodes.forEach((n) => observer.observe(n))
    return () => {
      window.cancelAnimationFrame(rafId)
      nodes.forEach((n) => observer.unobserve(n))
    }
  }, [])

  if (headings.length === 0) return null

  return (
    <aside className="hidden w-56 shrink-0 xl:block">
      <nav className="sticky top-[calc(env(safe-area-inset-top,0px)+var(--nav-clearance,64px)+12px+56px+48px+24px)] max-h-[calc(100dvh-12rem)] overflow-y-auto pl-4">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
          On this page
        </p>
        <ul className="space-y-1.5 text-[13px]">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={`block py-0.5 transition-colors ${
                  h.depth === 3 ? 'pl-3' : ''
                } ${
                  activeId === h.id
                    ? 'font-semibold text-[var(--text-1)]'
                    : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
                }`}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
