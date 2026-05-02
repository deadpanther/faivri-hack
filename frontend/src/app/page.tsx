'use client'

import { Show } from '@clerk/nextjs'
import AnalyzerStudio from '@/components/home/AnalyzerStudio'
import PreLoginLanding from '@/components/home/PreLoginLanding'

export default function HomePage() {
  return (
    <>
      <Show when="signed-out">
        <PreLoginLanding />
      </Show>
      <Show when="signed-in">
        <AnalyzerStudio />
      </Show>
    </>
  )
}
