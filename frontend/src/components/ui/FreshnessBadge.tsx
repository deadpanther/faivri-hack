'use client'

interface FreshnessBadgeProps {
  freshness?: {
    source: string
    live_search: boolean
    fetched_at?: string
    web_results_count?: number
  }
}

export function FreshnessBadge({ freshness }: FreshnessBadgeProps) {
  if (!freshness) return null

  if (freshness.live_search) {
    return (
      <span className="freshness-badge freshness-live">
        Live data ({freshness.web_results_count || 0} sources)
      </span>
    )
  }

  if (freshness.source === 'cached_baseline') {
    const cachedAt = freshness.fetched_at
      ? new Date(freshness.fetched_at).toLocaleString()
      : 'recently'
    return (
      <span className="freshness-badge freshness-cached">
        Cached {cachedAt}
      </span>
    )
  }

  return (
    <span className="freshness-badge freshness-limited">
      Limited evidence
    </span>
  )
}
