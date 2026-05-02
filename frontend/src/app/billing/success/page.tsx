'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'

// Stripe redirects here with ?session_id={CHECKOUT_SESSION_ID}. The webhook
// is the source of truth for plan transitions; this page just confirms the
// charge succeeded and points the user back into the app. We don't poll for
// the plan column here — the webhook lands within seconds and the next
// /usage call on the home page (the analyzer for signed-in users) will
// reflect the new plan.

function BillingSuccessInner() {
  const search = useSearchParams()
  const sessionId = search.get('session_id')
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    // If the Stripe webhook is delayed, give the backend ~6s before the
    // user clicks through — most webhooks arrive within 2s. We don't block
    // navigation; just stop showing the spinner copy after the timeout.
    const t = setTimeout(() => setShowFallback(true), 6000)
    return () => clearTimeout(t)
  }, [])

  return (
    <section className="ui-section pb-20 pt-16">
      <div className="ui-container max-w-xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-8 text-center shadow-[var(--shadow-md)]"
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--green)] bg-[color-mix(in_srgb,var(--green)_12%,transparent)]">
            <CheckCircle2 className="h-6 w-6 text-[var(--green)]" />
          </div>
          <h1 className="ui-title-section">Payment received</h1>
          <p className="ui-lead mt-3">
            Thanks — your plan is being activated. You can start using your new analyses right away.
          </p>
          {!showFallback ? (
            <p className="mt-4 inline-flex items-center gap-2 text-[var(--type-13)] text-[var(--text-3)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Confirming with our system…
            </p>
          ) : (
            <p className="mt-4 text-[var(--type-13)] text-[var(--text-3)]">
              Taking longer than usual? Refresh in a minute or contact support — your charge is safe.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--text-1)] px-4 py-2 text-[var(--type-14)] font-semibold text-white transition-colors hover:bg-black"
            >
              Start analyzing
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-[var(--type-14)] font-semibold text-[var(--text-1)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
            >
              View plans
            </Link>
          </div>
          {sessionId && (
            <p className="mt-5 break-all text-[10px] text-[var(--text-4)]">Receipt id: {sessionId}</p>
          )}
        </motion.div>
      </div>
    </section>
  )
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={null}>
      <BillingSuccessInner />
    </Suspense>
  )
}
