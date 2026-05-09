/**
 * InsForge SDK client — singleton configured from env vars.
 *
 * Usage:
 *   import { insforge } from '@/lib/insforge'
 *   await insforge.auth.signInWithPassword({ email, password })
 *   const headers = insforge.getHttpClient().getHeaders()
 *   // headers.Authorization = "Bearer <token>"
 *
 * NOTE: InsForgeClient does NOT have a public getAccessToken() method.
 * Use insforge.getHttpClient().getHeaders() to get the Authorization header,
 * or insforge.setAccessToken(token) to set it externally.
 */

import { createClient, type InsForgeClient } from '@insforge/sdk'

export type { InsForgeClient }
export { createClient }

export const insforge: InsForgeClient = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://insforge.dev',
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '',
})
