/**
 * InsForge client — auth, database, storage for the hackathon.
 * Replaces Clerk as the auth + backend provider.
 *
 * Env vars (set in .env.local and on Vercel):
 *   NEXT_PUBLIC_INSFORGE_URL      — InsForge project URL
 *   NEXT_PUBLIC_INSFORGE_ANON_KEY  — InsForge anon/public key
 */
import { createClient, type Session, type User } from '@insforge/sdk'

export const insforge = createClient({
  baseUrl: process.env.NEXT_PUBLIC_INSFORGE_URL ?? 'https://insforge.dev',
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ?? '',
})

export type { Session, User }
