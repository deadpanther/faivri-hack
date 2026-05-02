"""Retail / marketplace domain — physical goods, big-box + online marketplaces.

Covers everyday consumer purchases: electronics (GPUs, laptops, TVs), appliances,
furniture, tools, toys, branded apparel — anything you'd price-check against
Amazon / Walmart / Costco / Best Buy / Target / Newegg, or compare against
recent Marketplace and eBay sold listings.
"""


def get_retail_context(country: str = "US") -> str:
    """Return domain-specific context for retail / marketplace analysis."""
    return """US RETAIL / MARKETPLACE CONTEXT:
- New vs used matters enormously. A GPU at $4,000 from a Marketplace seller
  should be benchmarked against eBay *sold* listings and Newegg/Amazon new
  prices, NOT just manufacturer MSRP.
- Trusted price references for NEW goods: Amazon, Walmart, Costco, Target,
  Best Buy, Newegg, Home Depot, Lowe's, B&H Photo (electronics), PCPartPicker
  (PC components), Apple, Samsung (first-party).
- Trusted price-history references: CamelCamelCamel (Amazon), Keepa (Amazon),
  PCPartPicker (components) — use these to catch fake discounts where a seller
  inflates "MSRP" vs. actual recent street price.
- Used-market references: eBay sold listings (not "active" listings — only
  completed sales reflect real demand), Facebook Marketplace, Craigslist,
  r/hardwareswap (for PC parts). Used prices run 50-70% of current new.
- Common scams on secondhand platforms: asking 20-40% over new retail for a
  used item ("I paid $X for it, so it's still worth $X"), counterfeit goods
  sold as "new in box" at a modest discount, swap-and-return (seller
  advertises flagship model, shows up with cheaper variant).
- Common scams on retail: phantom "original price" on clearance tags,
  bundle-only pricing that hides the item's actual standalone price, refurbs
  sold as new, off-brand lookalikes in the same category on sponsored search.
- Always check: (a) the exact model number / SKU, (b) recent sold price on
  eBay (not asking), (c) Amazon/Walmart/Newegg current new price if applicable.
- Currency: USD ($). All prices in cents."""
