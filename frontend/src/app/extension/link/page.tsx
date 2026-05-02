import { Suspense } from 'react'
import type { Metadata } from 'next'

import ExtensionLinkClient from './ExtensionLinkClient'

export const metadata: Metadata = {
  title: 'Pair the Faivri extension',
  description: 'Confirm a Chrome extension pairing request from your signed-in Faivri account.',
  robots: { index: false, follow: false },
}

export default function ExtensionLinkPage() {
  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center px-6 py-16">
      <Suspense fallback={<div className="text-sm text-[#6B6B6B]">Loading…</div>}>
        <ExtensionLinkClient />
      </Suspense>
    </div>
  )
}
