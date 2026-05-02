'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus } from 'lucide-react'

import { scrollReveal, scrollStagger } from '@/lib/motion'

type Faq = { q: string; a: string }

const FAQS: Faq[] = [
  {
    q: 'How does Faivri know the fair price?',
    a: 'We pull live quotes from the open web the moment you ask — shop listings, invoices, pricing aggregators, and published rate cards. The LLM synthesizes a fair range with a confidence score from those sources. Nothing is made up; every verdict cites the domains it used.',
  },
  {
    q: 'Is my data private? Do you store my quotes?',
    a: 'Anonymous queries aren\'t tied to you and are only cached briefly for performance. Signed-in queries are saved to your private history so you can revisit them — you can delete any query or purge the whole history from the Vault at any time. We never sell data and never share it with vendors.',
  },
  {
    q: 'What domains do you cover?',
    a: 'Auto repair, medical, home services, and legal today. The underlying engine is domain-agnostic — we\'re expanding to dental, veterinary, and consumer electronics next. If you hit something we don\'t cover well, the verdict comes back honest ("insufficient data") instead of guessing.',
  },
  {
    q: 'How is this different from Google or price comparison sites?',
    a: 'Google gives you links. Comparison sites give you a spreadsheet. Faivri gives you a verdict: "fair" or "overcharge," the expected market range, the signals behind it, and a negotiation script you can paste into a text to your mechanic. It\'s the "what do I do about this" layer on top of pricing data.',
  },
  {
    q: 'Do I need to sign up to try it?',
    a: 'No. Anonymous users get a generous free trial per day, per IP. Sign in only if you want history, savings tracking, or higher monthly limits.',
  },
  {
    q: 'What happens if you\'re wrong?',
    a: 'Every verdict ships with a confidence score and a "signals used" list — if we had thin data, we say so. We also expose a counter-offer workflow: if the vendor pushes back, Faivri adjusts the ask based on your new info. Our goal is to be useful, not infallible.',
  },
  {
    q: 'Can I use the API in my own product?',
    a: 'Yes. Our TypeScript SDK (and the underlying REST API) gives you the same analyze → negotiate → feedback flow the app uses. Pricing details are on the /pricing page; developer docs live under /docs.',
  },
]

export default function FaqSection() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className="ui-section">
      <div className="ui-container max-w-3xl">
        <motion.div {...scrollReveal(0)} className="text-center mb-10">
          <p className="ui-kicker justify-center">Common Questions</p>
          <h2 className="ui-title-section mt-3 text-[var(--text-1)]">Before you sign up.</h2>
          <p className="ui-lead mt-3 mx-auto text-center">
            Quick answers to the things people ask first.
          </p>
        </motion.div>

        <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)]">
          {FAQS.map((faq, i) => {
            const isOpen = open === i
            return (
              <motion.div key={faq.q} {...scrollStagger(i * 0.04)}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-[var(--warm-bg-secondary)]"
                  aria-expanded={isOpen}
                >
                  <span className="font-display text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                    {faq.q}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-white">
                    {isOpen ? (
                      <Minus className="h-4 w-4 text-[var(--text-2)]" />
                    ) : (
                      <Plus className="h-4 w-4 text-[var(--text-2)]" />
                    )}
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 text-[var(--type-14)] leading-relaxed text-[var(--text-3)]">
                        {faq.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
