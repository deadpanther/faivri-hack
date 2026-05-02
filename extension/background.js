// Service worker: the only place with cross-origin fetch permission.
// Content scripts MUST route API calls through here via chrome.runtime messages
// because Marketplace / eBay pages have strict CSP that blocks direct fetch().

const DEFAULT_API_URL = 'https://faircheck-backend-production.up.railway.app'
const DEVICE_TOKEN_KEY = 'faivri_device_token'
const ANALYSES_KEY = 'faivri_analyses' // local-only history surface for popup

// Pairing alarm — polls /device/poll while the popup is closed. Min period
// in MV3 is effectively ~30s after the first fire (Chrome ignores anything
// smaller for non-dev installs), so PAIR_POLL_PERIOD_MIN is 0.5 (30s).
const PAIR_POLL_ALARM = 'faivri_pair_poll'
const PAIR_POLL_PERIOD_MIN = 0.5
const PAIR_POLL_TIMEOUT_MS = 10 * 60 * 1000 // matches backend pair-code TTL

// Hosts we shipped as defaults in earlier versions that either never existed
// or no longer resolve. If a user's chrome.storage.sync still has one of these
// from an older install, we quietly migrate them to the live default so they
// don't stay stuck on a dead URL.
const DEAD_HOSTS = new Set([
  'api.faivri.com',
  'api.faircheck.com',
  'faivri.com',
])

function isDeadUrl(raw) {
  try {
    const host = new URL(raw).host.toLowerCase()
    return DEAD_HOSTS.has(host)
  } catch {
    return true
  }
}

async function getApiUrl() {
  try {
    const { apiUrl } = await chrome.storage.sync.get(['apiUrl'])
    if (typeof apiUrl !== 'string' || !apiUrl.trim()) return DEFAULT_API_URL
    if (isDeadUrl(apiUrl)) {
      // Migrate and clear — next call picks up the current default.
      await chrome.storage.sync.remove('apiUrl').catch(() => {})
      return DEFAULT_API_URL
    }
    return apiUrl.trim()
  } catch {
    return DEFAULT_API_URL
  }
}

// ─── Device token (sign-in) ───────────────────────────────────────────
// Long-lived `fvt_*` token issued by the backend after the user pairs
// the extension from a signed-in faivri.com tab. Stored in
// chrome.storage.local so it persists across browser restarts but is
// device-bound (not synced across the user's other Chromes).
async function getDeviceToken() {
  try {
    const data = await chrome.storage.local.get([DEVICE_TOKEN_KEY])
    const tok = data[DEVICE_TOKEN_KEY]
    return typeof tok === 'string' && tok.startsWith('fvt_') ? tok : null
  } catch {
    return null
  }
}

async function setDeviceToken(token) {
  await chrome.storage.local.set({ [DEVICE_TOKEN_KEY]: token })
}

async function clearDeviceToken() {
  await chrome.storage.local.remove([DEVICE_TOKEN_KEY])
}

async function clearPairingState() {
  await chrome.alarms.clear(PAIR_POLL_ALARM).catch(() => {})
  await chrome.storage.local
    .remove(['faivri_pair_code', 'faivri_pair_started_at'])
    .catch(() => {})
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== PAIR_POLL_ALARM) return
  const data = await chrome.storage.local.get([
    'faivri_pair_code',
    'faivri_pair_started_at',
  ])
  const code = data.faivri_pair_code
  const startedAt = data.faivri_pair_started_at || 0
  if (!code) {
    await chrome.alarms.clear(PAIR_POLL_ALARM).catch(() => {})
    return
  }
  if (Date.now() - startedAt > PAIR_POLL_TIMEOUT_MS) {
    await clearPairingState()
    return
  }
  const res = await apiRequest(
    '/api/v1/extension/device/poll',
    { method: 'POST', body: JSON.stringify({ code }) },
    { skipAuth: true },
  )
  if (!res.ok) return
  const status = res.data && res.data.status
  if (status === 'paired' && res.data.token) {
    await setDeviceToken(res.data.token)
    await clearPairingState()
  } else if (status === 'expired' || status === 'claimed') {
    await clearPairingState()
  }
})

