"""Auto repair domain — US market context and prompt templates."""


def get_auto_context(country: str = "US") -> str:
    """Return domain-specific context for auto repair analysis."""
    return """US AUTO REPAIR CONTEXT:
- OEM parts cost 1.5-2.5x more than aftermarket. Always distinguish.
- Labor rates vary by region: NYC/LA highest ($120-180/hr), Midwest/South moderate ($80-120/hr).
- Dealerships charge 30-60% more than independent shops for identical work.
- Common scams: recommending full replacement over cheaper repair/resurfacing,
  charging for "diagnostic fees" then padding the repair bill, unnecessary fluid flushes.
- Typical labor rate: $80-120/hour independent, $120-180/hour dealership.
- Currency: USD ($). All prices in cents (1 USD = 100 cents).
- Popular makes: Honda, Toyota, Ford, Chevrolet, Nissan, Hyundai.
- RepairPal and KBB are trusted pricing references."""
