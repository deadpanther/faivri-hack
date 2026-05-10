"""Recommendation engine — rule-based + LLM hybrid next-step suggestions."""

from app.services.llm import _chat, _parse_json


# Static rules by domain — guaranteed instant recommendations
DOMAIN_RULES: dict[str, list[dict]] = {
    "auto": [
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Get 2 More Quotes",
            "description": "Visit two independent shops and ask for written estimates. Mention the specific job — don't show your current quote.",
            "icon": "clipboard",
        },
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Check RepairPal Estimates",
            "description": "RepairPal.com gives certified fair price ranges by zip code for most common repairs.",
            "icon": "search",
        },
        {
            "condition": "any",
            "category": "immediate",
            "title": "Ask About Parts",
            "description": "Request OEM vs aftermarket pricing. Aftermarket parts can save 30-50% with identical performance.",
            "icon": "tool",
        },
        {
            "condition": "any",
            "category": "preventive",
            "title": "Follow Maintenance Schedule",
            "description": "Sticking to manufacturer intervals prevents emergency repairs that cost 2-3x more.",
            "icon": "calendar",
        },
        {
            "condition": "any",
            "category": "alternative",
            "title": "Try Independent Shops",
            "description": "Independent mechanics charge 30-60% less than dealerships for the same work.",
            "icon": "store",
        },
    ],
    "medical": [
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Check GoodRx Prices",
            "description": "GoodRx.com shows cash prices across nearby pharmacies — often cheaper than insurance copay.",
            "icon": "search",
        },
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Ask for Generic",
            "description": "Ask your doctor or pharmacist about generic alternatives. Same active ingredient, 30-80% cheaper.",
            "icon": "pill",
        },
        {
            "condition": "any",
            "category": "immediate",
            "title": "Request Itemized Bill",
            "description": "Hospitals are required to provide itemized bills. Review each charge — billing errors are common.",
            "icon": "clipboard",
        },
        {
            "condition": "any",
            "category": "alternative",
            "title": "Try CostPlusDrugs",
            "description": "Mark Cuban's CostPlusDrugs.com sells medications at cost + 15% markup + $5 shipping.",
            "icon": "store",
        },
        {
            "condition": "any",
            "category": "preventive",
            "title": "Compare Pharmacy Prices",
            "description": "The same drug can cost 5x more at one pharmacy vs another. Always price-shop prescriptions.",
            "icon": "chart",
        },
    ],
    "home": [
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Get 3 Written Quotes",
            "description": "Never accept a single quote. Get at least 3 written estimates with itemized material vs labor breakdown.",
            "icon": "clipboard",
        },
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Check HomeAdvisor Costs",
            "description": "HomeAdvisor and Angi provide local cost estimates by zip code for most home services.",
            "icon": "search",
        },
        {
            "condition": "any",
            "category": "immediate",
            "title": "Verify Contractor License",
            "description": "Check your state's licensing board. Unlicensed contractors often overcharge and lack accountability.",
            "icon": "shield",
        },
        {
            "condition": "any",
            "category": "preventive",
            "title": "Price Materials Yourself",
            "description": "Check Home Depot and Lowe's for material costs. A fair markup is 15-25% over retail.",
            "icon": "tool",
        },
        {
            "condition": "any",
            "category": "alternative",
            "title": "Try Task-Based Platforms",
            "description": "Platforms like Thumbtack and TaskRabbit let you compare bids from multiple contractors instantly.",
            "icon": "store",
        },
    ],
    "legal": [
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Ask for Flat Fee",
            "description": "For routine matters, ask if the attorney offers a flat fee instead of hourly billing.",
            "icon": "dollar",
        },
        {
            "condition": "overcharge",
            "category": "immediate",
            "title": "Check Avvo Fee Guide",
            "description": "Avvo.com shows attorney fee ranges by practice area and location.",
            "icon": "search",
        },
        {
            "condition": "any",
            "category": "immediate",
            "title": "Review Billing Increments",
            "description": "Ask about billing increments. Some firms bill in 6-minute increments; others round up to 15 or 30 minutes.",
            "icon": "clock",
        },
        {
            "condition": "any",
            "category": "alternative",
            "title": "Check Legal Aid Options",
            "description": "Legal Aid Society and state bar pro bono programs offer free help for qualifying cases.",
            "icon": "shield",
        },
        {
            "condition": "any",
            "category": "preventive",
            "title": "Consider Small Claims Court",
            "description": "For disputes under $5K-10K (varies by state), small claims court costs $30-75 and needs no lawyer.",
            "icon": "scale",
        },
    ],
}


def get_static_recommendations(domain: str, verdict: str) -> list[dict]:
    """Get rule-based recommendations filtered by verdict severity."""
    rules = DOMAIN_RULES.get(domain, DOMAIN_RULES["auto"])
    results = []
    for rule in rules:
        if rule["condition"] == "any" or rule["condition"] == verdict:
            results.append({
                "title": rule["title"],
                "description": rule["description"],
                "category": rule["category"],
                "icon": rule["icon"],
            })
    return results


