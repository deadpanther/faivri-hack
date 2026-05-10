"""Legal domain — US market context."""


def get_legal_context(country: str = "US") -> str:
    """Return domain-specific context for legal fee analysis."""
    return """US LEGAL CONTEXT:
- Attorney fees vary by practice area and region.
- Hourly rates: $150-500/hour (varies by city and experience).
- Contingency fees (personal injury): typically 33-40% of settlement.
- Flat fees common for: immigration ($1,500-5,000), divorce ($3,000-10,000),
  bankruptcy ($1,500-3,000), simple will ($500-1,500).
- Avvo and LegalMatch provide attorney fee ranges by practice area and location.
- Common overcharges: excessive billing increments (billing 0.5hr for a 5-min email),
  associate time billed at partner rates, unnecessary motion filings, vague retainer terms.
- Free legal aid: Legal Aid Society, pro bono programs through state bar.
- Small claims court: $30-75 filing fee, no lawyer needed for claims under $5K-10K.
- Currency: USD ($). All prices in cents."""
