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
  signUp: (email: string, password: string, name?: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signIn: async () => ({ error: 'Not initialized' }),
  signUp: async () => ({ error: 'Not initialized' }),
  signOut: async () => {},
})

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
          setUser({
            id: data.user.id,
            email: data.user.email ?? '',
            name: (data.user as any).name ?? undefined,
          })
          // Sync access token for API calls
          const token = insforge.getHttpClient().getHeaders()['Authorization']?.replace('Bearer ', '') ?? null
          if (token) {
            insforge.setAccessToken(token)
          }
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
      if (error) return { error: error.message }
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email ?? email,
          name: (data.user as any).name ?? undefined,
        })
        // Sync token for backend API calls
        const token = insforge.getHttpClient().getHeaders()['Authorization']?.replace('Bearer ', '') ?? null
        if (token) {
          insforge.setAccessToken(token)
        }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err?.message ?? 'Sign in failed' }
    }
  }, [])

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    try {
      const { data, error } = await insforge.auth.signUp({ email, password, name } as any)
      if (error) return { error: error.message }
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email ?? email,
          name: name ?? (data.user as any).name ?? undefined,
        })
        const token = insforge.getHttpClient().getHeaders()['Authorization']?.replace('Bearer ', '') ?? null
        if (token) {
          insforge.setAccessToken(token)
        }
      }
      return { error: null }
    } catch (err: any) {
      return { error: err?.message ?? 'Sign up failed' }
    }
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    setUser(null)
    insforge.setAccessToken(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut }),
    [user, loading, signIn, signUp, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
