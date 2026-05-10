'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  Clipboard, Search, Wrench, Store, Shield, Calendar, BarChart3,
  DollarSign, Clock, Scale, Pill, AlertTriangle, Sparkles, ChevronDown,
  Lightbulb, ArrowRight, RotateCw,
} from 'lucide-react'
import { api, RecommendationsData, RecommendationItem } from '@/lib/api'

const ICON_MAP: Record<string, LucideIcon> = {
  clipboard: Clipboard,
  search: Search,
  tool: Wrench,
  store: Store,
  shield: Shield,
  calendar: Calendar,
  chart: BarChart3,
  dollar: DollarSign,
  clock: Clock,
  scale: Scale,
  pill: Pill,
  alert: AlertTriangle,
}

const CATEGORY_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  immediate: {
    label: 'Do Now',
    color: 'text-[var(--red)]',
    bg: 'bg-[rgba(248,113,113,0.06)]',
  },
  alternative: {
    label: 'Try Instead',
    color: 'text-[var(--blue)]',
    bg: 'bg-[rgba(35,131,226,0.06)]',
  },
  preventive: {
    label: 'Prevent Next Time',
    color: 'text-[var(--green)]',
    bg: 'bg-[rgba(52,211,153,0.06)]',
  },
  community: {
    label: 'Help Others',
    color: 'text-[var(--amber)]',
    bg: 'bg-[rgba(251,191,36,0.06)]',
  },
}

function RecommendationCard({ item, index }: { item: RecommendationItem; index: number }) {
  const IconComponent = ICON_MAP[item.icon] || Lightbulb
  const catStyle = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.immediate

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="ui-surface perspective-stack group flex items-start gap-3 rounded-xl p-3.5 transition-all"
    >
      <div className={`w-8 h-8 rounded-lg ${catStyle.bg} flex items-center justify-center shrink-0`}>
        <IconComponent className={`w-4 h-4 ${catStyle.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h5 className="text-sm font-semibold text-[var(--text-1)] truncate">{item.title}</h5>
          <span className={`text-[9px] font-semibold tracking-[0.5px] uppercase px-1.5 py-0.5 rounded ${catStyle.bg} ${catStyle.color}`}>
            {catStyle.label}
          </span>
        </div>
        <p className="text-xs text-[var(--text-3)] leading-relaxed">{item.description}</p>
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-[var(--text-4)] group-hover:text-[var(--blue)] shrink-0 mt-1 transition-colors" />
    </motion.div>
  )
}

export default function Recommendations({ queryId }: { queryId: string }) {
  const [data, setData] = useState<RecommendationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [showGeneral, setShowGeneral] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getRecommendations(queryId)
      .then((res) => {
        if (cancelled) return
        setError(null)
        setData(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Recommendations are auxiliary — we won't toast, but we WILL show an
        // inline retry chip so the user knows something went wrong.
        const msg = err instanceof Error ? err.message : 'Could not load recommendations.'
        setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [queryId, attempt])

  if (loading) {
    return (
      <div className="ui-surface rounded-3xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-4 w-4 animate-pulse rounded bg-[var(--color-neutral-200)]" />
          <div className="h-4 w-32 animate-pulse rounded bg-[var(--color-neutral-200)]" />
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className="mb-2 h-16 animate-pulse rounded-xl bg-[var(--color-neutral-100)]" />
        ))}
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="ui-surface rounded-3xl p-4 text-center">
        <p className="text-[var(--type-14)] text-[var(--text-3)]">Couldn&apos;t load tips.</p>
        <button
          onClick={() => {
            setLoading(true)
            setError(null)
            setAttempt((n) => n + 1)
          }}
          className="mt-2 inline-flex items-center gap-1.5 text-[var(--type-14)] font-semibold text-[var(--blue)] hover:underline"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </button>
      </div>
    )
  }

  if (!data || (data.personalized.length === 0 && data.general.length === 0)) {
    return null
  }

  return (
    <div className="ui-surface perspective-stack rounded-3xl p-5">
      {/* Personalized (LLM) recommendations */}
      {data.personalized.length > 0 && (
        <>
          <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--blue)] mb-3">
            <Sparkles className="w-4 h-4" /> Recommended for You
          </h4>
          <div className="space-y-2 mb-4">
            {data.personalized.map((item, i) => (
              <RecommendationCard key={`p-${i}`} item={item} index={i} />
            ))}
          </div>
        </>
      )}

      {/* General domain recommendations — collapsible */}
      {data.general.length > 0 && (
        <div>
          <button
            onClick={() => setShowGeneral(!showGeneral)}
            className="flex items-center justify-between w-full text-sm font-bold text-[var(--text-2)] hover:text-[var(--text-1)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-[var(--amber)]" />
              General Tips ({data.general.length})
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showGeneral ? 'rotate-180' : ''}`} />
          </button>
          {showGeneral && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2 mt-3"
            >
              {data.general.map((item, i) => (
                <RecommendationCard key={`g-${i}`} item={item} index={i} />
              ))}
            </motion.div>
          )}
        </div>
      )}
    </div>
  )
}
