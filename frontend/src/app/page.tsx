'use client'

import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import AnalyzerStudio from '@/components/home/AnalyzerStudio'
import PreLoginLanding from '@/components/home/PreLoginLanding'

export default function HomePage() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text-1)]" />
      </div>
    )
  }

  if (!user) {
    return <PreLoginLanding />
  }

  return <AnalyzerStudio />
}
