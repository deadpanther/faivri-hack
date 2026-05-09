import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Proxy (formerly middleware) — passes all requests through.
 * Clerk middleware was removed; InsForge auth is client-side only.
 */
export default function proxy(request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
