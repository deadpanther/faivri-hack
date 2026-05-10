'use client'

import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { AuthModal } from '@/components/auth/AuthModal'
import { useState } from 'react'

export default function ExtensionLinkClient() {
  const { user } = useAuth()
  const [showAuth, setShowAuth] = useState<'sign-in' | 'sign-up' | null>(null)

  if (!user) {
    return (
      <div>
        {showAuth && <AuthModal mode={showAuth} onClose={() => setShowAuth(null)} />}
        <p className="text-[var(--type-14)] text-[var(--text-3)]">
          Sign in to link your extension.
        </p>
        <button
          onClick={() => setShowAuth('sign-in')}
          className="mt-3 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-[#333] transition-colors"
        >
          Sign In
        </button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[var(--type-14)] text-[var(--text-2)]">
        Signed in as <span className="font-semibold">{user.email}</span>
      </p>
      <p className="mt-2 text-[var(--type-13)] text-[var(--text-3)]">
        Extension linked successfully.
      </p>
    </div>
  )
}
