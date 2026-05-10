'use client'

/**
 * Live negotiation coach for the /result/purchase/[slug] page.
 *
 * Two inputs:
 *   - "Seller said" → counterparty's last message (free text)
 *   - "Counter ($)" → optional dollar amount the seller offered, runs the
 *     deterministic accept / re-counter math via /negotiate/purchase-chat
 *
 * History persists in localStorage keyed by purchase_id, so a refresh during
 * the demo doesn't blow away the conversation. Messages render as a chat
 * bubble timeline with role-tagged styles (you / seller / coach).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Handshake,
  Loader2,
  MessageSquare,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'

import { api, PurchaseChatTurn } from '@/lib/api'
import { formatPrice } from '@/lib/constants'
import { reveal } from '@/lib/motion'

interface CarNegotiationCoachProps {
  purchaseId: string
  vehicleLabel: string
  askingPriceCents: number
  fairLowCents?: number
  fairHighCents?: number
  targetCents?: number
  walkAwayCents?: number
  currency?: string
  diligenceFlags?: string[]
}

const STORAGE_PREFIX = 'faivri.purchaseChat.v1.'

function loadHistory(purchaseId: string): PurchaseChatTurn[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${purchaseId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is PurchaseChatTurn =>
        t && typeof t === 'object' && typeof t.role === 'string' && typeof t.content === 'string',
    )
  } catch {
    return []
  }
}

function saveHistory(purchaseId: string, history: PurchaseChatTurn[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${purchaseId}`,
      JSON.stringify(history.slice(-30)),
    )
  } catch {
    // localStorage quota / disabled — silent: chat still works in-memory.
  }
}

interface PendingChip {
  label: string
  message: string
}

export default function CarNegotiationCoach({
  purchaseId,
  vehicleLabel,
  askingPriceCents,
  fairLowCents,
  fairHighCents,
  targetCents,
  walkAwayCents,
  currency = 'USD',
  diligenceFlags = [],
}: CarNegotiationCoachProps) {
  const [history, setHistory] = useState<PurchaseChatTurn[]>([])
  const [sellerMessage, setSellerMessage] = useState('')
  const [counterAmount, setCounterAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Hydrate from localStorage on mount; ignore the SSR pass.
  useEffect(() => {
    setHistory(loadHistory(purchaseId))
  }, [purchaseId])

  // Auto-scroll to the latest message whenever history grows.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [history.length, loading])

  // Suggest opening lines built from real diligence flags. Clicking a chip
  // pre-fills the textarea so the user can either send as-is or edit.
  const chips = useMemo<PendingChip[]>(() => {
    const list: PendingChip[] = []
    diligenceFlags.slice(0, 3).forEach((flag) => {
      list.push({
        label: flag,
        message: `One thing — ${flag.toLowerCase()}. Comparable listings I'm seeing factor that in. Could you do ${
          targetCents ? formatPrice(targetCents, currency) : 'closer to fair value'
        }?`,
      })
    })
    if (list.length === 0 && targetCents) {
      list.push({
        label: 'Open with target',
        message: `Hey — really interested in the ${vehicleLabel}. I've been looking at comparable listings and could do ${formatPrice(
          targetCents,
          currency,
        )} cash, ready this week. Would that work?`,
      })
    }
    return list
  }, [diligenceFlags, targetCents, vehicleLabel, currency])

  const send = async (
    payload: { seller_message?: string; user_message?: string },
    appendUser?: { content: string },
  ) => {
    setLoading(true)
    setError(null)
    try {
      // Append the user's outgoing turns optimistically so the bubble shows
      // before the coach replies — matches the chat-app feel.
      const optimistic: PurchaseChatTurn[] = [...history]
      if (payload.seller_message) {
        optimistic.push({
          role: 'seller',
          content: payload.seller_message,
          at: new Date().toISOString(),
        })
      }
      if (appendUser) {
        optimistic.push({
          role: 'user',
          content: appendUser.content,
          at: new Date().toISOString(),
        })
      }
      setHistory(optimistic)

      const res = await api.purchaseNegotiateChat({
        purchase_id: purchaseId,
        history: optimistic,
        seller_message: payload.seller_message || undefined,
        user_message: payload.user_message || undefined,
      })

      const next: PurchaseChatTurn[] = [
        ...optimistic,
        {
          role: 'assistant',
          content: res.reply,
          at: new Date().toISOString(),
          suggested_price_cents: res.suggested_price_cents,
          tone: res.tone,
        },
      ]
      setHistory(next)
      saveHistory(purchaseId, next)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Coach reply failed.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const onSendSeller = async () => {
    const text = sellerMessage.trim()
    if (!text && !counterAmount) return
    let counterUserNote: string | undefined
    if (counterAmount) {
      const dollars = Number.parseFloat(counterAmount.replace(/[^0-9.]/g, ''))
      if (!Number.isNaN(dollars) && dollars > 0) {
        counterUserNote = `They're countering at $${dollars.toLocaleString()}. What should I say back?`
      }
    }
    await send(
      {
        seller_message: text || undefined,
        user_message: counterUserNote,
      },
      counterUserNote ? { content: counterUserNote } : undefined,
    )
    setSellerMessage('')
    setCounterAmount('')
  }

  const onChipClick = async (chip: PendingChip) => {
    await send({ user_message: chip.message }, { content: chip.message })
  }

  const onClear = () => {
    setHistory([])
    saveHistory(purchaseId, [])
  }

  const onCopyReply = async (content: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedIndex(idx)
      window.setTimeout(() => setCopiedIndex(null), 1600)
    } catch {
      setCopiedIndex(null)
    }
  }

  return (
    <motion.section
      {...reveal(0.25)}
      className="ui-surface-strong perspective-stack mt-4 rounded-2xl p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
          <MessageSquare className="h-4 w-4 text-[var(--accent-bright)]" />
          Live negotiation coach
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[var(--type-12)] text-[var(--text-3)]">
          <Sparkles className="h-3 w-3" />
          Anchored on your fair range
        </span>
      </div>

      <p className="mb-3 text-[var(--type-14)] text-[var(--text-3)]">
        Paste what the seller texts you. I&apos;ll write the reply you can send — anchored on a
        target of {targetCents ? formatPrice(targetCents, currency) : '—'} and a walk-away of{' '}
        {walkAwayCents ? formatPrice(walkAwayCents, currency) : '—'}.
      </p>

      {/* Chip row — clickable suggestions when there's no chat yet */}
      {history.length === 0 && chips.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={loading}
              onClick={() => onChipClick(chip)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-accent)] bg-[var(--accent-wash)] px-3 py-1.5 text-[var(--type-12)] font-semibold text-[var(--accent-bright)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              <Handshake className="h-3 w-3" />
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Chat transcript */}
      {history.length > 0 && (
        <div
          ref={scrollRef}
          className="mb-3 max-h-[360px] space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-3"
        >
          <AnimatePresence initial={false}>
            {history.map((turn, idx) => {
              const isUser = turn.role === 'user'
              const isSeller = turn.role === 'seller'
              const isCoach = turn.role === 'assistant'
              const align = isSeller ? 'justify-start' : 'justify-end'
              const bubbleClass = isCoach
                ? 'border-[var(--border-accent)] bg-[var(--accent-wash)]'
                : isSeller
                  ? 'border-[var(--border)] bg-white'
                  : 'border-[var(--border-strong)] bg-[var(--warm-bg-tertiary)]'
              const label = isCoach ? 'Coach' : isSeller ? 'Seller' : 'You'
              const labelIcon = isCoach ? (
                <Bot className="h-3 w-3" />
              ) : isSeller ? (
                <ShieldAlert className="h-3 w-3" />
              ) : null
              return (
                <motion.div
                  key={`${idx}-${turn.role}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className={`flex ${align}`}
                >
                  <div className={`max-w-[88%] rounded-2xl border ${bubbleClass} px-3.5 py-2.5`}>
                    <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
                      {labelIcon}
                      {label}
                      {isCoach && turn.tone ? (
                        <span className="rounded-full bg-[var(--accent-bright)]/12 px-1.5 py-0 text-[9px] text-[var(--accent-bright)]">
                          {turn.tone}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[var(--type-14)] leading-relaxed text-[var(--text-2)]">
                      {turn.content}
                    </p>
                    {isCoach && turn.suggested_price_cents ? (
                      <p className="mt-1.5 text-[var(--type-12)] font-semibold text-[var(--accent-bright)]">
                        Offer: {formatPrice(turn.suggested_price_cents, currency)}
                      </p>
                    ) : null}
                    {isCoach ? (
                      <div className="mt-2 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() => onCopyReply(turn.content, idx)}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white px-2.5 py-1 text-[var(--type-12)] font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--warm-bg-secondary)]"
                          aria-label="Copy reply"
                        >
                          {copiedIndex === idx ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-500" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy reply
                            </>
                          )}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
          {loading && (
            <div className="flex justify-start">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-white px-3.5 py-2 text-[var(--type-12)] text-[var(--text-3)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Drafting your reply…
              </div>
            </div>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="rounded-xl border border-[var(--border)] bg-white p-3">
        <textarea
          value={sellerMessage}
          onChange={(e) => setSellerMessage(e.target.value)}
          rows={2}
          placeholder="Paste what the seller said…"
          disabled={loading}
          className="w-full resize-none border-none bg-transparent text-[var(--type-14)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none"
        />
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-2.5 py-1.5 text-[var(--type-13)] text-[var(--text-2)]">
              <span className="text-[var(--text-3)]">Counter $</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={counterAmount}
                onChange={(e) => setCounterAmount(e.target.value)}
                disabled={loading}
                placeholder="—"
                className="w-20 border-none bg-transparent focus:outline-none sm:w-24"
              />
            </label>
            <span className="min-w-0 truncate text-[var(--type-12)] text-[var(--text-4)]">
              asking {formatPrice(askingPriceCents, currency)}
              {fairLowCents && fairHighCents
                ? ` · fair ${formatPrice(fairLowCents, currency)}–${formatPrice(fairHighCents, currency)}`
                : null}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            {history.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                disabled={loading}
                className="text-[var(--type-12)] text-[var(--text-3)] underline-offset-2 hover:underline disabled:opacity-50"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onSendSeller}
              disabled={loading || (!sellerMessage.trim() && !counterAmount)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent-bright)] px-4 py-2 text-[var(--type-14)] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-initial"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Drafting…
                </>
              ) : (
                <>
                  Get reply
                  <Send className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-[var(--type-12)] text-[var(--red-dim)]">{error}</p>
      )}

      <p className="mt-3 inline-flex items-center gap-1 text-[var(--type-12)] text-[var(--text-4)]">
        <ArrowRight className="h-3 w-3" />
        Replies are coaching only — review before you send.
      </p>
    </motion.section>
  )
}
