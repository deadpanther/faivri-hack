'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { insforge, type Session, type User } from '@/lib/insforge'
import { setAuthTokenGetter } from '@/lib/api'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function InsForgeAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    insforge.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })

    // Listen for auth state changes
    const { data: { subscription } } = insforge.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
      setUser(sess?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Bridge auth tokens to the API client
  useEffect(() => {
    if (!session) {
      setAuthTokenGetter(null)
      return
    }
    setAuthTokenGetter(async () => session.access_token ?? null)
    return () => setAuthTokenGetter(null)
  }, [session])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await insforge.auth.signUp({ email, password })
    if (error) throw error
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await insforge.auth.signInWithOAuth({ provider: 'google' })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
  }, [])

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
