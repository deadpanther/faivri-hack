# Faivri Browser Extension

Price-checks eBay and Facebook Marketplace listings against live market data
(Amazon, Walmart, Costco, Newegg, Best Buy, eBay sold listings) and drafts a
ready-to-paste negotiation script.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and choose this `extension/` folder.
4. Open any eBay item page (`/itm/…`) or Facebook Marketplace listing
   (`/marketplace/item/…`). A dark **Faivri** pill appears bottom-right —
   click it to analyze.

## Configure

Click the Faivri toolbar icon to open the popup and set a custom API URL
(defaults to `https://api.faivri.com`). Useful when running the backend
locally: set it to `http://localhost:8000` — note Chrome may block mixed
HTTPS/HTTP content on live sites, so local dev works best against
`http://localhost:*` itself.

## How it works

- `background.js` — MV3 service worker, the only script with cross-origin
  permission to reach the Faivri API. Content scripts forward requests via
  `chrome.runtime.sendMessage`.
- `content/overlay.js` — shared pill + verdict panel + script copy UI.
- `content/extract-ebay.js` — reads eBay's JSON-LD `Product` schema
  (stable) with a DOM fallback.
- `content/extract-marketplace.js` — reads Facebook Marketplace via
  `<h1>` + document title + regex over main-content price text.
  Marketplace DOM changes often; this extractor is intentionally
  minimal so it keeps working when class names mutate.

## Privacy

The extension only activates on eBay item pages and Facebook Marketplace
listing pages. On those pages it reads the listing title, price, and
condition, then sends that (plus the platform name) to the configured
Faivri API endpoint. No browsing history, no cookies, no PII.

## Known limits

- **FB Marketplace**: Meta periodically ships DOM changes that can break the
  price regex. If you see "Could not find a listing title", open the popup
  and file a report — the extractor is designed to be fixed with a one-line
  selector update.
- **Auto-messaging sellers**: not supported and not planned. eBay / Meta
  ToS prohibit automated messaging from an extension. Faivri copies the
  script to the clipboard and you paste it yourself.
