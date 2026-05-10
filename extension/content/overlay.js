// Shared overlay UI + API orchestration. Individual site-specific extractor
// scripts (extract-ebay.js / extract-marketplace.js) register an extractor
// with `window.__FAIVRI_EXTRACTOR = () => ({ title, price, context })`, and
// the overlay calls that when the user clicks the pill.
//
// Why this split: the UI is identical across sites; only the scraping logic
// differs. Keeping extraction per-site means a Marketplace DOM change only
// breaks Marketplace, not eBay.

;(function () {
  if (window.__FAIVRI_OVERLAY_LOADED) return
  window.__FAIVRI_OVERLAY_LOADED = true

  // ─── State ────────────────────────────────────────────────────────────
  let panelOpen = false
  let latestQueryId = null
  let latestVerdict = null
  let latestExtracted = null
  let mounted = false
  let currentUrl = window.location.href
  let chatSessionId = null
  let chatSending = false
  // Per-session log rendered client-side. Server is source of truth on
  // reload — on panel re-open we restore from /negotiate/chat/:q/:s.
  let chatLog = []

  // ─── Root container, isolated from site styles as far as we can manage ──
  const root = document.createElement('div')
  root.className = 'faivri-root'
  root.dataset.faivri = 'root'
  root.style.display = 'none' // hidden until we detect a listing

  // ─── Pill: collapsed state ───────────────────────────────────────────
  const pill = document.createElement('button')
  pill.type = 'button'
  pill.className = 'faivri-pill'
  pill.innerHTML = '<span class="faivri-dot"></span><span>Faivri — check this price</span>'
  pill.addEventListener('click', togglePanel)

  // ─── Panel: expanded state ───────────────────────────────────────────
  const panel = document.createElement('div')
  panel.className = 'faivri-panel'
  panel.style.display = 'none'
  panel.innerHTML = `
    <div class="faivri-panel-header">
      <div class="faivri-panel-title">Faivri price check</div>
      <button type="button" class="faivri-panel-close" aria-label="Close">×</button>
    </div>
    <div class="faivri-panel-body" data-faivri="body"></div>
    <div class="faivri-footer">
      Live market data from Amazon, Walmart, Costco, Newegg, eBay sold listings + more.
    </div>
  `

  panel.querySelector('.faivri-panel-close').addEventListener('click', togglePanel)

  root.appendChild(pill)
  root.appendChild(panel)

  function mount() {
    if (mounted) return
    if (!document.body) return
    document.body.appendChild(root)
    mounted = true
  }

  // ─── Listing detection + SPA navigation handling ────────────────────
  // Marketplace + modern eBay are single-page apps. The content script runs
  // ONCE when the tab first loads the matched URL; after that, URL changes
  // happen via pushState without a page reload. We watch for: (a) URL
  // changes (pushState / popstate), (b) DOM mutations inside role="main"
  // or role="dialog" (FB opens listings in a modal overlay while keeping
  // the feed URL), and toggle the pill accordingly.

  function isListing() {
    const detector = window.__FAIVRI_IS_LISTING
    if (typeof detector !== 'function') return false
    try {
      return Boolean(detector())
    } catch {
      return false
    }
  }

  function refreshVisibility() {
    if (!mounted) mount()
    const listing = isListing()
    if (listing) {
      root.style.display = 'block'
    } else {
      root.style.display = 'none'
      // Hide the panel too so it doesn't get stuck open after navigating
      // to a non-listing page.
      panelOpen = false
      panel.style.display = 'none'
      pill.style.display = 'inline-flex'
      latestQueryId = null
      latestVerdict = null
      latestExtracted = null
      chatSessionId = null
      chatLog = []
    }
  }

  // Patch history APIs so we hear pushState / replaceState. FB uses these
  // heavily; without patching we miss every client-side navigation.
  const historyWrap = (fnName) => {
    const original = history[fnName]
    history[fnName] = function () {
      const ret = original.apply(this, arguments)
      window.dispatchEvent(new Event('faivri:locationchange'))
      return ret
    }
  }
  historyWrap('pushState')
  historyWrap('replaceState')
  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('faivri:locationchange'))
  })

  window.addEventListener('faivri:locationchange', () => {
    if (window.location.href === currentUrl) return
    currentUrl = window.location.href
    // Reset analysis state when URL changes — we're on a different listing.
    latestQueryId = null
    chatSessionId = null
    chatLog = []
    if (panelOpen) togglePanel()
    // Give the SPA a beat to render before we check.
    setTimeout(refreshVisibility, 300)
    setTimeout(refreshVisibility, 1200)
  })

  // Modal overlays don't change the URL. A targeted MutationObserver on
  // dialog appearances covers that case without watching every DOM mutation.
  const bodyObserver = new MutationObserver(() => {
    refreshVisibility()
  })

  function startObserving() {
    if (!document.body) {
      setTimeout(startObserving, 100)
      return
    }
    mount()
    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    })
    refreshVisibility()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true })
  } else {
    startObserving()
  }

  // ─── Helpers ─────────────────────────────────────────────────────────
  function togglePanel() {
    panelOpen = !panelOpen
    panel.style.display = panelOpen ? 'flex' : 'none'
    pill.style.display = panelOpen ? 'none' : 'inline-flex'
    if (panelOpen) runAnalysis()
  }

  function setBody(html) {
    panel.querySelector('[data-faivri="body"]').innerHTML = html
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c])
  }

  function formatCents(cents) {
    if (typeof cents !== 'number') return '—'
    return '$' + (cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })
  }

  function errorBlock(status, message, requestId) {
    const badge = status === 0
      ? 'Network'
      : status === 401 ? 'Sign in'
      : status === 429 ? 'Slow down'
      : status === 503 ? 'Retry'
      : status ? `Err ${status}` : 'Error'
    return `
      <div class="faivri-error">
        <span class="faivri-error-badge">${escapeHtml(badge)}</span>
        ${escapeHtml(message)}
        ${requestId ? `<div class="faivri-error-meta">request_id: ${escapeHtml(requestId)}</div>` : ''}
      </div>
    `
  }

  // Dedicated 401 panel: surfaces a real CTA instead of a generic error
  // banner, so the user can pair the extension without leaving the page.
  // The flow:
  //   1. Click "Sign in"  — message bg → /device/start, open pair URL.
  //   2. Background opens https://faivri.com/extension/link?code=… in a tab.
  //   3. User signs in (if needed) and confirms there.
  //   4. We poll /device/poll until status=paired, then re-run analysis.
  function signInBlock(message) {
    const text = message && message !== 'sign_in_required'
      ? message
      : 'Sign in to track this analysis in your Faivri vault.'
    return `
      <div class="faivri-error">
        <span class="faivri-error-badge">Sign in</span>
        ${escapeHtml(text)}
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
        <button type="button" class="faivri-btn" data-faivri-action="sign-in">
          Sign in with Faivri
        </button>
        <span data-faivri-signin-status style="font-size:11px;color:#666;"></span>
      </div>
    `
  }

  function wireSignInAction(onPaired) {
    const btn = panel.querySelector('[data-faivri-action="sign-in"]')
    const statusEl = panel.querySelector('[data-faivri-signin-status]')
    if (!btn) return
    btn.addEventListener('click', async () => {
      btn.disabled = true
      statusEl.textContent = 'Opening sign-in tab…'
      const start = await sendMessageWithTimeout({ type: 'FAIVRI_AUTH_START' }, 15000)
      if (!start || !start.ok || !start.data || !start.data.code) {
        btn.disabled = false
        statusEl.textContent = (start && start.error) || 'Could not start sign-in. Try again.'
        return
      }
      const code = start.data.code
      // Background already opened the pair tab via chrome.tabs.create from
      // the popup flow, but this content-script entry point hasn't — open
      // it here so the user actually sees the linking page.
      window.open(start.data.pair_url, '_blank', 'noopener,noreferrer')
      statusEl.textContent = 'Waiting for confirmation…'
      const startedAt = Date.now()
      const POLL_INTERVAL = 2000
      const POLL_TIMEOUT = 5 * 60 * 1000
      const tick = async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT) {
          statusEl.textContent = 'Sign-in timed out. Click again to retry.'
          btn.disabled = false
          return
        }
        const res = await sendMessageWithTimeout({ type: 'FAIVRI_AUTH_POLL', code }, 10000)
        if (res && res.ok && res.data) {
          if (res.data.status === 'paired') {
            statusEl.textContent = 'Signed in. Retrying analysis…'
            if (typeof onPaired === 'function') onPaired()
            return
          }
          if (res.data.status === 'expired' || res.data.status === 'claimed') {
            statusEl.textContent = 'Pairing expired. Click again to retry.'
            btn.disabled = false
            return
          }
        }
        setTimeout(tick, POLL_INTERVAL)
      }
      tick()
    })
  }

  // Open the Boost Pack checkout in a new tab via the background service
  // worker — the overlay is a content script and can't hit our authenticated
  // endpoint directly without leaking the JWT into DOM.
  function wireBoostActions() {
    const buy = panel.querySelector('[data-faivri-action="buy-boost"]')
    const upgrade = panel.querySelector('[data-faivri-action="upgrade-plan"]')
    if (buy) {
      buy.addEventListener('click', () => {
        buy.disabled = true
        sendMessageWithTimeout({ type: 'FAIVRI_BOOST_CHECKOUT' }, 15000).then((response) => {
          buy.disabled = false
          if (response && response.ok && response.data && response.data.checkout_url) {
            window.open(response.data.checkout_url, '_blank', 'noopener,noreferrer')
          } else {
            window.open('https://faivri.com/pricing', '_blank', 'noopener,noreferrer')
          }
        })
      })
    }
    if (upgrade) {
      upgrade.addEventListener('click', () => {
        window.open('https://faivri.com/pricing', '_blank', 'noopener,noreferrer')
      })
    }
  }

  // Dedicated 402 panel: friendlier than the generic error banner and gives
  // the user an immediate way out (Boost Pack one-tap, or upgrade).
  function outOfAnalysesBlock(detail) {
    const plan = (detail && detail.plan) || 'your plan'
    const resetAt = detail && detail.reset_at
    const resetLabel = resetAt
      ? (() => {
          try {
            return new Date(resetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          } catch { return 'next cycle' }
        })()
      : 'next cycle'
    const boost = (detail && detail.boost) || {}
    const priceCents = typeof boost.price_cents === 'number' ? boost.price_cents : 499
    const credits = typeof boost.credits_per_pack === 'number' ? boost.credits_per_pack : 10
    const priceStr = `$${(priceCents / 100).toFixed(2)}`
    return `
      <div class="faivri-error">
        <span class="faivri-error-badge">Out of analyses</span>
        You've used every ${escapeHtml(plan)} analysis this month. Resets on ${escapeHtml(resetLabel)}.
      </div>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
        <button type="button" class="faivri-btn" data-faivri-action="buy-boost">
          Get Boost Pack — ${escapeHtml(priceStr)} for ${credits} analyses
        </button>
        <button type="button" class="faivri-btn faivri-btn-secondary" data-faivri-action="upgrade-plan">
          See plan upgrades
        </button>
      </div>
    `
  }

  // Wrap chrome.runtime.sendMessage with a timeout. MV3 service workers can
  // be killed mid-fetch, which drops the sendResponse callback; without this
  // timeout the content script spins indefinitely. The background worker
  // also applies its own fetch timeout — this is a defence-in-depth safety
  // net for cases where the worker itself is gone.
  function sendMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const timer = setTimeout(() => finish(null), timeoutMs)
      try {
        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timer)
          // Surface runtime errors (e.g., worker died) as a null response
          // so the caller renders its timeout-style error.
          if (chrome.runtime.lastError) {
            finish(null)
            return
          }
          finish(response || null)
        })
      } catch {
        clearTimeout(timer)
        finish(null)
      }
    })
  }

  // ─── Core flow ───────────────────────────────────────────────────────
  async function runAnalysis() {
    const extractor = window.__FAIVRI_EXTRACTOR
    if (typeof extractor !== 'function') {
      setBody(errorBlock(0, 'This page is not yet supported by the Faivri extension.', null))
      return
    }

    let extracted
    try {
      extracted = extractor()
    } catch (err) {
      setBody(errorBlock(0, 'Could not read this listing. The page layout may have changed.', null))
      return
    }

    if (!extracted || !extracted.title) {
      setBody(errorBlock(0, 'Could not find a listing title on this page. Open a specific item listing and try again.', null))
      return
    }

    setBody(`
      <div class="faivri-loading">
        <div class="faivri-spinner"></div>
        <div>Searching live market data for <strong>${escapeHtml(extracted.title.slice(0, 60))}</strong>${extracted.title.length > 60 ? '…' : ''}</div>
      </div>
    `)

    // Build a free-text query the backend classifier understands well. We
    // always send source-platform context ("on eBay", "on Facebook
    // Marketplace") so the classifier routes to the retail domain.
    const platform = extracted.platform || 'online marketplace'
    const priceText = extracted.price ? ` quoted at $${extracted.price.toLocaleString('en-US')}` : ''
    const condText = extracted.condition ? ` (${extracted.condition})` : ''
    const queryText = `A ${platform} listing${condText} for "${extracted.title}"${priceText}. Is that a fair price? Use live Amazon/Walmart/Newegg/Best Buy retail prices and recent eBay sold listings as reference.`

    const quotedPriceCents = typeof extracted.price === 'number'
      ? Math.round(extracted.price * 100)
      : undefined

    const payload = {
      query: queryText,
      domain: 'retail',
      quoted_price: quotedPriceCents,
    }

    sendMessageWithTimeout({ type: 'FAIVRI_ANALYZE', payload }, 90000).then((response) => {
      if (!response) {
        setBody(errorBlock(0, 'Faivri took too long to respond. Try reloading the page and clicking the pill again.', null))
        return
      }
      if (!response.ok) {
        if (response.status === 402) {
          setBody(outOfAnalysesBlock(response.quotaDetail || null))
          wireBoostActions()
          return
        }
        if (response.status === 401) {
          setBody(signInBlock(response.error))
          // Re-run analysis once pairing finishes.
          wireSignInAction(() => runAnalysis())
          return
        }
        setBody(errorBlock(response.status, response.error, response.requestId))
        return
      }
      latestQueryId = response.data.id
      latestVerdict = response.data
      latestExtracted = extracted
      renderVerdict(extracted, response.data)
    })
  }

  function renderVerdict(extracted, v) {
    const verdict = (v.verdict || 'fair').toLowerCase()
    const label = verdict === 'fair' ? 'Fair price' : verdict === 'high' ? 'Above market' : 'Overcharge'
    const fairLow = formatCents(v.fair_price_low)
    const fairHigh = formatCents(v.fair_price_high)
    const fairMid = formatCents(v.fair_price_mid)
    const multiplier = v.overcharge_multiplier ? `${Number(v.overcharge_multiplier).toFixed(2)}×` : null
    const dataPoints = v.data_points_count || 0
    const redFlags = Array.isArray(v.red_flags) ? v.red_flags.slice(0, 3) : []
    const overpriced = verdict === 'overcharge' || verdict === 'high'

    const redFlagHtml = redFlags.length
      ? `
        <div class="faivri-section-title">Red flags</div>
        ${redFlags.map((f) => `<div class="faivri-red-flag">${escapeHtml(f)}</div>`).join('')}
      ` : ''

    const playbookSlot = overpriced
      ? `<div data-faivri="playbook-slot"><div class="faivri-loading"><div class="faivri-spinner"></div><div>Drafting your negotiation playbook…</div></div></div>`
      : `<button type="button" class="faivri-btn" data-faivri-action="negotiate">Get my negotiation script</button>`

    setBody(`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span class="faivri-verdict ${verdict}">${escapeHtml(label)}${multiplier ? ' · ' + escapeHtml(multiplier) : ''}</span>
        <span style="font-size:11px;color:#666;">${dataPoints} source${dataPoints === 1 ? '' : 's'}</span>
      </div>
      <div class="faivri-fair-range">
        Fair market: <strong>${fairLow} – ${fairHigh}</strong> (median ${fairMid})
        ${typeof extracted.price === 'number' ? `<br/>This listing: <strong>$${extracted.price.toLocaleString('en-US')}</strong>` : ''}
      </div>
      <div class="faivri-explanation">${escapeHtml(v.explanation || '')}</div>
      ${redFlagHtml}
      ${playbookSlot}
    `)

    if (overpriced) {
      runNegotiate()
    } else {
      panel.querySelector('[data-faivri-action="negotiate"]')?.addEventListener('click', runNegotiate)
    }
  }

  // Every price the playbook surfaces must come out strictly below the
  // listing. A buyer handed a script that says "offer $200" on a $200
  // listing has been coached back into the sticker — that's not a
  // negotiation, that's a cheerful acceptance. Walkaway caps at 95% of
  // listed (a real, felt discount), or fair-market high when retail is
  // cheaper. Opening/target clamp so anchor ≤ target ≤ walkaway holds.
  //
  // Marketplaces (FB, eBay, Craigslist) use 70/85/95 of listed; sellers
  // expect 10–30% off and rarely hold firm on the sticker. Non-marketplace
  // flows (service quotes, retail) anchor on the fair range but still
  // enforce the strict-below-listing ceiling when a listing price exists.
  const MAX_LISTING_PCT = 0.95
  function computePlaybookAnchors(v, extracted) {
    const fairLow = v.fair_price_low
    const fairMid = v.fair_price_mid
    const fairHigh = v.fair_price_high
    const listedDollars = typeof extracted?.price === 'number' ? extracted.price : null
    const listedCents = listedDollars !== null && listedDollars > 0
      ? Math.round(listedDollars * 100)
      : null
    const platform = String(extracted?.platform || '').toLowerCase()
    const isMarketplace = Boolean(listedCents) && /marketplace|ebay|craigslist|offerup|listing/.test(platform)

    const strictBelowListing = (cents) => {
      if (listedCents == null) return cents
      const ceiling = Math.floor(listedCents * MAX_LISTING_PCT)
      return cents == null ? ceiling : Math.min(cents, ceiling)
    }

    if (isMarketplace) {
      const walkawayCents = strictBelowListing(fairHigh ?? listedCents)
      const openingCents = Math.min(Math.round(listedCents * 0.70), walkawayCents)
      const targetCents = Math.min(Math.round(listedCents * 0.85), walkawayCents)
      return { anchorCents: openingCents, targetCents, walkawayCents, listedCents, isMarketplace: true }
    }

    return {
      anchorCents: strictBelowListing(fairLow ?? fairMid),
      targetCents: strictBelowListing(fairMid),
      walkawayCents: strictBelowListing(fairHigh ?? fairMid),
      listedCents,
      isMarketplace: false,
    }
  }

  // Template the counter + walkaway lines client-side using the live price
  // numbers from the verdict. The API gives us an opening script; these two
  // fill out the full playbook without needing a round-trip.
  function buildPlaybookScripts(openingText, v, extracted) {
    const { anchorCents, targetCents, walkawayCents, listedCents, isMarketplace } =
      computePlaybookAnchors(v, extracted)
    const anchor = formatCents(anchorCents)
    const target = formatCents(targetCents)
    const walkaway = formatCents(walkawayCents)
    const listingPrice = listedCents != null
      ? `$${(listedCents / 100).toLocaleString('en-US')}`
      : null

    // On marketplaces we IGNORE the backend's opening script — it's drafted
    // against retail comps and will suggest prices above the listing. Local
    // template keeps the opener proportionate to what's actually posted.
    const useBackendOpener = !isMarketplace && openingText && openingText.trim()

    const opening = useBackendOpener
      ? openingText.trim()
      : isMarketplace
        ? `Hi — interested in this${listingPrice ? ` at ${listingPrice}` : ''}. Any flexibility on the price? Would you consider ${anchor}?`
        : `Hi — I'm interested, but based on current retail comps and recent sold listings I'm seeing this around ${anchor}–${target}. Would you take ${anchor}?`

    const counter = isMarketplace
      ? `Totally get it. Could you meet me at ${target}? I can pay right now and pick up today.`
      : `I hear you. My ceiling on this is ${walkaway} — that's already the top of current market. If you can meet me at ${target}, I can send payment today.`

    const walkawayScript = isMarketplace
      ? `Thanks for your time — my max on this is ${walkaway}. If you change your mind, I'm around.`
      : listingPrice
        ? `Thanks for your time. I'll keep looking in the ${anchor}–${target} range since ${listingPrice} is above what I'm seeing elsewhere. If you change your mind, happy to revisit.`
        : `Thanks for your time — I'll keep looking in the ${anchor}–${target} range. If you change your mind, happy to revisit.`

    return [
      { role: 'opening', label: 'Opening offer', text: opening, price: anchor },
      { role: 'counter', label: 'If they push back', text: counter, price: target },
      { role: 'walkaway', label: 'Walk away politely', text: walkawayScript, price: walkaway },
    ]
  }

  function defaultTactics(extracted) {
    const isEbay = (extracted?.platform || '').toLowerCase() === 'ebay'
    return [
      'Ask for the exact model number or SKU to verify comps',
      isEbay ? 'Use eBay Best Offer — sellers expect 10–20% off' : 'Request photos of the serial/label before agreeing',
      'Mention you have cash / can pay instantly — it shortens their timeline',
    ]
  }

  async function runNegotiate() {
    if (!latestQueryId) return
    const slot = panel.querySelector('[data-faivri="playbook-slot"]')
    const btn = panel.querySelector('[data-faivri-action="negotiate"]')
    if (btn) { btn.disabled = true; btn.textContent = 'Drafting your playbook…' }

    sendMessageWithTimeout({ type: 'FAIVRI_NEGOTIATE', queryId: latestQueryId }, 90000).then((response) => {
      const host = slot || panel.querySelector('[data-faivri="body"]')
      if (!response || !response.ok) {
        const errHtml = response
          ? errorBlock(response.status, response.error, response.requestId)
          : errorBlock(0, 'Faivri took too long to draft the playbook. Click the pill again to retry.', null)
        if (slot) slot.innerHTML = errHtml
        else host.insertAdjacentHTML('beforeend', errHtml)
        return
      }
      const scripts = Array.isArray(response.data.scripts) ? response.data.scripts : []
      const openingText = scripts[0]?.text || ''
      renderPlaybook(openingText)
    })
  }

  function renderPlaybook(openingText) {
    if (!latestVerdict) return
    const v = latestVerdict
    const extracted = latestExtracted || {}
    const entries = buildPlaybookScripts(openingText, v, extracted)
    const tactics = defaultTactics(extracted)
    const anchors = computePlaybookAnchors(v, extracted)
    const anchor = formatCents(anchors.anchorCents)
    const target = formatCents(anchors.targetCents)
    const walkaway = formatCents(anchors.walkawayCents)

    const entryHtml = entries.map((entry, idx) => `
      <div class="faivri-play-step" data-faivri-step="${idx}">
        <div class="faivri-play-step-head">
          <span class="faivri-play-step-label">${escapeHtml(entry.label)}</span>
          <span class="faivri-play-step-price">${escapeHtml(entry.price)}</span>
        </div>
        <div class="faivri-script" data-faivri-script="${idx}">${escapeHtml(entry.text)}</div>
        <button type="button" class="faivri-btn faivri-btn-sm" data-faivri-copy="${idx}">Copy</button>
      </div>
    `).join('')

    const tacticHtml = tactics.map((t) => `<div class="faivri-tactic">${escapeHtml(t)}</div>`).join('')

    const html = `
      <div class="faivri-section-title">Negotiation playbook</div>
      <div class="faivri-play-anchors">
        <div><span class="faivri-play-anchor-label">Anchor</span><strong>${anchor}</strong></div>
        <div><span class="faivri-play-anchor-label">Target</span><strong>${target}</strong></div>
        <div><span class="faivri-play-anchor-label">Walk away</span><strong>${walkaway}</strong></div>
      </div>
      ${entryHtml}
      <div class="faivri-section-title">Tactics</div>
      ${tacticHtml}
    `

    const slot = panel.querySelector('[data-faivri="playbook-slot"]')
    if (slot) {
      slot.innerHTML = html
    } else {
      const body = panel.querySelector('[data-faivri="body"]')
      const negotiateBtn = panel.querySelector('[data-faivri-action="negotiate"]')
      if (negotiateBtn) negotiateBtn.remove()
      body.insertAdjacentHTML('beforeend', html)
    }

    entries.forEach((entry, idx) => {
      const copyBtn = panel.querySelector(`[data-faivri-copy="${idx}"]`)
      if (!copyBtn) return
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(entry.text).then(
          () => { copyBtn.textContent = '✓ Copied' },
          () => { copyBtn.textContent = 'Copy failed' },
        )
        setTimeout(() => { copyBtn.textContent = 'Copy' }, 2400)
      })
    })

    // Mount the conversational chat below the playbook. This is the "hand
    // me replies after the seller says something else" feature — the scripts
    // above are the opener; chat handles the unpredictable rest.
    mountChat()
  }

  // ─── Conversational chat ─────────────────────────────────────────────
  function generateSessionId() {
    // crypto.randomUUID isn't universally available inside content-script
    // contexts; fall back to timestamp + random for reliability.
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return 'fv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }

  function mountChat() {
    if (!latestQueryId) return
    if (!chatSessionId) {
      chatSessionId = generateSessionId()
      chatLog = []
    }
    const body = panel.querySelector('[data-faivri="body"]')
    if (!body || body.querySelector('[data-faivri="chat"]')) return

    const wrap = document.createElement('div')
    wrap.className = 'faivri-chat-wrap'
    wrap.setAttribute('data-faivri', 'chat')
    wrap.innerHTML = `
      <div class="faivri-section-title">Live conversation coach</div>
      <div class="faivri-chat-toggle">
        <button type="button" data-faivri-chat-mode="seller" class="active">Seller replied</button>
        <button type="button" data-faivri-chat-mode="user">I have a question</button>
      </div>
      <div class="faivri-chat-log" data-faivri="chat-log"></div>
      <div class="faivri-chat-input-row">
        <textarea class="faivri-chat-input" data-faivri="chat-input"
          placeholder="Paste what the seller said — I'll draft your reply"></textarea>
        <button type="button" class="faivri-chat-send" data-faivri="chat-send">Send</button>
      </div>
      <div class="faivri-chat-coach-hint" data-faivri="chat-hint" style="display:none;"></div>
    `
    body.appendChild(wrap)

    let mode = 'seller'
    const setMode = (nextMode) => {
      mode = nextMode
      wrap.querySelectorAll('[data-faivri-chat-mode]').forEach((b) => {
        b.classList.toggle('active', b.dataset.faivriChatMode === nextMode)
      })
      const input = wrap.querySelector('[data-faivri="chat-input"]')
      input.placeholder = nextMode === 'seller'
        ? "Paste what the seller said — I'll draft your reply"
        : 'Ask me anything about the negotiation'
    }
    wrap.querySelectorAll('[data-faivri-chat-mode]').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.faivriChatMode))
    })

    const input = wrap.querySelector('[data-faivri="chat-input"]')
    const sendBtn = wrap.querySelector('[data-faivri="chat-send"]')
    const onSend = () => {
      const text = (input.value || '').trim()
      if (!text) return
      sendChatTurn(mode, text)
      input.value = ''
    }
    sendBtn.addEventListener('click', onSend)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        onSend()
      }
    })
    renderChatLog()
  }

  function appendToChatLog(entry) {
    chatLog.push(entry)
    renderChatLog()
  }

  function renderChatLog() {
    const logEl = panel.querySelector('[data-faivri="chat-log"]')
    if (!logEl) return
    logEl.innerHTML = chatLog.map((msg) => {
      const cls = msg.role === 'user'
        ? 'user'
        : msg.role === 'coach' ? 'coach' : 'assistant'
      const label = msg.role === 'user'
        ? 'You'
        : msg.role === 'coach' ? 'Faivri suggests'
        : 'Seller'
      const priceMeta = msg.suggested_price_cents
        ? `<div class="faivri-chat-meta">Target: ${formatCents(msg.suggested_price_cents)}</div>`
        : ''
      return `
        <div class="faivri-chat-msg ${cls}">
          <div style="font-size:10px;opacity:0.65;margin-bottom:3px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(label)}</div>
          ${escapeHtml(msg.content)}
          ${priceMeta}
        </div>
      `
    }).join('')
    logEl.scrollTop = logEl.scrollHeight
  }

  function setChatSending(sending) {
    chatSending = sending
    const sendBtn = panel.querySelector('[data-faivri="chat-send"]')
    const input = panel.querySelector('[data-faivri="chat-input"]')
    if (sendBtn) {
      sendBtn.disabled = sending
      sendBtn.textContent = sending ? '…' : 'Send'
    }
    if (input) input.disabled = sending
  }

  function sendChatTurn(mode, text) {
    if (chatSending || !latestQueryId || !chatSessionId) return

    if (mode === 'seller') {
      appendToChatLog({ role: 'assistant', content: text })
    } else {
      appendToChatLog({ role: 'user', content: text })
    }
    setChatSending(true)

    const payload = {
      query_id: latestQueryId,
      session_id: chatSessionId,
      seller_message: mode === 'seller' ? text : undefined,
      user_message: mode === 'user' ? text : undefined,
    }

    sendMessageWithTimeout(
      { type: 'FAIVRI_CHAT', payload },
      60000,
    ).then((response) => {
      setChatSending(false)
      if (!response) {
        appendToChatLog({
          role: 'coach',
          content: "Couldn't reach Faivri — your text is saved. Try again in a moment.",
        })
        return
      }
      if (!response.ok) {
        appendToChatLog({
          role: 'coach',
          content: response.error || 'Chat failed. Please retry.',
        })
        return
      }
      const data = response.data || {}
      appendToChatLog({
        role: 'coach',
        content: data.reply || 'Let me think on that — try rephrasing?',
        suggested_price_cents: data.suggested_price_cents,
      })
      if (data.tone === 'accept' || data.should_accept) {
        const hint = panel.querySelector('[data-faivri="chat-hint"]')
        if (hint) {
          hint.style.display = 'block'
          hint.textContent = 'This offer is at or inside your fair range — consider accepting and locking it in writing.'
        }
      }
    })
  }
})()
