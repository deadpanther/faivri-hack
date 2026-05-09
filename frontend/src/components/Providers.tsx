'use client'

import { InsForgeAuthProvider } from '@/components/auth/InsForgeAuthProvider'
import { ToastProvider } from '@/components/ui/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <InsForgeAuthProvider>
      <ToastProvider>
        {children}
      </ToastProvider>
    </InsForgeAuthProvider>
  )
}
