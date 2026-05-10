'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, Loader2 } from 'lucide-react'

import { api } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'

type Status = 'idle' | 'loading' | 'success' | 'error'

export function WaitlistForm({ source = 'landing' }: { source?: string }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')
  const { toast } = useToast()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'loading' || status === 'success') return

    const trimmed = email.trim()
    if (!trimmed) {
      setStatus('error')
      setMessage('Enter an email to join.')
      return
    }

    setStatus('loading')
    setMessage('')
    try {
      const res = await api.joinWaitlist({ email: trimmed, source })
      setStatus('success')
      setMessage(res.message)
      toast(res.message, 'success')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Something went wrong.'
      setStatus('error')
      setMessage(detail)
      toast(detail, 'error')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--warm-bg-secondary)] px-4 py-3 text-[var(--type-14)] text-[var(--text-2)]">
        <Check className="h-4 w-4 text-[var(--green)]" />
        <span>{message || "You're on the waitlist."}</span>
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch"
    >
      <label htmlFor="waitlist-email" className="sr-only">
        Email address
      </label>
      <input
        id="waitlist-email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@email.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (status !== 'idle') setStatus('idle')
        }}
        className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--warm-bg)] px-4 py-3 text-[var(--type-14)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:border-[var(--text-1)] focus:outline-none"
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--text-1)] px-5 py-3 text-[var(--type-14)] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
      >
        {status === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Join waitlist
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      {status === 'error' && message ? (
        <p className="sr-only" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}
