import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Faivri — Know if you\'re being overcharged',
    short_name: 'Faivri',
    description:
      'Instant AI-backed price checks with live market sources — repairs, healthcare, Marketplace, eBay, and more.',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#FDFBF6',
    theme_color: '#1A1814',
    orientation: 'portrait',
    categories: ['finance', 'shopping', 'productivity', 'utilities'],
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/512-maskable',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
      { src: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
    ],
    shortcuts: [
      {
        name: 'New price check',
        short_name: 'Analyze',
        description: 'Run a fresh price check on a quote',
        url: '/?source=pwa-shortcut',
        icons: [{ src: '/icons/192', sizes: '192x192' }],
      },
      {
        name: 'My savings',
        short_name: 'Vault',
        description: 'Open your savings vault',
        url: '/vault?source=pwa-shortcut',
        icons: [{ src: '/icons/192', sizes: '192x192' }],
      },
    ],
  }
}
