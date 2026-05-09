'use client'

import { useAuth } from '@/components/auth/InsForgeAuthProvider'

/**
 * Shows a toast when the user's session has been revoked.
 * Simplified for InsForge — InsForge handles session management internally.
 */
export function SessionRevokedToast(): null {
  const { session } = useAuth()
  // InsForge's onAuthStateChange handles session revocation
  // If session becomes null while user was signed in, that's a revocation
  return null
}
