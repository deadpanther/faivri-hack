'use client'

import { useAuth } from '@/components/auth/InsForgeAuthProvider'

export default function SignInPage() {
  const { signIn } = useAuth()

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-white p-6">
        <h1 className="font-display text-2xl font-bold text-[var(--text-1)] mb-6">Sign In</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            const fd = new FormData(e.currentTarget)
            await signIn(fd.get('email') as string, fd.get('password') as string)
            window.location.href = '/'
          }}
          className="space-y-4"
        >
          <input
            name="email"
            type="email"
            placeholder="Email"
            required
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm outline-none"
          />
          <input
            name="password"
            type="password"
            placeholder="Password"
            required
            className="w-full rounded-xl border border-[var(--border-strong)] bg-[var(--warm-bg-secondary)] px-4 py-2.5 text-sm outline-none"
          />
          <button type="submit" className="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#333]">
            Sign In
          </button>
        </form>
      </div>
    </div>
  )
}
