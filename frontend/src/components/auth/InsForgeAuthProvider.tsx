'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { insforge } from '@/lib/insforge'

interface User {
  id: string
  email: string
  name?: string
}

interface AuthContextValue {
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (email: string, password: string, name?: string) => Promise<{ error: string | null; needsVerification?: boolean }>
  signOut: () => Promise<void>
  signInWithGoogle: () => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: async () => ({ error: 'Not initialized' }),
  signUp: async () => ({ error: 'Not initialized' }),
  signOut: async () => {},
  signInWithGoogle: async () => ({ error: 'Not initialized' }),
})

function extractUser(raw: any): User | null {
  if (!raw) return null
  return {
    id: raw.id ?? '',
    email: raw.email ?? '',
    name: raw.profile?.name ?? raw.name ?? undefined,
  }
}

export function InsForgeAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore session on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await insforge.auth.getCurrentUser()
        if (!cancelled && !error && data?.user) {
          setUser(extractUser(data.user))
        }
      } catch {
        // Not signed in — that's fine
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await insforge.auth.signInWithPassword({ email, password })
      if (error) return { error: error.nextActions ?? error.message ?? 'Sign in failed' }
      if (data?.user) {
        setUser(extractUser(data.user))
      } else if (data?.accessToken) {
        // signInWithPassword may not return user — fetch it
        const { data: userData } = await insforge.auth.getCurrentUser()
        if (userData?.user) setUser(extractUser(userData.user))
      }
      return { error: null }
    } catch (err: any) {
      return { error: err?.message ?? 'Sign in failed' }
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    try {
      const { data, error } = await insforge.auth.signUp({ email, password, name } as any)
      if (error) return { error: error.nextActions ?? error.message ?? 'Sign up failed', needsVerification: false }
      if (data?.requireEmailVerification) {
        return { error: null, needsVerification: true }
      }
      if (data?.user) {
        setUser(extractUser(data.user))
      }
      return { error: null, needsVerification: false }
    } catch (err: any) {
      return { error: err?.message ?? 'Sign up failed', needsVerification: false }
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    try {
      const { error } = await insforge.auth.signInWithOAuth({
        provider: 'google',
        redirectTo: typeof window !== 'undefined' ? window.location.origin : '',
      })
      if (error) return { error: error.message ?? 'Google sign in failed' }
      return { error: null }
    } catch (err: any) {
      return { error: err?.message ?? 'Google sign in failed' }
    }
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, signInWithGoogle }),
    [user, loading, signIn, signUp, signOut, signInWithGoogle],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
