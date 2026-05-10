import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/layout/Nav'
import { Footer } from '@/components/layout/Footer'
import { Providers } from '@/components/Providers'
import SmoothScroll from '@/components/ui/SmoothScroll'
import ScrollProgress from '@/components/ui/ScrollProgress'
import { CookieConsent } from '@/components/ui/CookieConsent'
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar'
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body-next',
  weight: ['400', '500', '600', '700'],
})

const display = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display-next',
  weight: ['500', '600', '700', '800'],
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://faivri.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Faivri — Know if you\'re being overcharged',
    template: '%s — Faivri',
  },
  description:
    'Faivri gives instant AI-backed price checks for repairs, healthcare, contractors, and legal services. Verdicts cite live market sources.',
  applicationName: 'Faivri',
  keywords: [
    'price check', 'fair price', 'overcharge detector', 'negotiation assistant',
    'Facebook Marketplace', 'eBay', 'consumer protection', 'price comparison',
  ],
  authors: [{ name: 'Faivri' }],
  creator: 'Faivri',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Faivri',
    title: 'Faivri — Know if you\'re being overcharged',
    description:
      'Instant AI-backed price checks with live market sources. Repairs, healthcare, contractors, Marketplace listings, and more.',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Faivri — Know if you\'re being overcharged',
    description:
      'Instant AI-backed price checks with live market sources. Every verdict cites its comps.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Faivri',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  // iOS Safari resizes the viewport when the on-screen keyboard slides in;
  // 'resizes-content' tells the browser to shrink the layout viewport so
  // sticky/fixed elements stay where the user expects instead of jumping
  // above the keyboard. Critical for the negotiation chat input.
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FDFBF6' },
    { media: '(prefers-color-scheme: dark)', color: '#1A1814' },
  ],
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body
        className="min-h-[100svh] antialiased bg-[var(--warm-bg)] text-[var(--text-1)]"
        // Browser extensions (Grammarly, password managers, etc.) inject
        // attributes onto <body> before React hydrates. We don't render any
        // conditional content directly into <body>, so it's safe — and
        // necessary — to silence the resulting hydration warnings here.
        suppressHydrationWarning
      >
        <Providers>
          <ScrollProgress />
          <SmoothScroll />
          <Nav />
          <main
            className="px-0"
            style={{
              paddingTop: 'calc(env(safe-area-inset-top, 0px) + var(--nav-clearance, 64px))',
            }}
          >
            {children}
          </main>
          <Footer />
          <CookieConsent />
          <PWAInstallPrompt />
          <ServiceWorkerRegistrar />
        </Providers>
      </body>
    </html>
  )
}
