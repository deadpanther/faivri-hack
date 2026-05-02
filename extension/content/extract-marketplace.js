// Facebook Marketplace extractor.
//
// Meta actively randomizes class names and ships DOM changes every few weeks,
// so we lean on the few surfaces that cannot be obfuscated: <h1>, <title>,
// og:title / og:price meta tags, URL path, and regex over the main-content
// dollar amounts. If we can't confirm we're on a listing (item page OR the
// modal listing overlay), the pill stays hidden — much better than a pill
// that appears everywhere on Marketplace including the feed.
//
// `window.__FAIVRI_IS_LISTING()` answers whether we're on a listing right
// now, and `window.__FAIVRI_EXTRACTOR()` returns the scraped fields.

;(function () {
  function isItemUrl(url = window.location.href) {
    return /\/marketplace\/item\/\d+/.test(url)
  }

  function readMetaContent(property) {
    const el = document.querySelector(
      `meta[property="${property}"], meta[name="${property}"]`,
    )
    return el?.getAttribute('content') || null
  }

  function readTitle() {
    // 1. OpenGraph — FB sets og:title on Marketplace item SSR responses.
    const og = readMetaContent('og:title')
    if (og && og.length > 4) return og.trim()

    // 2. First visible <h1> inside the main role. Marketplace modal listing
    //    overlays still use a single <h1> for the item title.
    const main = document.querySelector('[role="main"]') || document.body
    const h1 = main.querySelector('h1')
    const h1Text = h1?.innerText?.trim() || ''
    if (h1Text && h1Text.length > 4 && h1Text.length < 200) return h1Text

    // 3. Document title, stripped of FB suffixes.
    const docTitle = (document.title || '').trim()
    return docTitle
      .replace(/\s*\|\s*Facebook.*$/i, '')
      .replace(/^Marketplace\s*[-–—]\s*/i, '')
      .replace(/\s*-\s*Facebook.*$/i, '')
      .trim() || null
  }

  function readPrice() {
    // 1. og:price meta — rare but present on some listings.
    const ogPrice = readMetaContent('og:price:amount') || readMetaContent('product:price:amount')
    if (ogPrice) {
      const n = parseFloat(String(ogPrice).replace(/[^0-9.]/g, ''))
      if (isFinite(n) && n > 0) return n
    }

    // 2. Regex over main content — first plausible dollar amount wins. We
    //    prefer the FIRST match (reading order) over max because FB often
    //    shows huge unrelated numbers (follower counts, post IDs).
    const main = document.querySelector('[role="main"]') || document.body
    const text = main.innerText || ''
    const matches = [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g)]
    for (const m of matches) {
      const n = parseFloat(m[1].replace(/,/g, ''))
      if (isFinite(n) && n >= 1 && n <= 10_000_000) return n
    }
    return null
  }

  function readCondition() {
    const text = (document.body.innerText || '').slice(0, 4000)
    const m = text.match(/\bCondition[:\s]+([A-Za-z][A-Za-z\s\-]{2,40})/i)
    return m ? m[1].trim() : null
  }

  // Item detection — we report "listing" when either (a) the URL matches
  // /marketplace/item/ID, or (b) the URL is a Marketplace path AND the DOM
  // currently contains a visible H1 + a price under a [role="main"] / a
  // dialog surface (the modal overlay case).
  function isListingDomReady() {
    if (isItemUrl()) {
      // URL matches — just make sure we actually have a title extractable.
      return Boolean(readTitle())
    }
    // Modal overlay path: URL stays on /marketplace/category/... while a
    // dialog shows the item. Guard behind both presence of H1 and a $price
    // inside a dialog role so we don't fire on the feed.
    const dialog = document.querySelector('[role="dialog"]')
    if (!dialog) return false
    const h1 = dialog.querySelector('h1')
    const dialogText = dialog.innerText || ''
    return Boolean(h1 && /\$\s?\d/.test(dialogText))
  }

  window.__FAIVRI_IS_LISTING = isListingDomReady
  window.__FAIVRI_EXTRACTOR = function () {
    return {
      title: readTitle(),
      price: readPrice(),
      condition: readCondition(),
      platform: 'Facebook Marketplace',
    }
  }
})()
