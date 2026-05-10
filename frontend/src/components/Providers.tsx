'use client'

import { InsForgeAuthProvider } from '@/components/auth/InsForgeAuthProvider'
import { AuthTokenBridge } from '@/components/AuthTokenBridge'
import { ToastProvider } from '@/components/ui/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <InsForgeAuthProvider>
      <AuthTokenBridge />
      <ToastProvider>
        {children}
      </ToastProvider>
    </InsForgeAuthProvider>
  )
}
