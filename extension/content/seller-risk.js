// Extension Pro — Seller Risk Score badge.
//
// Runs alongside overlay.js on eBay + Facebook Marketplace listing pages.
// When a listing is visible, fetches the Seller Risk Score from the backend
// (which hybrid-reads Firecrawl + Tavily) and renders a compact badge beside
// the Faivri pill.
//
// Badge is non-blocking: if the API is unavailable or the user isn't on a
// paid plan, we silently render nothing — the Basic price-check overlay
// continues to work.

;(function () {
  if (window.__FAIVRI_SELLER_RISK_LOADED) return
  window.__FAIVRI_SELLER_RISK_LOADED = true

  const BAND_COLORS = {
    green: { bg: '#E7F5EC', fg: '#147B3E', border: '#147B3E' },
    amber: { bg: '#FFF4E0', fg: '#9A5B00', border: '#E09416' },
    red:   { bg: '#FDE8E8', fg: '#9B1B1B', border: '#C93434' },
  }

  let badge = null
  let lastListingKey = null

  function listingKey() {
    // eBay: pathname contains /itm/<id>. FB: pathname contains /marketplace/item/<id>.
    const m = window.location.pathname.match(/\/(?:itm|item)\/([\w-]+)/)
    return m ? m[1] : window.location.href
  }

  function inferPlatform() {
    const host = window.location.hostname
    if (host.endsWith('ebay.com') || host.endsWith('ebay.co.uk')) return 'ebay'
    if (host.endsWith('facebook.com') || host.endsWith('fb.com')) return 'facebook'
    return null
  }

  function ensureBadge() {
    if (badge && document.body.contains(badge)) return badge
    badge = document.createElement('div')
    badge.className = 'faivri-seller-badge'
    badge.setAttribute('data-faivri', 'seller-risk')
    badge.style.cssText = [
      'position: fixed',
      'top: 14px',
      'right: 18px',
      'z-index: 2147483646',
      'display: none',
      'align-items: center',
      'gap: 8px',
      'padding: 8px 12px',
      'border-radius: 999px',
      'border: 1px solid rgba(0,0,0,0.08)',
      'background: #fff',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.08)',
      'font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'color: #37352F',
      'cursor: pointer',
      'user-select: none',
    ].join(';')

    badge.addEventListener('click', toggleDetails)
    document.body.appendChild(badge)
    return badge
  }

  function renderBadge({ score, band, summary, reasons }) {
    const el = ensureBadge()
    const palette = BAND_COLORS[band] || BAND_COLORS.amber
    el.dataset.band = band
    el.innerHTML = `
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:${palette.bg};color:${palette.fg};font-weight:700;font-size:10px;border:1px solid ${palette.border}">
        ${score}
      </span>
      <span style="display:flex;flex-direction:column;line-height:1.2">
        <span style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#6B6B6B">Seller risk</span>
        <span style="font-weight:600">${bandLabel(band)}</span>
      </span>
    `
    el.title = summary || ''
    el._faivriReasons = reasons || []
    el.style.display = 'inline-flex'
  }

  function bandLabel(band) {
    if (band === 'green') return 'Looks clean'
    if (band === 'amber') return 'Mixed signals'
    if (band === 'red') return 'High risk'
    return 'Unrated'
  }

  let detailsPanel = null
  function toggleDetails() {
    if (detailsPanel && detailsPanel.parentNode) {
      detailsPanel.remove()
      detailsPanel = null
      return
    }
    if (!badge) return
    const reasons = badge._faivriReasons || []
    detailsPanel = document.createElement('div')
    detailsPanel.setAttribute('data-faivri', 'seller-risk-details')
    detailsPanel.style.cssText = [
      'position: fixed',
      'top: 58px',
      'right: 18px',
      'z-index: 2147483646',
      'width: 300px',
      'padding: 14px 16px',
      'background: #fff',
      'border: 1px solid rgba(0,0,0,0.09)',
      'border-radius: 14px',
      'box-shadow: 0 12px 32px rgba(0,0,0,0.14)',
      'font: 400 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'color: #37352F',
    ].join(';')
    const title = document.createElement('div')
    title.style.cssText = 'font-weight:600;margin-bottom:8px;font-size:13px'
    title.textContent = 'Seller risk signals'
    detailsPanel.appendChild(title)
    if (!reasons.length) {
      const empty = document.createElement('div')
      empty.style.cssText = 'color:#9B9A97;font-size:12px'
      empty.textContent = 'No signals available yet — try again in a few seconds.'
      detailsPanel.appendChild(empty)
    } else {
      reasons.forEach((r) => {
        const row = document.createElement('div')
        const dot = r.severity === 'flag' ? '#C93434'
          : r.severity === 'warn' ? '#E09416'
          : '#9B9A97'
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;font-size:12px'
        row.innerHTML = `<span style="display:inline-block;width:6px;height:6px;margin-top:6px;border-radius:999px;background:${dot};flex:0 0 auto"></span><span>${escapeHtml(r.label)}</span>`
        detailsPanel.appendChild(row)
      })
    }
    const attribution = document.createElement('div')
    attribution.style.cssText = 'margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,0.06);font-size:10px;color:#9B9A97'
    attribution.textContent = 'Faivri Pro — hybrid Tavily + Firecrawl'
    detailsPanel.appendChild(attribution)
    document.body.appendChild(detailsPanel)
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>\"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c])
  }

  async function fetchRisk() {
    const platform = inferPlatform()
    if (!platform) return
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return

    const payload = {
      listing_url: window.location.href,
      platform,
    }
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'FAIVRI_SELLER_RISK', payload },
          (reply) => resolve(reply),
        )
      })
      if (!res || !res.ok) return
      const body = res.body
      if (!body || typeof body.score !== 'number') return
      renderBadge(body)
    } catch (err) {
      // Silent fail — Basic overlay still works.
    }
  }

  function maybeRun() {
    const key = listingKey()
    if (key === lastListingKey) return
    lastListingKey = key
    if (badge) badge.style.display = 'none'
    // Small delay so the extract-ebay / extract-marketplace script has time
    // to settle the DOM before we kick off the seller lookup.
    setTimeout(fetchRisk, 800)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeRun)
  } else {
    maybeRun()
  }

  // SPA navigation hook (same pattern as overlay.js).
  let lastUrl = window.location.href
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      maybeRun()
    }
  })
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
})()
