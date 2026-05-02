"""Narrative-only synthesis.

The LLM is NOT the source of truth for prices anymore. Prices come from
`intelligence.evidence.compute_fair_range` which runs on structured
ExtractedPrice records. The LLM's only job here is to translate those numbers
into consumer-friendly explanation + red_flags + questions.

If the LLM fails, we return deterministic fallback copy so the user still gets
a usable verdict — silently degrading narrative quality, never prices.
"""

from app.services.llm import synthesize_explanation
from app.domains.auto import get_auto_context
from app.domains.medical import get_medical_context
from app.domains.home import get_home_context
from app.domains.legal import get_legal_context
from app.domains.retail import get_retail_context


DOMAIN_CONTEXT_FN = {
    "auto": get_auto_context,
    "medical": get_medical_context,
    "home": get_home_context,
    "legal": get_legal_context,
    "retail": get_retail_context,
}


async def narrate_verdict(
    query: str,
    classification: dict,
    fair_range: dict,
    verdict_math: dict,
    evidence_sources: list[dict],
    provider: str | None = None,
) -> dict:
    """Generate explanation, red_flags, questions_to_ask for a computed verdict.

    All price fields come from `verdict_math` / `fair_range` unchanged — this
    function never modifies them. Returns a dict with narrative fields only.
    """
    domain = classification.get("domain", "auto")
    country = classification.get("country") or "US"

    context_fn = DOMAIN_CONTEXT_FN.get(domain)
    domain_context = context_fn(country) if context_fn else ""

    return await synthesize_explanation(
        query=query,
        classification=classification,
        fair_range=fair_range,
        verdict_math=verdict_math,
        evidence_sources=evidence_sources,
        domain_context=domain_context,
        provider=provider,
    )