// ─── MV3 service worker keepalive ─────────────────────────────────────
// MV3 service workers can be killed while a long fetch is in flight, which
// drops the sendResponse callback and leaves the content script spinning
// forever. The well-known workaround: call a tiny chrome.* API on a timer
// while any request is pending so Chrome keeps the worker alive.
let inflightRequests = 0
let keepaliveTimer = null

function startKeepalive() {
  if (keepaliveTimer) return
  keepaliveTimer = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {})
  }, 20000)
}

function stopKeepalive() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer)
    keepaliveTimer = null
  }
}

// AbortController-based timeout — so if a request genuinely hangs upstream,
// we surface an error instead of leaving the content script waiting.
const REQUEST_TIMEOUT_MS = 75000

async function apiRequest(path, init = {}, opts = {}) {
  inflightRequests += 1
  startKeepalive()

  const base = await getApiUrl()
  const url = `${base.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // Auth header: device token if we have one, never include otherwise.
  const headers = {
    'Content-Type': 'application/json',
    'X-Faivri-Source': 'extension',
    ...(init.headers || {}),
  }
  if (!opts.skipAuth) {
    const token = await getDeviceToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    })

    const requestId = res.headers.get('X-Request-ID')
    let body = null
    try { body = await res.json() } catch { /* non-JSON */ }

    if (!res.ok) {
      const detail = body && typeof body.detail === 'string'
        ? body.detail
        : `API error ${res.status}`
      const quotaDetail = res.status === 402 && body && typeof body.detail === 'object'
        ? body.detail
        : null

      // 401 with sign_in_required is the structured signal from
      // enforce_extension_auth that the extension needs to pair. If our
      // local token is also invalid (revoked from another device), wipe
      // it so the popup re-renders the signed-out state.
      if (res.status === 401) {
        const reason = (typeof detail === 'string' ? detail : '') || ''
        if (reason.includes('invalid or revoked')) {
          await clearDeviceToken()
        }
      }

      return { ok: false, status: res.status, error: detail, quotaDetail, requestId }
    }
    return { ok: true, status: res.status, data: body, requestId }
  } catch (networkErr) {
    const aborted = networkErr && networkErr.name === 'AbortError'
    return {
      ok: false,
      status: 0,
      error: aborted
        ? `Faivri took too long to respond (>${Math.round(REQUEST_TIMEOUT_MS / 1000)}s). Try again — servers may be under load.`
        : `Can't reach Faivri API (${networkErr && networkErr.message || 'network error'}). Check your internet connection.`,
      requestId: null,
    }
  } finally {
    clearTimeout(timeoutId)
    inflightRequests -= 1
    if (inflightRequests <= 0) {
      inflightRequests = 0
      stopKeepalive()
    }
  }
}

// ─── Auth gate for analysis-tracking calls ────────────────────────────
// Per product policy: analyses are only tracked when the user is signed
// in. Anonymous calls hit a 401 with `sign_in_required` so the overlay
// can surface a "Sign in to track this analysis" CTA instead of running
// a wasted check.
async function requireAuthOr401() {
  const token = await getDeviceToken()
  if (token) return null
  return {
    ok: false,
    status: 401,
    error: 'sign_in_required',
    requestId: null,
  }
}

// ─── Analysis history (extension-local, popup-only) ───────────────────
// We stash a thin record of every successful analyze call so the popup
// can render "Recent analyses". The full verdict lives on the server in
// the user's vault — this is just enough to render the list. Stored
// keyed by user_id so signing into a different account on the same
// browser doesn't leak the previous owner's history.
async function pushAnalysisRecord(rec) {
  try {
    const all = await chrome.storage.local.get([ANALYSES_KEY])
    const list = Array.isArray(all[ANALYSES_KEY]) ? all[ANALYSES_KEY] : []
    list.unshift(rec)
    // Cap at 25 so storage doesn't grow forever.
    const capped = list.slice(0, 25)
    await chrome.storage.local.set({ [ANALYSES_KEY]: capped })
  } catch {
    // Storage quota errors are non-fatal — we don't block the user.
  }
}

