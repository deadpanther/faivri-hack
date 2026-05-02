'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
} from 'lucide-react'

import { api, ApiError, type PhotonReplyData } from '@/lib/api'
import { reveal } from '@/lib/motion'

type Tone = 'polite' | 'firm' | 'walk_away' | 'friendly'

const TONES: Array<{ id: Tone; label: string; hint: string }> = [
  { id: 'polite', label: 'Polite', hint: 'Warm, respectful, no aggression' },
  { id: 'firm', label: 'Firm', hint: 'Direct and confident on the math' },
  { id: 'walk_away', label: 'Walk away', hint: 'Polite goodbye at your ceiling' },
  { id: 'friendly', label: 'Friendly', hint: 'Casual and conversational' },
]

function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function MessagesPage() {
  const search = useSearchParams()
  // Pre-fill query_id when the user came from the verdict page via
  // /messages?query_id=... so they don't have to copy the UUID by hand.
  const initialQueryId = search?.get('query_id') ?? ''

  const [queryId, setQueryId] = useState(initialQueryId)
  const [sellerMessage, setSellerMessage] = useState('')
  const [userIntent, setUserIntent] = useState('')
  const [tone, setTone] = useState<Tone>('polite')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState<PhotonReplyData | null>(null)
  const [copied, setCopied] = useState(false)

  const canSubmit = useMemo(
    () => queryId.trim().length > 0 && sellerMessage.trim().length > 0 && !loading,
    [queryId, sellerMessage, loading],
  )

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    setReply(null)
    try {
      const res = await api.draftMessageReply({
        query_id: queryId.trim(),
        seller_message: sellerMessage.trim(),
        user_intent: userIntent.trim() || undefined,
        tone,
      })
      setReply(res)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setError(
            'No negotiation memory for that verdict yet. Run an analysis first, then come back here.',
          )
        } else {
          setError(err.message)
        }
      } else {
        setError('Something went wrong. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!reply?.reply) return
    try {
      await navigator.clipboard.writeText(reply.reply)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="ui-section">
      <div className="ui-container max-w-4xl">
        <motion.div {...reveal(0)}>
          <div className="ui-kicker">
            <Sparkles className="h-3.5 w-3.5" />
            Photon · Messaging Assistant
          </div>
          <h1 className="ui-title-section mt-3">
            Draft a polite, data-backed reply.
          </h1>
          <p className="ui-lead mt-2 max-w-2xl">
            Paste what the seller said. Photon reads your verdict&apos;s
            negotiation memory in HydraDB &mdash; the fair-price range, your
            walk-away ceiling, prior counter-offers &mdash; and writes the next
            message you should send.
          </p>
        </motion.div>

        <motion.form
          {...reveal(0.1)}
          onSubmit={handleSubmit}
          className="mt-8 grid gap-4 rounded-3xl border border-[var(--border)] bg-white/80 p-6 backdrop-blur-sm md:p-8"
        >
          {/* Verdict ID */}
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
              Verdict ID
            </span>
            <input
              type="text"
              value={queryId}
              onChange={(e) => setQueryId(e.target.value)}
              placeholder="Paste the query_id from your verdict page"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-white px-4 py-3 font-mono text-[13px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--border-accent)] focus:shadow-[var(--shadow-ring)]"
            />
            <p className="mt-1 text-[12px] text-[var(--text-3)]">
              Open a verdict, click Negotiate, and the URL is `/result/&lt;id&gt;`.
            </p>
          </label>

          {/* Seller message */}
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
              Seller&apos;s message
            </span>
            <textarea
              value={sellerMessage}
              onChange={(e) => setSellerMessage(e.target.value)}
              placeholder="Paste verbatim — &ldquo;That&rsquo;s my best price, take it or leave it…&rdquo;"
              rows={5}
              className="mt-1.5 w-full resize-none rounded-xl border border-[var(--border-strong)] bg-white px-4 py-3 text-[15px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--border-accent)] focus:shadow-[var(--shadow-ring)]"
              maxLength={4000}
            />
          </label>

          {/* Optional user intent */}
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
              Your intent <span className="font-normal normal-case text-[var(--text-3)]">(optional)</span>
            </span>
            <input
              type="text"
              value={userIntent}
              onChange={(e) => setUserIntent(e.target.value)}
              placeholder="e.g. Hold firm at $400, willing to walk away"
              className="mt-1.5 w-full rounded-xl border border-[var(--border-strong)] bg-white px-4 py-3 text-[14px] text-[var(--text-1)] outline-none transition-colors focus:border-[var(--border-accent)] focus:shadow-[var(--shadow-ring)]"
              maxLength={500}
            />
          </label>

          {/* Tone toggle */}
          <fieldset>
            <legend className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
              Tone
            </legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TONES.map((t) => {
                const active = t.id === tone
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? 'border-[var(--text-1)] bg-[var(--text-1)] text-white'
                        : 'border-[var(--border)] bg-white text-[var(--text-1)] hover:border-[var(--border-hover)]'
                    }`}
                  >
                    <p className="text-[13px] font-semibold">{t.label}</p>
                    <p className={`mt-0.5 text-[11px] ${active ? 'text-white/70' : 'text-[var(--text-3)]'}`}>
                      {t.hint}
                    </p>
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Submit */}
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12px] text-[var(--text-3)]">
              Replies are grounded in your verdict&apos;s fair-price range and
              walk-away ceiling. Photon never invents numbers.
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Drafting…
                </>
              ) : (
                <>
                  Draft reply
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[var(--red)]/30 bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-4 py-3 text-[13px] text-[var(--red)]"
            >
              {error}
            </div>
          )}
        </motion.form>

        {/* Reply card */}
        {reply && (
          <motion.section
            {...reveal(0)}
            className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6 md:p-8"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-2)]">
                <MessageSquare className="h-3 w-3" />
                Photon draft · {reply.tone}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--text-1)] transition-colors hover:border-[var(--border-hover)] hover:bg-[var(--warm-bg-tertiary)]"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[var(--green)]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>

            <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text-1)]">
              {reply.reply}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                  Suggested counter
                </p>
                <p className="mt-1 font-mono text-[16px] font-semibold text-[var(--text-1)]">
                  {formatCents(reply.suggested_price_cents)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-3)]">
                  Served by
                </p>
                <p className="mt-1 font-mono text-[13px] uppercase tracking-wide text-[var(--text-1)]">
                  {reply.served_by === 'gmi_cloud' ? 'GMI Cloud GPU fleet' : reply.served_by}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 text-[12px] text-[var(--text-3)] sm:grid-cols-2">
              <p>
                Fair range: <span className="font-mono text-[var(--text-2)]">
                  {formatCents(reply.grounded_in.fair_low_cents)} &mdash; {formatCents(reply.grounded_in.fair_high_cents)}
                </span>
              </p>
              <p>
                Walk-away: <span className="font-mono text-[var(--text-2)]">
                  {formatCents(reply.grounded_in.walk_away_cents)}
                </span>
              </p>
              <p>Prior messages on file: {reply.grounded_in.prior_messages}</p>
              <p>Prior counter-offers: {reply.grounded_in.prior_counters}</p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
              <Send className="h-3.5 w-3.5" />
              Paste this into iMessage, WhatsApp, or Marketplace chat &mdash;
              HydraDB will remember the seller&apos;s next reply automatically.
            </div>
          </motion.section>
        )}
      </div>
    </div>
  )
}
