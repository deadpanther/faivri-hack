// Faivri extension popup. Two surfaces:
//   1. Auth state (signed-in vs signed-out + pairing handshake)
//   2. Analyses list — local-only mirror of recent verdicts
//
// All network traffic flows through background.js so the device token
// stays in chrome.storage.local and never leaks into popup-rendered HTML.

const DEFAULT_API_URL = 'https://faircheck-backend-production.up.railway.app'
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 10 * 60 * 1000 // matches backend pair-code TTL

const $ = (id) => document.getElementById(id)

// ─── DOM refs ───────────────────────────────────────────────
const statusDot = $('statusDot')
const hdrSub = $('hdrSub')
const signedOutCard = $('signedOutCard')
const signedInCard = $('signedInCard')
const analysesCard = $('analysesCard')
const analysesList = $('analysesList')
const meName = $('meName')
const mePlan = $('mePlan')
const signInBtn = $('signInBtn')
const signOutBtn = $('signOutBtn')
const pairHint = $('pairHint')
const pairCodeEl = $('pairCode')
const cancelPairBtn = $('cancelPairBtn')
const authStatus = $('authStatus')
const apiUrlInput = $('apiUrl')
const saveBtn = $('saveBtn')
const saveStatus = $('saveStatus')

// ─── Helpers ────────────────────────────────────────────────
function setStatusBadge(state) {
  statusDot.classList.remove('green', 'amber', 'red')
  if (state === 'green') statusDot.classList.add('green')
  else if (state === 'amber') statusDot.classList.add('amber')
  else statusDot.classList.add('red')
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}))
  })
}

