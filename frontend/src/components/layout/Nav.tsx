'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BadgeDollarSign, BarChart3, BookOpen, Car, Search, Shield } from 'lucide-react'
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { motion } from 'framer-motion'

import BrandMark from '@/components/ui/BrandMark'
import LanguageDropdown from '@/components/layout/LanguageDropdown'

// Docs intentionally opens in a new tab — keeps people anchored in the app
// while they reference the SDK guide instead of losing their analyze flow.
const signedInDesktopLinks = [
  { href: '/', label: 'Analyze', icon: Search },
  { href: '/used-cars', label: 'Used Cars', icon: Car },
  { href: '/community', label: 'Intelligence', icon: BarChart3 },
  { href: '/vault', label: 'Vault', icon: Shield },
  { href: '/pricing', label: 'Pricing', icon: BadgeDollarSign },
  { href: '/docs', label: 'Docs', icon: BookOpen, external: true },
]

const signedInMobileLinks = [
  { href: '/', label: 'Analyze', icon: Search },
  { href: '/used-cars', label: 'Used Cars', icon: Car },
  { href: '/community', label: 'Intel', icon: BarChart3 },
  { href: '/vault', label: 'Vault', icon: Shield },
]

const signedOutLinks = [
  { href: '/', label: 'Home' },
  { href: '/#how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs', external: true },
]

export function Nav() {
  const pathname = usePathname()

  function isActive(href: string): boolean {
    if (href.startsWith('#')) return pathname === '/'
    if (href.startsWith('/#')) return pathname === '/'
    return pathname === href
  }

  return (
    <>
      {/* Top navigation bar — 12/20px spacing in browser; in installed PWA
          mode on notched devices we max() against safe-area-inset-top so the
          pill clears the status bar. */}
      <nav data-top-nav className="fixed inset-x-0 top-0 z-40 pt-[max(8px,env(safe-area-inset-top))] md:pt-[max(20px,env(safe-area-inset-top))]">
        <div className="mx-auto w-[calc(100%-1rem)] max-w-[1400px] sm:w-[calc(100%-2rem)] md:w-[calc(100%-3rem)]">
          <div className="flex h-[58px] items-center justify-between rounded-full border-b border-[rgba(55,53,47,0.09)] bg-white/90 px-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-sm sm:h-[64px] sm:px-4 md:h-[78px] md:px-8">
            {/* Logo */}
            <Link href="/" className="group flex min-w-0 items-center gap-2 sm:gap-2.5">
              <BrandMark
                size="md"
                priority
                className="transition-transform duration-300 group-hover:scale-[1.03]"
              />
              <div className="min-w-0">
                <p className="font-display text-[16px] font-semibold leading-none tracking-tight text-[#37352F] sm:text-[18px] md:text-[20px]">
                  Faivri
                </p>
                <p className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.13em] text-[#9B9A97] md:block">
                  Pricing Intelligence OS
                </p>
              </div>
            </Link>

            {/* Desktop links */}
            <div className="hidden items-center gap-8 lg:flex">
              <Show when="signed-in">
                {signedInDesktopLinks.map((link) => {
                  const active = !link.external && isActive(link.href)
                  const className = `relative inline-flex items-center gap-2 text-[14px] font-medium transition-colors ${
                    active
                      ? 'text-[#37352F]'
                      : 'text-[#6B6B6B] hover:text-[#37352F]'
                  }`
                  if (link.external) {
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={className}
                      >
                        <link.icon className="h-4 w-4" />
                        {link.label}
                      </a>
                    )
                  }
                  return (
                    <Link key={link.href} href={link.href} className={className}>
                      <link.icon className="h-4 w-4" />
                      {link.label}
                      {active && (
                        <motion.span
                          layoutId="nav-underline"
                          className="absolute -bottom-2 left-0 right-0 h-[2px] rounded-full bg-[#37352F]"
                        />
                      )}
                    </Link>
                  )
                })}
              </Show>

              <Show when="signed-out">
                {signedOutLinks.map((link) => {
                  const active = !link.external && isActive(link.href)
                  const className = `text-[14px] font-medium transition-colors ${
                    active
                      ? 'text-[#37352F]'
                      : 'text-[#6B6B6B] hover:text-[#37352F]'
                  }`
                  if (link.external) {
                    return (
                      <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={className}
                      >
                        {link.label}
                      </a>
                    )
                  }
                  return (
                    <Link key={link.href} href={link.href} className={className}>
                      {link.label}
                    </Link>
                  )
                })}
              </Show>
            </div>

            {/* Right side auth controls */}
            <div className="flex items-center gap-2 md:gap-3">
              <LanguageDropdown />
              <Show when="signed-out">
                <SignInButton>
                  <button className="hidden rounded-full px-4 py-2 text-[13px] font-semibold text-[#37352F] transition-colors hover:bg-[#F1F1EF] sm:inline-flex">
                    Sign In
                  </button>
                </SignInButton>
                <SignUpButton>
                  <button className="rounded-full bg-black px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#333] md:px-5 md:py-2.5 md:text-[14px]">
                    Get Started
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <div className="hidden rounded-full border border-[rgba(55,53,47,0.09)] bg-[#F7F7F5] px-2 py-1.5 md:block">
                  <UserButton />
                </div>
              </Show>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile bottom nav — signed-in only */}
      <Show when="signed-in">
        <div data-bottom-nav className="safe-area-pb fixed inset-x-0 bottom-0 z-50 border-t border-[rgba(55,53,47,0.09)] bg-white/95 backdrop-blur-sm md:hidden">
          <div className="mx-auto flex w-full max-w-[640px] items-center justify-around gap-0.5 px-1.5 py-1.5 sm:px-3 sm:py-2">
            {signedInMobileLinks.map((link) => {
              const active = isActive(link.href)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-all duration-200 ${
                    active
                      ? 'bg-[#F1F1EF] text-[#37352F]'
                      : 'text-[#6B6B6B] hover:text-[#37352F]'
                  }`}
                >
                  <link.icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
                  <span className="text-[10px] font-semibold leading-none">
                    {link.label}
                  </span>
                </Link>
              )
            })}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl border border-[rgba(55,53,47,0.09)] bg-[#F7F7F5] px-1 py-1.5 text-[#6B6B6B]">
              <UserButton />
              <span className="text-[10px] font-semibold leading-none">Account</span>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
