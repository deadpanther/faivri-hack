"""Medical / Prescription domain — US market context."""


def get_medical_context(country: str = "US") -> str:
    """Return domain-specific context for medical/prescription analysis."""
    return """US MEDICAL/PRESCRIPTION CONTEXT:
- GoodRx is the standard reference for prescription drug pricing.
- Generic drugs are 30-80% cheaper than brand-name equivalents.
- Prices vary massively by pharmacy: same drug can cost 5x more at CVS vs Costco.
- Insurance copay vs cash price: sometimes cash price (with GoodRx) is cheaper than copay.
- Common overcharges: facility fees at hospital-owned clinics, balance billing from
  out-of-network providers, unnecessary imaging/lab orders, brand-name when generic available.
- Medicare fee schedule is a good benchmark for procedure costs.
- Telehealth visits are typically $50-100 cheaper than in-person.
- Dental: prices vary widely. Check FAIR Health consumer database.
- Currency: USD ($). All prices in cents (1 USD = 100 cents).
- Check GoodRx.com and CostPlusDrugs.com for competitive prices."""