function escape(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

function fmt(cents) {
  if (typeof cents !== 'number') return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function relTime(iso) {
  try {
    const then = new Date(iso).getTime()
    const mins = Math.round((Date.now() - then) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 48) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
  } catch {
    return ''
  }
}

// ─── Render ─────────────────────────────────────────────────
function showSignedOut(message) {
  signedOutCard.hidden = false
  signedInCard.hidden = true
  analysesCard.hidden = true
  setStatusBadge('amber')
  hdrSub.textContent = 'Sign in to start tracking your price checks.'
  if (typeof message === 'string') authStatus.textContent = message
}

function showSignedIn(profile) {
  signedOutCard.hidden = true
  signedInCard.hidden = false
  analysesCard.hidden = false
  setStatusBadge('green')
  hdrSub.textContent = 'Price check & negotiate on eBay and Facebook Marketplace.'
  meName.textContent = profile.display_name || 'Signed in'
  mePlan.textContent = (profile.plan || 'scout').toUpperCase()
}

function renderAnalyses(items) {
  if (!Array.isArray(items) || items.length === 0) {
    analysesList.innerHTML = '<li class="empty">No tracked analyses yet — open a listing on eBay or Marketplace to start.</li>'
    return
  }
  analysesList.innerHTML = items.slice(0, 8).map((it) => {
    const verdict = (it.verdict || '').toLowerCase()
    const badgeCls = verdict === 'fair' ? 'fair' : verdict === 'high' ? 'high' : verdict === 'overcharge' ? 'over' : ''
    return `
      <li class="row">
        <div class="row-main">
          <span class="badge ${badgeCls}">${escape(verdict || 'pending')}</span>
          <span class="row-fair">${fmt(it.fair_low)}–${fmt(it.fair_high)}</span>
        </div>
        <div class="row-meta">
          ${it.quoted_price ? '<span>Quoted ' + fmt(it.quoted_price) + '</span>' : ''}
          <span>${escape(it.host || '')}</span>
          <span>${relTime(it.at)}</span>
        </div>
      </li>
    `
  }).join('')
}

// ─── Pairing handshake ──────────────────────────────────────
let pollTimer = null
let pollStartedAt = 0
let activePairCode = null

async function startSignIn() {
  signInBtn.disabled = true
  authStatus.textContent = ''
  pairHint.hidden = false

  const res = await send({ type: 'FAIVRI_AUTH_START' })
  if (!res.ok) {
    pairHint.hidden = true
    signInBtn.disabled = false
    authStatus.textContent = res.error || 'Could not start sign-in. Try again.'
    return
  }
  activePairCode = res.data.code
  pairCodeEl.textContent = activePairCode
  // Open the linking page in a new tab so the user can confirm. The popup
  // closes the moment focus moves to that tab — actual polling lives in the
  // service worker (chrome.alarms) so the token gets claimed even though
  // this popup is gone. We also keep a foreground poll while the popup is
  // visible for snappier UI.
  chrome.tabs.create({ url: res.data.pair_url })
  pollStartedAt = Date.now()
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS)
}

async function pollOnce() {
  if (!activePairCode) return
  if (Date.now() - pollStartedAt > POLL_TIMEOUT_MS) {
    stopPolling('Pairing timed out. Try again.')
    return
  }
  const res = await send({ type: 'FAIVRI_AUTH_POLL', code: activePairCode })
  if (!res.ok) return
  const status = res.data && res.data.status
  if (status === 'paired') {
    stopPolling()
    await refreshAuthStatus()
    await refreshAnalyses()
  } else if (status === 'expired' || status === 'claimed') {
    stopPolling('Pairing code expired. Try again.')
  }
}

function stopPolling(message) {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  activePairCode = null
  pairHint.hidden = true
  signInBtn.disabled = false
  if (message) authStatus.textContent = message
}

async function signOut() {
  signOutBtn.disabled = true
  await send({ type: 'FAIVRI_AUTH_REVOKE' })
  signOutBtn.disabled = false
  showSignedOut('Signed out.')
  renderAnalyses([])
}

async function refreshAuthStatus() {
  const res = await send({ type: 'FAIVRI_AUTH_STATUS' })
  if (res && res.signedIn && res.profile) {
    showSignedIn(res.profile)
  } else {
    showSignedOut()
  }
}

async function refreshAnalyses() {
  const res = await send({ type: 'FAIVRI_LIST_ANALYSES' })
  renderAnalyses(res && res.ok ? res.items : [])
}

// ─── API URL config (kept under <details> to stop dominating UI) ──
async function loadApiUrl() {
  try {
    const { apiUrl } = await chrome.storage.sync.get(['apiUrl'])
    apiUrlInput.value = apiUrl || DEFAULT_API_URL
  } catch {
    apiUrlInput.value = DEFAULT_API_URL
  }
}

async function saveApiUrl() {
  const raw = apiUrlInput.value.trim()
  const url = raw || DEFAULT_API_URL
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol')
    await chrome.storage.sync.set({ apiUrl: url })
    saveStatus.textContent = 'Saved. Applies on next request.'
    saveStatus.classList.remove('err')
  } catch {
    saveStatus.textContent = 'That is not a valid URL.'
    saveStatus.classList.add('err')
  }
}

// ─── Wire up ─────────────────────────────────────────────────
signInBtn.addEventListener('click', startSignIn)
cancelPairBtn.addEventListener('click', () => stopPolling('Pairing cancelled.'))
signOutBtn.addEventListener('click', signOut)
saveBtn.addEventListener('click', saveApiUrl)

async function resumePairingIfActive() {
  // If the SW alarm is still polling a pair code (popup was closed during
  // pair flow), surface "Pairing…" UI and run a foreground poll so the user
  // doesn't see a confusing signed-out screen with no feedback.
  const state = await send({ type: 'FAIVRI_AUTH_PAIR_STATE' })
  if (!state || !state.ok || !state.code) return false
  const elapsed = Date.now() - (state.startedAt || 0)
  if (elapsed > POLL_TIMEOUT_MS) return false
  activePairCode = state.code
  pollStartedAt = state.startedAt || Date.now()
  pairCodeEl.textContent = state.code
  pairHint.hidden = false
  signInBtn.disabled = true
  pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS)
  return true
}

;(async () => {
  await loadApiUrl()
  await refreshAuthStatus()
  await resumePairingIfActive()
  await refreshAnalyses()
})()
