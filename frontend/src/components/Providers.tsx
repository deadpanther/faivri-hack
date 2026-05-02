'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { AuthTokenBridge } from '@/components/AuthTokenBridge'
import { IdleLogout } from '@/components/IdleLogout'
import { SessionRevokedToast } from '@/components/SessionRevokedToast'
import { ToastProvider } from '@/components/ui/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#000000',
          colorText: '#37352F',
          colorTextSecondary: '#6B6B6B',
          colorBackground: '#FFFFFF',
          colorInputBackground: '#F7F6F3',
          colorInputText: '#37352F',
          colorDanger: '#EB5757',
          borderRadius: '8px',
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        elements: {
          card: 'border border-[rgba(55,53,47,0.16)] shadow-[0_8px_24px_rgba(0,0,0,0.08)] bg-white',
          headerTitle: 'font-bold text-[1.5rem] text-[#37352F]',
          headerSubtitle: 'text-[0.875rem] text-[#6B6B6B]',
          socialButtonsBlockButton:
            'border border-[rgba(55,53,47,0.16)] bg-[#F7F6F3] text-[#37352F] hover:bg-[#EFEDEA] transition-colors',
          socialButtonsBlockButtonText: 'font-semibold text-[#37352F]',
          dividerLine: 'bg-[rgba(55,53,47,0.12)]',
          dividerText: 'text-[#9B9A97] text-[11px] uppercase tracking-[0.12em]',
          formButtonPrimary:
            'bg-black text-white hover:bg-[#333] border-none shadow-none font-semibold',
          formFieldInput:
            'border border-[rgba(55,53,47,0.16)] bg-[#F7F6F3] text-[#37352F] focus:ring-2 focus:ring-[rgba(35,131,226,0.35)]',
          footerActionLink: 'text-[#2383E2] hover:text-[#0077D4]',
        },
      }}
    >
      <AuthTokenBridge />
      <ToastProvider>
        <IdleLogout />
        <SessionRevokedToast />
        {children}
      </ToastProvider>
    </ClerkProvider>
  )
}