DOMAIN_TOOLS = {
    "auto": ["RepairPal.com (free zip code estimates)", "KBB.com (fair repair ranges)", "AutoMD.com (second opinions)"],
    "medical": ["GoodRx.com (drug price comparison)", "CostPlusDrugs.com (cost + 15%)", "FAIR Health Consumer (procedure costs)"],
    "home": ["HomeAdvisor.com (local cost guides)", "Angi.com (contractor reviews)", "Thumbtack.com (competing bids)"],
    "legal": ["Avvo.com (attorney fee ranges)", "LegalMatch.com (fee comparisons)", "your state bar's fee arbitration program"],
}


async def get_llm_recommendations(
    query_text: str,
    domain: str,
    verdict: str,
    multiplier: float,
    fair_low: int,
    fair_high: int,
    quoted_price: int | None,
    explanation: str,
    red_flags: list[str],
    provider: str | None = None,
) -> list[dict]:
    """Generate context-aware recommendations via LLM."""
    fair_low_display = fair_low / 100
    fair_high_display = fair_high / 100
    quoted_display = (quoted_price / 100) if quoted_price else None
    fair_mid = (fair_low_display + fair_high_display) / 2

    overpay_amount = (quoted_display - fair_high_display) if quoted_display and fair_high_display else 0
    annual_risk = overpay_amount * 4 if overpay_amount > 0 else 0

    tools = DOMAIN_TOOLS.get(domain, DOMAIN_TOOLS["auto"])

    prompt = f"""You are a consumer protection expert who just reviewed someone's quote.
You're genuinely outraged on their behalf and want to arm them with the 3 most impactful
actions they can take RIGHT NOW.

=== THE SITUATION ===
- Service: {query_text}
- Domain: {domain}
- Verdict: {verdict} — being charged {multiplier:.1f}x the fair market price
- Fair range: ${fair_low_display:,.0f} – ${fair_high_display:,.0f} (market midpoint: ${fair_mid:,.0f})
{f"- Quoted: ${quoted_display:,.0f} — OVERPAYING ${overpay_amount:,.0f} on this single transaction" if quoted_display and overpay_amount > 0 else f"- Quoted: ${quoted_display:,.0f}" if quoted_display else "- No specific quote provided"}
{f"- At this rate, they'd waste ~${annual_risk:,.0f}/year on similar overcharges" if annual_risk > 0 else ""}
- Analysis: {explanation}
- Red flags: {red_flags}

=== TOOLS THE USER SHOULD KNOW ABOUT ===
{chr(10).join(f"- {t}" for t in tools)}

Return ONLY valid JSON — an array of exactly 3 objects:
[
  {{
    "title": "punchy action title (5-8 words, start with a VERB — Save, Get, Check, Compare, Demand)",
    "description": "2 sentences max. MUST include specific $ amounts from this analysis. First sentence = the action. Second sentence = the payoff ('This alone could save you $X').",
    "category": "immediate|alternative|preventive|community",
    "icon": "clipboard|search|tool|store|shield|calendar|chart|dollar|clock|scale|pill|alert"
  }}
]

=== RULES ===
1. FIRST recommendation = highest-ROI action. For overcharge: "Get 2 competing quotes at ${fair_low_display:,.0f}–${fair_high_display:,.0f}". For fair: "Lock in this price in writing."
2. EVERY recommendation MUST contain a SPECIFIC dollar amount from the analysis — "${fair_mid:,.0f}" not "a fair price".
3. ONE recommendation MUST name a specific free tool from the list above with a concrete instruction ("Check RepairPal.com for your zip code — it'll show the ${fair_low_display:,.0f}–${fair_high_display:,.0f} range").
4. Write like a sharp friend texting them advice, not a corporate FAQ. Short sentences. No filler.
5. For "fair" verdicts: focus on locking the price, getting warranty, and preventive tips.
6. For "overcharge" verdicts: focus on urgency — they are losing real money right now."""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="fast",
        max_tokens=800,
    )
    result = _parse_json(text)
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and not result.get("_parse_error"):
        return result.get("recommendations", [])
    return []


async def get_recommendations(
    query_text: str,
    domain: str,
    verdict: str,
    multiplier: float,
    fair_low: int,
    fair_high: int,
    quoted_price: int | None = None,
    explanation: str = "",
    red_flags: list[str] | None = None,
    provider: str | None = None,
) -> dict:
    """Get combined static + LLM recommendations."""
    static = get_static_recommendations(domain, verdict)

    try:
        personalized = await get_llm_recommendations(
            query_text=query_text,
            domain=domain,
            verdict=verdict,
            multiplier=multiplier,
            fair_low=fair_low,
            fair_high=fair_high,
            quoted_price=quoted_price,
            explanation=explanation,
            red_flags=red_flags or [],
            provider=provider,
        )
    except Exception:
        personalized = []

    return {
        "personalized": personalized[:3],
        "general": static[:5],
    }
