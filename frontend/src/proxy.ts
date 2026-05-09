import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// No Clerk middleware — InsForge handles auth via client-side SDK
export function middleware(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
