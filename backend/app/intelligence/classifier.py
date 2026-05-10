"""
Step 1: Classify user query using Claude Haiku.
Extracts domain, service, make/model, city, country, price, currency.
"""

from app.services.llm import classify_query


async def classify(query: str, city: str | None = None, country: str | None = None, provider: str | None = None) -> dict:
    """Classify a user query into structured fields.

    If city/country are already provided by the frontend, they override LLM extraction.
    """
    result = await classify_query(query, provider=provider)

    # Frontend-provided values take priority
    if city:
        result["city"] = city
    if country:
        result["country"] = country

    # Ensure required fields have defaults
    result.setdefault("domain", "auto")
    result.setdefault("service", "general repair")
    result.setdefault("currency", "USD")
    result.setdefault("make", None)
    result.setdefault("model", None)
    result.setdefault("year", None)
    result.setdefault("quoted_price", None)

    return result
