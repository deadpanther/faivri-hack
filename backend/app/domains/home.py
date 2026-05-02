"""Home services / Contractor domain — US market context."""


def get_home_context(country: str = "US") -> str:
    """Return domain-specific context for home services analysis."""
    return """US HOME SERVICES/CONTRACTOR CONTEXT:
- Licensed contractors charge $50-150/hour depending on trade and region.
- Material costs: check Home Depot and Lowe's for baseline retail prices.
- HomeAdvisor and Angi provide cost estimates by zip code.
- Common overcharges: inflated material markup (>30% over retail), unnecessary
  permit fees, change orders that inflate scope, emergency/weekend surcharges
  applied to non-emergency work.
- Plumbing: $150-450 for common repairs. Full bathroom remodel $10K-30K.
- Electrical: $150-400 for common repairs. Panel upgrade $1,500-4,000.
- HVAC: $150-500 for repairs. Full system replacement $5,000-15,000.
- Roofing: $5-15/sqft depending on material. Full roof $8,000-25,000.
- Always get 3 quotes. Check contractor license on state licensing board.
- Currency: USD ($). All prices in cents."""
