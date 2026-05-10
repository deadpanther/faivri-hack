"""Single source of truth for FairCheck's market contract (INT-P1-02, LIVE-P1-08).

FairCheck is US-only. Before this module, the string `"US"`, the string `"USD"`,
the symbol `"$"`, and the 15,000 km/year assumption were each duplicated across
orchestrators, analyzers, routers, and history views. They drifted. A verdict
could be persisted with `currency="USD"` while the savings summary hardcoded
`"USD"` separately and the purchase projection silently used a different annual
mileage figure.

Centralizing here means:

1. Every market assumption lives in one place. Adding a second market (if we
   ever do) is a single-file contract change, not a grep-and-pray refactor.
2. `enforce_supported_country()` is the *only* way input lands in the pipeline.
   It raises a `ValueError` on unsupported inputs that the router converts to
   HTTP 400 — so non-US queries never silently get processed against US prices.
3. No currency mapping ambiguity. `currency_for_country("US")` is the one
   function that decides what currency tag goes on a verdict.
"""

SUPPORTED_COUNTRIES = ("US",)
DEFAULT_COUNTRY = "US"
DEFAULT_CURRENCY = "USD"
DEFAULT_CURRENCY_SYMBOL = "$"

# Annual mileage assumption for maintenance projections. US average per FHWA.
ANNUAL_MILEAGE_KM = 15000

_CURRENCY_BY_COUNTRY = {
    "US": "USD",
}

_CURRENCY_SYMBOL = {
    "USD": "$",
}


def normalize_country(raw: str | None) -> str:
    """Uppercase + strip. Returns the default country for empty input."""
    if raw is None:
        return DEFAULT_COUNTRY
    cleaned = raw.strip().upper()
    return cleaned or DEFAULT_COUNTRY


def is_supported_country(raw: str | None) -> bool:
    return normalize_country(raw) in SUPPORTED_COUNTRIES


def enforce_supported_country(raw: str | None) -> str:
    """Raise ValueError on unsupported country; return the normalized code.

    Routers catch ValueError and translate to HTTP 400. This is the only
    sanctioned path for untrusted country input to enter the pipeline.
    """
    country = normalize_country(raw)
    if country not in SUPPORTED_COUNTRIES:
        raise ValueError(
            f"Faivri currently supports {', '.join(SUPPORTED_COUNTRIES)} only. "
            f"Country '{raw}' is not supported."
        )
    return country


def currency_for_country(country: str | None) -> str:
    """Map country to currency. Falls back to default rather than raising
    because several call sites hand us already-validated country codes and
    we don't want to double-validate."""
    return _CURRENCY_BY_COUNTRY.get(normalize_country(country), DEFAULT_CURRENCY)


def symbol_for_currency(currency: str | None) -> str:
    if not currency:
        return DEFAULT_CURRENCY_SYMBOL
    return _CURRENCY_SYMBOL.get(currency.upper(), DEFAULT_CURRENCY_SYMBOL)
