/**
 * InsForge SDK client — singleton configured from env vars.
 *
 * Usage:
 *   import { insforge } from '@/lib/insforge'
 *   await insforge.auth.signInWithPassword({ email, password })
 *   const token = insforge.getAccessToken()
 */

import { createClient, type InsForgeClient } from '@insforge/sdk'

export type { InsForgeClient }
export { createClient }

export const insforge: InsForgeClient = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://insforge.dev',
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '',
})
