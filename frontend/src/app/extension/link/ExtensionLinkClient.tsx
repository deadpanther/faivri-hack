'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { SignInButton, useUser } from '@clerk/nextjs'

import { ApiError, api } from '@/lib/api'

type Phase = 'idle' | 'pairing' | 'paired' | 'error'

const CODE_PATTERN = /^[A-Za-z0-9_-]{8,64}$/

export default function ExtensionLinkClient() {
  const params = useSearchParams()
  const router = useRouter()
  const code = params.get('code') || ''
  const { isLoaded, isSignedIn, user } = useUser()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const codeIsValid = useMemo(() => CODE_PATTERN.test(code), [code])

  async function confirmPair() {
    setPhase('pairing')
    setError(null)
    try {
      await api.pairExtensionDevice(code, 'Chrome extension')
      setPhase('paired')
    } catch (err) {
      const friendly =
        err instanceof ApiError
          ? err.message
          : 'Could not pair the extension. Try again.'
      setError(friendly)
      setPhase('error')
    }
  }

  if (!codeIsValid) {
    return (
      <Card>
        <Heading>Invalid pairing link</Heading>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6B6B6B]">
          This page only works when opened from the Faivri Chrome extension. Click
          the extension icon, then &quot;Sign in with Faivri&quot; — that opens a fresh
          link with a pairing code.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1A1814]"
          >
            Back to Faivri
          </Link>
        </div>
      </Card>
    )
  }

  if (!isLoaded) {
    return <div className="text-sm text-[#6B6B6B]">Loading…</div>
  }

  if (!isSignedIn) {
    return (
      <Card>
        <Heading>Sign in to pair the extension</Heading>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6B6B6B]">
          We just need to know which Faivri account this extension should belong
          to. Sign in once and the extension stays paired until you sign out.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <SignInButton
            mode="modal"
            forceRedirectUrl={`/extension/link?code=${encodeURIComponent(code)}`}
            signUpForceRedirectUrl={`/extension/link?code=${encodeURIComponent(code)}`}
          >
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1A1814]"
            >
              Sign in / Create account
            </button>
          </SignInButton>
        </div>
        <p className="mt-4 text-[11px] text-[#9B9A97]">
          Pairing code: <code className="rounded bg-[#F1F1EF] px-1.5 py-0.5 font-mono">{code}</code>
        </p>
      </Card>
    )
  }

  if (phase === 'paired') {
    return (
      <Card>
        <Heading>Extension paired</Heading>
        <p className="mt-2 text-[14px] leading-relaxed text-[#6B6B6B]">
          You&apos;re signed in as{' '}
          <strong>{user?.primaryEmailAddress?.emailAddress || 'your Faivri account'}</strong>.
          Head back to the Faivri popup — your recent analyses will sync there
          and any listing you check on eBay or Marketplace will save to your
          vault.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link
            href="/vault"
            className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1A1814]"
          >
            Open my vault
          </Link>
          <button
            type="button"
            onClick={() => window.close()}
            className="inline-flex items-center rounded-full border border-[rgba(55,53,47,0.12)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#37352F] transition-colors hover:bg-[#F7F6F3]"
          >
            Close this tab
          </button>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <Heading>Pair the Faivri extension?</Heading>
      <p className="mt-2 text-[14px] leading-relaxed text-[#6B6B6B]">
        The Chrome extension on this browser is asking to act as{' '}
        <strong>{user?.primaryEmailAddress?.emailAddress || 'your account'}</strong>.
        After pairing, every price check you run on eBay or Facebook
        Marketplace saves to your Faivri vault.
      </p>
      <p className="mt-3 text-[12px] text-[#9B9A97]">
        Pairing code:{' '}
        <code className="rounded bg-[#F1F1EF] px-1.5 py-0.5 font-mono">{code}</code>
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={confirmPair}
          disabled={phase === 'pairing'}
          className="inline-flex items-center rounded-full bg-black px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#1A1814] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === 'pairing' ? 'Pairing…' : 'Pair extension'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="inline-flex items-center rounded-full border border-[rgba(55,53,47,0.12)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[#37352F] transition-colors hover:bg-[#F7F6F3]"
        >
          Cancel
        </button>
      </div>
      {phase === 'error' && error ? (
        <p className="mt-4 rounded-md bg-[#FEE2E2] px-3 py-2 text-[12px] text-[#991B1B]">
          {error}
        </p>
      ) : null}
    </Card>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full rounded-2xl border border-[rgba(55,53,47,0.09)] bg-white p-7 text-center shadow-[0_18px_44px_rgba(15,15,15,0.06)]">
      {children}
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="text-[22px] font-semibold tracking-tight text-[#1A1814]">
      {children}
    </h1>
  )
}
