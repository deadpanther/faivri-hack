/* Faivri service worker — minimal, payment-safe.
 *
 * Strategy:
 *   - Pre-cache the offline shell so the app loads when the network is dead.
 *   - Network-first for HTML navigations; fall back to cached offline page.
 *   - Cache-first for hashed Next.js static assets (/_next/static/*) — they
 *     are immutable, so safe to serve from cache forever.
 *   - PASS-THROUGH (no caching) for:
 *       * /api/* — backend calls (auth + Stripe + analyze)
 *       * Clerk requests (clerk.faivri.com, clerk.com)
 *       * Stripe checkout/billing portal redirects
 *       * Anything that's not a same-origin GET
 *
 * Bumping CACHE_VERSION evicts old caches on the next activate.
 */

const CACHE_VERSION = 'faivri-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`
const OFFLINE_URL = '/offline'

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/faivri-logo.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {
        // best-effort: keep installing even if one URL fails
      }),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      ),
      self.clients.claim(),
    ]),
  )
})

function isAuthOrPaymentUrl(url) {
  const host = url.hostname
  if (host.endsWith('clerk.com') || host.startsWith('clerk.')) return true
  if (host.endsWith('stripe.com')) return true
  if (host.endsWith('checkout.stripe.com')) return true
  if (host.endsWith('billing.stripe.com')) return true
  return false
}

function isApiPath(url) {
  return url.pathname.startsWith('/api/')
}

function isHashedStatic(url) {
  return url.pathname.startsWith('/_next/static/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }

  // Never touch auth, payments, or any API call. Let them go straight
  // to the network — caching here would break sign-in or charge state.
  if (isAuthOrPaymentUrl(url) || isApiPath(url)) return

  // Different origin? Don't intercept — avoids breaking 3rd-party CDNs.
  if (url.origin !== self.location.origin) return

  // HTML navigation: network-first, fall back to cached page or /offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache a clone of successful HTML responses so we can serve them
          // when the user is offline next time.
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          if (cached) return cached
          const offline = await caches.match(OFFLINE_URL)
          return offline || Response.error()
        }),
    )
    return
  }

  // Hashed Next.js static assets are immutable — cache-first forever.
  if (isHashedStatic(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone()
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
    return
  }

  // Other same-origin GETs (icons, public files): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || fetched
    }),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
