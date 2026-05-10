// eBay extractor — prefers JSON-LD `Product` because it's maintained server-
// side and rarely breaks. Falls back to a DOM read of the #prcIsum price span
// if JSON-LD is missing on a weird listing variant.

;(function () {
  function readJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]')
    for (const s of scripts) {
      try {
        const parsed = JSON.parse(s.textContent || 'null')
        const candidates = Array.isArray(parsed) ? parsed : [parsed]
        for (const node of candidates) {
          if (!node || typeof node !== 'object') continue
          const t = node['@type']
          const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'))
          if (!isProduct) continue

          const offers = node.offers || {}
          const offer = Array.isArray(offers) ? offers[0] : offers
          const priceRaw = offer?.price ?? offer?.lowPrice
          const price = priceRaw !== undefined ? parseFloat(String(priceRaw).replace(/[^0-9.]/g, '')) : null
          return {
            title: String(node.name || '').trim() || null,
            price: isFinite(price) && price > 0 ? price : null,
            condition: offer?.itemCondition ? String(offer.itemCondition).split('/').pop() : null,
          }
        }
      } catch {
        // malformed JSON-LD — move on
      }
    }
    return null
  }

  function readDomFallback() {
    const title = (document.querySelector('h1[itemprop="name"], h1.x-item-title__mainTitle, h1.it-ttl') || {}).innerText
      || (document.querySelector('h1') || {}).innerText
    const priceNode = document.querySelector(
      'div[data-testid="x-price-primary"] span, .x-price-primary .ux-textspans, #prcIsum, span[itemprop="price"]'
    )
    const priceText = (priceNode || {}).innerText || ''
    const match = priceText.match(/\$\s*([\d,]+(?:\.\d+)?)/)
    const price = match ? parseFloat(match[1].replace(/,/g, '')) : null
    return {
      title: (title || '').trim() || null,
      price: isFinite(price) && price > 0 ? price : null,
      condition: null,
    }
  }

  window.__FAIVRI_IS_LISTING = function () {
    // eBay manifest already restricts us to /itm/ paths — we still check the
    // URL pattern so SPA navigations between item pages are handled.
    if (!/\/itm\//.test(window.location.pathname)) return false
    return Boolean(readJsonLd()?.title || readDomFallback().title)
  }

  window.__FAIVRI_EXTRACTOR = function () {
    const jsonLd = readJsonLd()
    const fallback = readDomFallback()
    const title = jsonLd?.title || fallback.title
    const price = jsonLd?.price || fallback.price
    const condition = jsonLd?.condition || null
    return {
      title,
      price,
      condition,
      platform: 'eBay',
    }
  }
})()
