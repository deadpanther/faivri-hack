'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Home,
  Info,
  Layers,
  MessageSquare,
  Scale,
  Send,
  Shield,
  Stethoscope,
  Target,
  Users,
  Wrench,
} from 'lucide-react'
import { api, CounterOfferData, NegotiateData } from '@/lib/api'
import { formatPrice } from '@/lib/constants'
import { reveal, stagger, scrollReveal } from '@/lib/motion'
import { useToast } from '@/components/ui/Toast'
import { SkeletonChatPage } from '@/components/ui/Skeleton'

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  auto: Wrench,
  medical: Stethoscope,
  home: Home,
  legal: Scale,
}

const TACTIC_ICONS: Record<string, LucideIcon> = {
  'Anchor Low': Layers,
  'Ask for Proof': FileText,
  'Remove Urgency': MessageSquare,
  'Mention Alternatives': Users,
}

const ROLE_STYLES: Record<string, { label: string; className: string; labelColor: string }> = {
  you: { label: 'YOU', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--blue)]' },
  you_opening: { label: 'YOU · OPENER', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--blue)]' },
  you_counter: { label: 'YOU · COUNTER', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--blue)]' },
  you_evidence: { label: 'YOU · DATA', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--blue)]' },
  you_final: { label: 'YOU · FINAL', className: 'ml-auto card-green', labelColor: 'text-[var(--green-text)]' },
  you_final_offer: { label: 'YOU · FINAL', className: 'ml-auto card-green', labelColor: 'text-[var(--green-text)]' },
  you_walkaway: { label: 'WALK AWAY', className: 'ml-auto card-danger', labelColor: 'text-[var(--red-text)]' },
  you_followup: { label: 'FOLLOW UP', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--amber-text)]' },
  them_pushback: { label: 'THEM', className: 'mr-auto bg-[var(--warm-bg-secondary)] border border-[var(--border)]', labelColor: 'text-[var(--text-4)]' },
  them_partial: { label: 'THEM · OFFER', className: 'mr-auto bg-[var(--warm-bg-secondary)] border border-[var(--border)]', labelColor: 'text-[var(--text-4)]' },
  them_accepts_or_stalls: { label: 'THEM', className: 'mr-auto bg-[var(--warm-bg-secondary)] border border-[var(--border)]', labelColor: 'text-[var(--text-4)]' },
  expert: { label: 'THEM', className: 'mr-auto bg-[var(--warm-bg-secondary)] border border-[var(--border)]', labelColor: 'text-[var(--text-4)]' },
  expert_discount: { label: 'THEM · COUNTER', className: 'mr-auto bg-[var(--warm-bg-secondary)] border border-[var(--border)]', labelColor: 'text-[var(--text-4)]' },
  response: { label: 'YOU', className: 'ml-auto border border-[var(--border-strong)] bg-[var(--warm-bg)]', labelColor: 'text-[var(--blue)]' },
  walkaway: { label: 'WALK AWAY', className: 'ml-auto card-danger', labelColor: 'text-[var(--red-text)]' },
}

