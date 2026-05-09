'use client'

import { useState } from 'react'
import { useAuth } from '@/components/auth/InsForgeAuthProvider'
import { X, Mail, CheckCircle } from 'lucide-react'

interface AuthModalProps {
  mode: 'sign-in' | 'sign-up'
  onClose: () => void
  onSuccess?: () => void
}

export function AuthModal({ mode, onClose, onSuccess }: AuthModalProps) {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [verificationSent, setVerificationSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'sign-up') {
        const result = await signUp(email, password, name || undefined)
        if (result.error) {
          setError(result.error)
        } else if (result.needsVerification) {
          setVerificationSent(true)
        } else {
          onSuccess?.()
          onClose()
        }
      } else {
        const result = await signIn(email, password)
        if (result.error) {
          setError(result.error)
        } else {
          onSuccess?.()
          onClose()
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  if (verificationSent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex flex-col items-center text-center py-4">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <h2 className="font-display text-xl font-bold text-[var(--text-1)] mb-2">Check your email</h2>
            <p className="text-sm text-[var(--text-3)]">
              We sent a verification link to <strong>{email}</strong>. Click it to activate your account, then sign in.
            </p>
            <button
              onClick={onClose}
              className="mt-5 rounded-xl bg-black px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#333] transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-xl font-bold text-[var(--text-1)]">
            {mode === 'sign-up' ? 'Create account' : 'Welcome back'}
          </h2>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-[var(--warm-bg-secondary)] transition-colors">
            <X className="h-5 w-5 text-[var(--text-3)]" />
          </button>
        </div>

        <button
          onClick={async () => {
            const result = await signInWithGoogle()
            if (result.error) setError(result.error)
          }}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-1)] hover:bg-[var(--warm-bg)] transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-4)] uppercase tracking-wider">or</span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'sign-up' && (
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-accent)]"
            />
          )}
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-accent)]"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-accent)]"
          />
          {error && <p className="text-sm text-[var(--red-text)]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#333] transition-colors disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
