/**
 * InsForge SDK client — thin wrapper around @insforge/sdk.
 *
 * Exports a singleton `insforge` client configured from env vars.
 * Also re-exports `InsForgeClient` and `createClient` for direct use.
 */

import { createClient, type InsForgeClient } from '@insforge/sdk'

export type { InsForgeClient }
export { createClient }

export const insforge: InsForgeClient = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://insforge.dev',
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '',
})