export default function NegotiatePage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<NegotiateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [practiceMode, setPracticeMode] = useState(false)
  const [visibleSteps, setVisibleSteps] = useState(999)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const [evidenceCopied, setEvidenceCopied] = useState(false)

  const [counterInput, setCounterInput] = useState('')
  const [counterLoading, setCounterLoading] = useState(false)
  const [counterResult, setCounterResult] = useState<CounterOfferData | null>(null)

  useEffect(() => {
    if (!params.id) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    api
      .negotiate(params.id as string)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : 'Could not generate negotiation script.'
        setLoadError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [params.id, loadAttempt])

  async function handleCounterOffer() {
    if (!counterInput || !data || !params.id) return
    const amountCents = Math.round(parseFloat(counterInput) * 100)
    if (Number.isNaN(amountCents) || amountCents <= 0) return

    setCounterLoading(true)
    try {
      const result = await api.counterOffer({
        query_id: params.id as string,
        counter_offer: amountCents,
        original_target: data.target_price,
      })
      setCounterResult(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not evaluate that counter-offer.'
      toast(msg, 'error')
    } finally {
      setCounterLoading(false)
    }
  }

  function copyEvidence() {
    if (!data?.evidence_summary) return
    navigator.clipboard.writeText(data.evidence_summary)
    setEvidenceCopied(true)
    setTimeout(() => setEvidenceCopied(false), 2000)
  }

  if (loading) {
    return <SkeletonChatPage />
  }

  if (!data) {
    return (
      <div className="ui-section">
        <div className="ui-container text-center text-[var(--text-3)]">
          <p>{loadError || 'Could not generate negotiation script.'}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            {loadError && (
              <button
                onClick={() => setLoadAttempt((n) => n + 1)}
                className="ui-button-secondary"
              >
                Try again
              </button>
            )}
            <button
              onClick={() => router.push(`/result/${params.id}`)}
              className="ui-button-secondary"
            >
              Back to verdict
            </button>
          </div>
        </div>
      </div>
    )
  }

  const estimatedSavings = data.quoted_price
    ? data.quoted_price - data.target_price
    : data.walk_away_above - data.target_price

  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-5xl mx-auto">
        <button onClick={() => router.push(`/result/${params.id}`)} className="btn-ghost mb-4 inline-flex items-center gap-1.5">
          <ArrowLeft className="h-4 w-4" />
          Back to verdict
        </button>

        {/* Page header with targets */}
        <motion.div {...reveal(0)} className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[clamp(1.5rem,4vw,2rem)] font-bold text-[var(--text-1)]">
              Negotiation playbook
            </h1>
            <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
              Word-for-word scripts backed by market data
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2 text-center">
              <p className="text-[var(--type-12)] text-[var(--text-4)]">Target</p>
              <p className="font-mono text-[var(--type-16)] font-bold text-[var(--green-text)]">
                {formatPrice(data.target_price, data.currency)}
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-3 py-2 text-center">
              <p className="text-[var(--type-12)] text-[var(--text-4)]">Walk away</p>
              <p className="font-mono text-[var(--type-16)] font-bold text-[var(--red-text)]">
                {formatPrice(data.walk_away_above, data.currency)}
              </p>
            </div>
          </div>
        </motion.div>

        <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
          <main className="space-y-4">
            <motion.section {...reveal(0.06)} className="rounded-2xl border border-[var(--border-strong)] bg-[var(--warm-bg)] p-5 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[var(--blue)]" />
                  <span className="text-[var(--type-14)] font-semibold text-[var(--text-1)]">Script</span>
                  <span className="ui-chip !text-[10px]">{(data.domain || 'auto').toUpperCase()}</span>
                </div>
                <button
                  onClick={() => {
                    setPracticeMode((prev) => !prev)
                    setVisibleSteps(practiceMode ? 999 : 1)
                  }}
                  className={practiceMode ? 'ui-button-primary' : 'ui-button-secondary'}
                >
                  {practiceMode ? 'Exit practice' : 'Practice mode'}
                </button>
              </div>

              <div className="space-y-2">
                {data.scripts.slice(0, practiceMode ? visibleSteps : undefined).map((script, index) => {
                  const style = ROLE_STYLES[script.role] || ROLE_STYLES.you
                  return (
                    <motion.article
                      key={`${script.role}-${index}`}
                      {...stagger(index * 0.05)}
                      className={`${style.className} perspective-stack group relative max-w-[88%] rounded-2xl px-4 py-3`}
                    >
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(script.text)
                          setCopiedIndex(index)
                          setTimeout(() => setCopiedIndex(null), 1800)
                        }}
                        className="absolute right-2 top-2 rounded-md border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-1 text-[var(--text-3)] opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Copy script line"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-3 w-3 text-[var(--green-text)]" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                      <p className={`font-mono text-[10px] font-bold tracking-[0.1em] ${style.labelColor}`}>{style.label}</p>
                      <p className="mt-1 text-[var(--type-14)] text-[var(--text-2)]">{script.text}</p>
                    </motion.article>
                  )
                })}
              </div>

              {practiceMode && visibleSteps < data.scripts.length && (
                <button onClick={() => setVisibleSteps((prev) => prev + 1)} className="ui-button-primary mt-3 inline-flex items-center gap-2">
                  Show next line
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </motion.section>

            <motion.section {...reveal(0.08)} className="glass perspective-stack rounded-2xl p-5">
              <h2 className="inline-flex items-center gap-2 text-[var(--type-18)] font-semibold text-[var(--text-1)]">
                <Target className="h-4 w-4 text-[var(--blue)]" />
                Counter-offer assistant
              </h2>
              <p className="mt-1 text-[var(--type-14)] text-[var(--text-3)]">
                Enter their counter amount and get your next response instantly.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  type="number"
                  value={counterInput}
                  onChange={(event) => {
                    setCounterInput(event.target.value)
                    setCounterResult(null)
                  }}
                  placeholder="Their offer amount"
                  className="min-w-[220px] flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-3 py-2.5 text-[var(--type-14)] outline-none focus:border-[var(--border-accent)]"
                />
                <button onClick={handleCounterOffer} disabled={counterLoading || !counterInput} className="ui-button-primary inline-flex items-center gap-2">
                  {counterLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Analyze
                </button>
              </div>

              <AnimatePresence>
                {counterResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className={`mt-3 rounded-xl px-4 py-3 ${counterResult.should_accept ? 'card-green' : 'card-danger'}`}
                  >
                    <p className="text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                      {counterResult.should_accept ? 'Acceptable counter' : 'Still too high'}
                    </p>
                    <p className="mt-1 text-[var(--type-14)] text-[var(--text-2)]">{counterResult.reasoning}</p>
                    <div className="glass mt-2 rounded-xl p-3">
                      <p className="font-mono text-[10px] tracking-[0.1em] text-[var(--text-4)]">RESPONSE SCRIPT</p>
                      <p className="mt-1 text-[var(--type-14)] text-[var(--text-2)]">{counterResult.response_script}</p>
                    </div>
                    {!counterResult.should_accept && counterResult.suggested_counter > 0 ? (
                      <p className="mt-2 text-[var(--type-12)] text-[var(--text-3)]">
                        Suggested counter: {formatPrice(counterResult.suggested_counter)}
                      </p>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          </main>

          <aside className="space-y-4">
            <motion.section {...reveal(0.12)} className="card-green perspective-stack rounded-2xl p-4 text-center">
              <p className="ui-caption">Target price</p>
              <p className="mt-2 font-display text-[var(--type-32)] text-gradient-green">{formatPrice(data.target_price, data.currency)}</p>
              <p className="text-[var(--type-12)] text-[var(--text-3)]">
                Walk away above {formatPrice(data.walk_away_above, data.currency)}
              </p>
              {estimatedSavings > 0 ? (
                <p className="mt-2 font-mono text-[var(--type-14)] text-[var(--green-text)]">
                  Potential savings {formatPrice(estimatedSavings, data.currency)}
                </p>
              ) : null}
            </motion.section>

            <motion.section {...scrollReveal(0)} className="glass perspective-stack rounded-2xl p-4">
              <h3 className="inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                <Shield className="h-4 w-4 text-[var(--blue)]" />
                Tactics in play
              </h3>
              <div className="mt-2 space-y-2">
                {data.tactics.map((tactic, index) => {
                  const Icon = TACTIC_ICONS[tactic.name] || Info
                  return (
                    <motion.div key={`${tactic.name}-${index}`} {...stagger(index * 0.03)} className="glass rounded-xl px-3 py-2">
                      <p className="inline-flex items-center gap-2 text-[var(--type-14)] font-semibold text-[var(--text-1)]">
                        <Icon className="h-3.5 w-3.5 text-[var(--blue)]" />
                        {tactic.name}
                      </p>
                      <p className="mt-1 text-[var(--type-12)] text-[var(--text-3)]">{tactic.description}</p>
                    </motion.div>
                  )
                })}
              </div>
            </motion.section>

            {data.evidence_summary ? (
              <motion.section {...scrollReveal(0.08)} className="glass perspective-stack rounded-2xl p-4">
                <h3 className="inline-flex items-center gap-2 text-[var(--type-16)] font-semibold text-[var(--text-1)]">
                  <FileText className="h-4 w-4 text-[var(--amber-text)]" />
                  Evidence summary
                </h3>
                <p className="mt-2 text-[var(--type-14)] text-[var(--text-2)]">{data.evidence_summary}</p>
                <button onClick={copyEvidence} className="ui-button-secondary mt-3 inline-flex w-full items-center justify-center gap-2">
                  {evidenceCopied ? (
                    <>
                      <Check className="h-4 w-4 text-[var(--green-text)]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy evidence
                    </>
                  )}
                </button>
              </motion.section>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  )
}
