'use client'

export function SkeletonText({ width = '100%' }: { width?: string }) {
  return <div className="skeleton skeleton-text" style={{ width }} />
}

export function SkeletonTitle({ width = '60%' }: { width?: string }) {
  return <div className="skeleton skeleton-title" style={{ width }} />
}

export function SkeletonBlock({ height = '80px' }: { height?: string }) {
  return <div className="skeleton skeleton-block" style={{ height }} />
}

export function SkeletonCard() {
  return (
    <div className="card-evidence p-5 space-y-3">
      <SkeletonTitle />
      <SkeletonText width="90%" />
      <SkeletonText width="75%" />
      <SkeletonBlock height="48px" />
    </div>
  )
}

export function SkeletonListPage({ rows = 6 }: { rows?: number }) {
  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-4xl mx-auto space-y-6">
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--warm-bg)] p-6 space-y-3">
          <SkeletonTitle width="40%" />
          <SkeletonText width="70%" />
          <SkeletonBlock height="48px" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-text" style={{ width: '80px', height: '26px', borderRadius: '999px' }} />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </section>
  )
}

export function SkeletonChatPage() {
  return (
    <section className="ui-section pb-20 md:pb-12">
      <div className="ui-container max-w-3xl mx-auto space-y-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-5 space-y-3">
          <SkeletonText width="30%" />
          <SkeletonTitle width="60%" />
          <SkeletonText width="85%" />
        </div>
        <div className="space-y-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] p-4 space-y-2 ml-auto max-w-[80%]">
            <SkeletonText width="60%" />
            <SkeletonText width="40%" />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--warm-bg)] p-4 space-y-2 max-w-[85%]">
            <SkeletonText width="80%" />
            <SkeletonText width="70%" />
            <SkeletonText width="50%" />
          </div>
        </div>
        <SkeletonBlock height="56px" />
      </div>
    </section>
  )
}

export function SkeletonVerdictPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-6">
      <div className="skeleton skeleton-text w-20 mb-6" style={{ height: '16px' }} />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        <div className="card-accent rounded-3xl p-8 space-y-6">
          <div className="flex justify-between">
            <SkeletonText width="200px" />
            <SkeletonText width="60px" />
          </div>
          <div className="card-evidence rounded-3xl p-12 flex flex-col items-center gap-3">
            <div className="skeleton" style={{ width: '180px', height: '80px', borderRadius: '16px' }} />
            <SkeletonText width="120px" />
            <SkeletonText width="250px" />
          </div>
          <SkeletonBlock height="100px" />
          <SkeletonBlock height="60px" />
        </div>
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  )
}
