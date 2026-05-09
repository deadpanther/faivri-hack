'use client'

/**
 * AuthTokenBridge — now backed by InsForge instead of Clerk.
 * The InsForgeAuthProvider handles the token bridge internally
 * via its own useEffect. This component is kept as a no-op
 * placeholder for backwards compatibility with the layout tree.
 */
export function AuthTokenBridge(): null {
  return null
}