async function getAnalysisRecords() {
  const all = await chrome.storage.local.get([ANALYSES_KEY])
  return Array.isArray(all[ANALYSES_KEY]) ? all[ANALYSES_KEY] : []
}

async function clearAnalysisRecords() {
  await chrome.storage.local.remove([ANALYSES_KEY])
}

// ─── SPA-navigation injection ─────────────────────────────────────────
const MARKETPLACE_URL_RE = /^https:\/\/[a-z0-9.-]*facebook\.com\/marketplace\//i
const EBAY_URL_RE = /^https:\/\/[a-z0-9.-]*ebay\.com\/itm\//i

async function injectIfMatching(tabId, url) {
  const isMarketplace = MARKETPLACE_URL_RE.test(url)
  const isEbay = EBAY_URL_RE.test(url)
  if (!isMarketplace && !isEbay) return

  const extractor = isMarketplace ? 'content/extract-marketplace.js' : 'content/extract-ebay.js'
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/overlay.css'],
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [extractor, 'content/overlay.js'],
    })
  } catch (err) {
    // Some pages (login, chrome:// fallback) can't be injected — safe to ignore.
  }
}

if (chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return
    injectIfMatching(details.tabId, details.url)
  })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['apiUrl']).then(({ apiUrl }) => {
    if (typeof apiUrl === 'string' && isDeadUrl(apiUrl)) {
      chrome.storage.sync.remove('apiUrl').catch(() => {})
    }
  }).catch(() => {})
})

