import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://faivri.com'

const PUBLIC_ROUTES = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' as const },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' as const },
  { path: '/student', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/community', priority: 0.7, changeFrequency: 'daily' as const },
  { path: '/docs', priority: 0.6, changeFrequency: 'monthly' as const },
  { path: '/privacy', priority: 0.5, changeFrequency: 'yearly' as const },
  { path: '/terms', priority: 0.5, changeFrequency: 'yearly' as const },
  { path: '/refund', priority: 0.5, changeFrequency: 'yearly' as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