// ─── Message router ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return

  // ── Auth flows ────────────────────────────────────────────────────
  if (msg.type === 'FAIVRI_AUTH_STATUS') {
    getDeviceToken().then(async (token) => {
      if (!token) {
        sendResponse({ ok: true, signedIn: false })
        return
      }
      const me = await apiRequest('/api/v1/extension/device/me', { method: 'GET' })
      if (me.ok) {
        sendResponse({ ok: true, signedIn: true, profile: me.data })
      } else if (me.status === 401) {
        await clearDeviceToken()
        sendResponse({ ok: true, signedIn: false })
      } else {
        // Network / server error — assume signed in but show a soft warning.
        sendResponse({ ok: false, signedIn: true, error: me.error })
      }
    })
    return true
  }

  if (msg.type === 'FAIVRI_AUTH_START') {
    apiRequest(
      '/api/v1/extension/device/start',
      { method: 'POST', body: JSON.stringify({ label: msg.label || 'Chrome extension' }) },
      { skipAuth: true },
    ).then(async (res) => {
      // MV3 popups die when they lose focus, so we can't poll from the popup
      // — the user clicks "Pair extension" on faivri.com in another tab and
      // the popup is already gone. Schedule a chrome.alarm here so polling
      // survives the popup closing and silently claims the token.
      if (res.ok && res.data && res.data.code) {
        await chrome.storage.local.set({
          faivri_pair_code: res.data.code,
          faivri_pair_started_at: Date.now(),
        })
        chrome.alarms.create(PAIR_POLL_ALARM, {
          when: Date.now() + 1000,
          periodInMinutes: PAIR_POLL_PERIOD_MIN,
        })
      }
      sendResponse(res)
    })
    return true
  }

  if (msg.type === 'FAIVRI_AUTH_POLL') {
    // Kept for backwards compatibility with older popup builds; new flow polls
    // entirely from chrome.alarms in the SW.
    const code = typeof msg.code === 'string' ? msg.code : ''
    if (!code) {
      sendResponse({ ok: false, status: 400, error: 'Missing code' })
      return false
    }
    apiRequest(
      '/api/v1/extension/device/poll',
      { method: 'POST', body: JSON.stringify({ code }) },
      { skipAuth: true },
    ).then(async (res) => {
      if (res.ok && res.data && res.data.status === 'paired' && res.data.token) {
        await setDeviceToken(res.data.token)
        await clearPairingState()
      }
      sendResponse(res)
    })
    return true
  }

  if (msg.type === 'FAIVRI_AUTH_PAIR_STATE') {
    chrome.storage.local
      .get(['faivri_pair_code', 'faivri_pair_started_at'])
      .then((data) => {
        sendResponse({
          ok: true,
          code: data.faivri_pair_code || null,
          startedAt: data.faivri_pair_started_at || 0,
        })
      })
    return true
  }

  if (msg.type === 'FAIVRI_AUTH_REVOKE') {
    apiRequest(
      '/api/v1/extension/device/revoke',
      { method: 'POST', body: JSON.stringify({}) },
    ).then(async (res) => {
      // Always clear local token, even if the server already revoked it.
      await clearDeviceToken()
      await clearAnalysisRecords()
      sendResponse({ ok: true, revoked: !!res.ok })
    })
    return true
  }

  if (msg.type === 'FAIVRI_LIST_ANALYSES') {
    getAnalysisRecords().then((list) => sendResponse({ ok: true, items: list }))
    return true
  }

  // ── Authed product flows ─────────────────────────────────────────
  if (msg.type === 'FAIVRI_ANALYZE') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/analyze', {
        method: 'POST',
        body: JSON.stringify(msg.payload || {}),
      }).then(async (res) => {
        if (res.ok && res.data && res.data.id) {
          await pushAnalysisRecord({
            id: res.data.id,
            verdict: res.data.verdict,
            fair_low: res.data.fair_price_low,
            fair_high: res.data.fair_price_high,
            quoted_price: res.data.quoted_price,
            host: (msg.payload && msg.payload.host) || '',
            at: new Date().toISOString(),
          })
        }
        sendResponse(res)
      })
    })
    return true
  }

  if (msg.type === 'FAIVRI_BOOST_CHECKOUT') {
    apiRequest('/api/v1/usage/boost/checkout', { method: 'GET' }).then(sendResponse)
    return true
  }

  if (msg.type === 'FAIVRI_NEGOTIATE') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/negotiate', {
        method: 'POST',
        body: JSON.stringify({ query_id: msg.queryId }),
      }).then(sendResponse)
    })
    return true
  }

  if (msg.type === 'FAIVRI_CHAT') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/negotiate/chat', {
        method: 'POST',
        body: JSON.stringify(msg.payload || {}),
      }).then(sendResponse)
    })
    return true
  }

  if (msg.type === 'FAIVRI_CHAT_HISTORY') {
    const { queryId, sessionId } = msg
    if (!queryId || !sessionId) {
      sendResponse({ ok: false, status: 400, error: 'Missing queryId or sessionId.' })
      return false
    }
    apiRequest(
      `/api/v1/negotiate/chat/${encodeURIComponent(queryId)}/${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
    ).then(sendResponse)
    return true
  }

  // ── Extension Pro endpoints ─────────────────────────────────────────
  if (msg.type === 'FAIVRI_SELLER_RISK') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/extension/seller-risk', {
        method: 'POST',
        body: JSON.stringify(msg.payload || {}),
      }).then(sendResponse)
    })
    return true
  }

  if (msg.type === 'FAIVRI_REPLY_COACH') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/extension/reply-coach', {
        method: 'POST',
        body: JSON.stringify(msg.payload || {}),
      }).then(sendResponse)
    })
    return true
  }

  if (msg.type === 'FAIVRI_WATCH_CREATE') {
    requireAuthOr401().then((unauth) => {
      if (unauth) { sendResponse(unauth); return }
      apiRequest('/api/v1/extension/listing-watch', {
        method: 'POST',
        body: JSON.stringify(msg.payload || {}),
      }).then(sendResponse)
    })
    return true
  }

  if (msg.type === 'FAIVRI_WATCH_LIST') {
    apiRequest('/api/v1/extension/listing-watch', { method: 'GET' }).then(sendResponse)
    return true
  }

  if (msg.type === 'FAIVRI_WATCH_CANCEL') {
    const { watchId } = msg
    if (!watchId) {
      sendResponse({ ok: false, status: 400, error: 'Missing watchId.' })
      return false
    }
    apiRequest(
      `/api/v1/extension/listing-watch/${encodeURIComponent(watchId)}`,
      { method: 'DELETE' },
    ).then(sendResponse)
    return true
  }
})
