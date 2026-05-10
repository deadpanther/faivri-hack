"""Car purchase intelligence — maintenance audit, cost projection, fair price."""

import asyncio
import re
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.intelligence.web_search import search_web
from app.intelligence.nhtsa import get_recalls, get_complaints
from app.intelligence.purchase_diligence import (
    DiligenceAnswers,
    compute_adjusted_pricing,
    compute_adjustments,
    compute_negotiation_script,
    compute_safety_advice,
    top_negotiation_levers,
)


KM_TO_MI = 0.621371

_KM_PATTERN = re.compile(
    r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?)\b",
    re.IGNORECASE,
)


def _convert_km_to_mi_in_text(text: str) -> str:
    """Replace 'NNN km' / 'NNN,NNN kilometers' with their mile equivalent.

    LLM output sometimes mentions kilometers even when the prompt asks for
    miles — this scrubs the surface text so US-facing UI never leaks km.
    Numbers are rounded to a clean integer (or to the nearest 1k for
    >=10,000 mi values, mirroring how odometers are read aloud).
    """
    if not isinstance(text, str) or not text:
        return text

    def _sub(match: re.Match) -> str:
        raw = match.group(1).replace(",", "")
        try:
            km = float(raw)
        except ValueError:
            return match.group(0)
        miles = km * KM_TO_MI
        if miles >= 10_000:
            rounded = int(round(miles / 1000.0)) * 1000
        elif miles >= 1_000:
            rounded = int(round(miles / 100.0)) * 100
        else:
            rounded = int(round(miles))
        return f"{rounded:,} mi"

    return _KM_PATTERN.sub(_sub, text)


def _convert_km_list(items: list) -> list:
    return [_convert_km_to_mi_in_text(x) if isinstance(x, str) else x for x in (items or [])]
from app.services.llm import _chat, _parse_json
from app.services.market import (
    ANNUAL_MILEAGE_KM,
    DEFAULT_COUNTRY,
    DEFAULT_CURRENCY,
    DEFAULT_CURRENCY_SYMBOL,
)
from app.routers.vehicles import MAINTENANCE_SCHEDULE


# Coarse 12-month maintenance bands (low_dollars, high_dollars, label). NOT
# live data — industry-average ranges by age + mileage band. Per-service
# Tavily lookups remain the right long-term solution; this gives users a
# directionally useful number labeled `is_estimate: true` so the UI is
# explicit about its provenance ("estimate, not live").
COARSE_MAINTENANCE_BANDS = [
    (400, 800, "newer car under 50k miles"),
    (700, 1_200, "4–9 yr / 50–100k mile car"),
    (1_200, 2_000, "10+ yr / 100k+ mile car"),
    (1_800, 2_800, "15+ yr / 150k+ mile car"),
    (2_200, 3_500, "20+ yr or 200k+ mile car"),
]

# Reliability factor by make. Honda/Toyota documented cheaper-to-own; German
# lux + Land Rover skew aggressively expensive. Default = 1.0.
RELIABILITY_FACTOR = {
    "honda": 0.85, "toyota": 0.85, "lexus": 0.90, "mazda": 0.90,
    "acura": 0.95, "scion": 0.85,
    "ford": 1.00, "chevrolet": 1.00, "gmc": 1.00,
    "hyundai": 0.95, "kia": 0.95,
    "nissan": 1.05, "infiniti": 1.10,
    "subaru": 1.05, "jeep": 1.15, "ram": 1.15, "dodge": 1.10,
    "volkswagen": 1.20, "volvo": 1.20, "mini": 1.25,
    "bmw": 1.40, "mercedes-benz": 1.45, "mercedes": 1.45, "audi": 1.40,
    "porsche": 1.60, "land rover": 1.70, "range rover": 1.70,
    "jaguar": 1.55, "cadillac": 1.20,
}


def coarse_annual_maintenance_band(year: int, mileage_km: int, make: str) -> dict:
    """Coarse 12-month maintenance estimate. Banded by age + mileage, then
    scaled by per-make reliability. Always flagged `is_estimate=True` in the
    response so the UI can render an honest "estimate, not live" label.
    """
    age = max(0, datetime.utcnow().year - int(year))
    mileage_miles = int(mileage_km / 1.609) if mileage_km else 0

    age_idx = 0
    if age >= 20:
        age_idx = 4
    elif age >= 15:
        age_idx = 3
    elif age >= 10:
        age_idx = 2
    elif age >= 4:
        age_idx = 1

    miles_idx = 0
    if mileage_miles >= 200_000:
        miles_idx = 4
    elif mileage_miles >= 150_000:
        miles_idx = 3
    elif mileage_miles >= 100_000:
        miles_idx = 2
    elif mileage_miles >= 50_000:
        miles_idx = 1

    idx = max(age_idx, miles_idx)
    low_d, high_d, label = COARSE_MAINTENANCE_BANDS[idx]

    factor = RELIABILITY_FACTOR.get((make or "").lower().strip(), 1.0)
    low_cents = int(low_d * factor) * 100
    high_cents = int(high_d * factor) * 100
    mid_cents = (low_cents + high_cents) // 2

    return {
        "low": low_cents,
        "high": high_cents,
        "total": mid_cents,
        "basis": label,
        "reliability_factor": round(factor, 2),
    }


async def analyze_purchase(
    db: AsyncSession,
    make: str,
    model: str,
    year: int,
    mileage_km: int,
    asking_price: int,
    city: str | None = None,
    country: str | None = None,
    provider: str | None = None,
    vin: str | None = None,
    diligence: dict | None = None,
) -> dict:
    """Full purchase intelligence analysis.

    Optional `vin` is included in the search query (to anchor on the exact
    listing/Carfax data when available). Optional `diligence` is a dict of
    buyer-supplied answers (service history, title, accidents, etc.); we
    parse it via DiligenceAnswers and apply deterministic price adjustments
    + safety advice on top of the LLM's baseline range. The frontend
    displays both the baseline and the adjusted figures so users can see
    what each diligence answer was worth.
    """

    country = DEFAULT_COUNTRY
    city = city or ""
    currency_symbol = DEFAULT_CURRENCY_SYMBOL
    diligence_obj = DiligenceAnswers.from_dict(diligence)

    # Step 1: Maintenance audit from schedule
    maintenance_audit = []
    for service_key, schedule in MAINTENANCE_SCHEDULE.items():
        interval = schedule["interval_km"]
        if interval == 0:
            continue
        intervals_passed = mileage_km // interval
        next_due = (intervals_passed + 1) * interval
        km_until = next_due - mileage_km
        status = "overdue" if km_until <= 0 else "upcoming" if km_until < 5000 else "ok"

        maintenance_audit.append({
            "service": service_key,
            "label": schedule["label"],
            "status": status,
            "due_at_km": next_due,
            "km_until_due": max(0, km_until),
            # Null until we wire per-service live pricing — don't fabricate.
            "estimated_cost": None,
        })

    maintenance_audit.sort(
        key=lambda x: (
            {"overdue": 0, "upcoming": 1, "ok": 2}[x["status"]],
            x["km_until_due"],
        )
    )

    # Step 2: Parallel data fetch. If we have a VIN, anchor the price search
    # on it — Tavily can pick up matching listings on AutoTrader/CarGurus.
    mileage_miles = int(mileage_km * KM_TO_MI) if mileage_km else 0
    price_query = f"{year} {make} {model} fair price {mileage_miles} miles"
    if vin:
        price_query = f"VIN {vin} {price_query}"
    tasks = [
        search_web(
            service=price_query,
            city=city, country=country, make=make, model=model, year=str(year),
        ),
        search_web(
            service=f"{make} {model} common problems issues reliability",
            city=city, country=country, make=make, model=model, year=str(year),
        ),
    ]
    tasks.append(get_recalls(make, model, year))
    tasks.append(get_complaints(make, model, year))

    price_results, issue_results, recalls, complaints = await asyncio.gather(*tasks)

    # Step 3: Which services are due in the next 12 months. Costs are
    # intentionally omitted here — we only ship the *schedule* (backed by
    # the per-make maintenance intervals), never a fabricated dollar figure.
    km_in_12_months = mileage_km + ANNUAL_MILEAGE_KM
    upcoming_services = [
        {"service": item["label"], "due_at_km": item["due_at_km"]}
        for item in maintenance_audit
        if item["due_at_km"] <= km_in_12_months
    ]

    # Step 4: LLM synthesis for fair price + red flags
    asking_display = asking_price / 100

    prompt = f"""You are Faivri, analyzing a used car purchase for a US consumer.

VEHICLE: {year} {make} {model}, {mileage_miles:,} miles
ASKING PRICE: {currency_symbol}{asking_display:,.0f}
LOCATION: {city or "United States"}

UPCOMING MAINTENANCE (based on mileage):
{_format_maintenance(maintenance_audit)}

WEB SEARCH — PRICING ({len(price_results)} results):
{chr(10).join(f"- {r['title']}: {r['content'][:300]}" for r in price_results[:6])}

WEB SEARCH — KNOWN ISSUES ({len(issue_results)} results):
{chr(10).join(f"- {r['title']}: {r['content'][:300]}" for r in issue_results[:6])}

{"NHTSA RECALLS: " + str(len(recalls)) + " active recall(s) found" if recalls else "NO active NHTSA recalls."}
{"NHTSA COMPLAINTS: " + str(len(complaints)) + " consumer complaint(s) on file" if complaints else ""}

Analyze whether {currency_symbol}{asking_display:,.0f} is fair for this specific vehicle. Use the web search data to determine real market prices — do NOT guess. If the web data shows comparable vehicles selling for less, flag it.

ALL distances and odometer references MUST use MILES, never kilometers. Do not write "km", "kilometers", or "kilometres" anywhere in your output. Service intervals: write "due at 250,000 mi", not "due at 400,000 km".

Return ONLY valid JSON with prices in CENTS (multiply dollar amounts by 100):
{{
  "asking_price_verdict": "fair|high|overcharge",
  "fair_price_low": int (in cents — e.g. $8000 = 800000),
  "fair_price_high": int (in cents),
  "overcharge_multiplier": float (asking / midpoint of fair range),
  "common_issues": ["specific issue for this make/model/year from the data — use miles, not km"],
  "red_flags": ["specific concern about THIS deal — use miles, not km"],
  "questions_for_seller": ["pointed question referencing specific data — use miles, not km"],
  "explanation": "2-3 sentences citing specific prices from the search results, using miles for distance"
}}"""

    text = await _chat(
        messages=[{"role": "user", "content": prompt}],
        provider=provider,
        model_tier="strong" if len(price_results) > 0 else "fast",
    )
    llm_result = _parse_json(text)

    # Step 5: Apply diligence-driven adjustments to the LLM's baseline range.
    # Adjustments are deterministic, transparent, and shown to the user line
    # by line so they can see "$1,200 off because timing belt overdue".
    baseline_low = int(llm_result.get("fair_price_low", 0) or 0)
    baseline_high = int(llm_result.get("fair_price_high", 0) or 0)
    adjustments = compute_adjustments(
        diligence=diligence_obj,
        asking_price_cents=asking_price,
        mileage_km=mileage_km,
    )
    # Compute coarse maintenance band first so the pricing engine can use it
    # as a min-discount floor. A $7k car with $2k upcoming maintenance should
    # target ≥ $1k below asking, not ~$500.
    _coarse_band = coarse_annual_maintenance_band(year, mileage_km, make)
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=baseline_low,
        baseline_high_cents=baseline_high,
        asking_price_cents=asking_price,
        adjustments=adjustments,
        maintenance_estimate_cents=_coarse_band["total"],
    )
    safety = compute_safety_advice(
        diligence=diligence_obj,
        asking_price_cents=asking_price,
        baseline_low_cents=baseline_low,
        baseline_high_cents=baseline_high,
    )
    leverage = top_negotiation_levers(adjustments, limit=3)
    negotiation_script = compute_negotiation_script(
        asking_price_cents=asking_price,
        target_offer_cents=adjusted.target_offer,
        opening_offer_cents=adjusted.opening_offer,
        walk_away_above_cents=adjusted.walk_away_above,
        leverage=leverage,
        currency_symbol=currency_symbol,
    )

    return {
        "vehicle": {
            "make": make, "model": model, "year": year,
            "mileage_km": mileage_km, "vin": vin,
        },
        "asking_price": asking_price,
        "asking_price_verdict": llm_result.get("asking_price_verdict", "high"),
        "fair_price_range": {
            "low": llm_result.get("fair_price_low", 0),
            "high": llm_result.get("fair_price_high", 0),
        },
        "adjusted_pricing": {
            "baseline_low": adjusted.baseline_low,
            "baseline_high": adjusted.baseline_high,
            "adjustment_total": adjusted.adjustment_total,
            "adjusted_low": adjusted.adjusted_low,
            "adjusted_mid": adjusted.adjusted_mid,
            "adjusted_high": adjusted.adjusted_high,
            "target_offer": adjusted.target_offer,
            "opening_offer": adjusted.opening_offer,
            "walk_away_above": adjusted.walk_away_above,
            "overpay_amount": adjusted.overpay_amount,
            "asking_vs_baseline_pct": round(adjusted.asking_vs_baseline_pct, 3),
        },
        "adjustments": [
            {
                "kind": a.kind,
                "label": a.label,
                "cents": a.cents,
                "reason": a.reason,
                "category": a.category,
            }
            for a in adjustments
        ],
        "safety_advice": {
            "universal_tips": safety.universal,
            "contextual_tips": safety.contextual,
            "scam_red_flags": safety.scam_red_flags,
        },
        "negotiation_leverage": leverage,
        "negotiation_script": negotiation_script,
        "diligence_provided": diligence_obj.to_dict(),
        "overcharge_multiplier": llm_result.get("overcharge_multiplier", 1.0),
        "maintenance_audit": maintenance_audit,
        "cost_projection_12mo": {
            # Coarse band, not per-service live pricing. `is_estimate: True`
            # tells the UI to label it "estimate, not live" so we never
            # imply this came from real-time market data.
            "available": True,
            "is_estimate": True,
            "estimate_low": _coarse_band["low"],
            "estimate_high": _coarse_band["high"],
            "total": _coarse_band["total"],
            "basis": _coarse_band["basis"],
            "reliability_factor": _coarse_band["reliability_factor"],
            "upcoming_services": upcoming_services,
        },
        "true_cost_of_ownership": asking_price + _coarse_band["total"],
        "recalls": recalls,
        "complaints_summary": complaints[:5] if complaints else [],
        "common_issues": _convert_km_list(llm_result.get("common_issues", [])),
        "red_flags": _convert_km_list(llm_result.get("red_flags", [])),
        "questions_for_seller": _convert_km_list(llm_result.get("questions_for_seller", [])),
        "explanation": _convert_km_to_mi_in_text(llm_result.get("explanation", "")),
        "currency": DEFAULT_CURRENCY,
        "freshness": {
            "source": "live",
            "web_results_count": len(price_results) + len(issue_results),
            "live_search": True,
            "fetched_at": datetime.utcnow().isoformat(),
        },
    }


def _format_maintenance(audit: list) -> str:
    """Format maintenance audit for LLM prompt.

    Cost estimates are omitted intentionally (LIVE-P0-02): the LLM should
    synthesize cost advice from the retrieved web results or not at all,
    rather than anchoring on the old hardcoded national averages.
    """
    lines = []
    for item in audit:
        if item["status"] == "overdue":
            status_indicator = "[OVERDUE]"
        elif item["status"] == "upcoming":
            status_indicator = "[UPCOMING]"
        else:
            status_indicator = "[OK]"
        lines.append(
            f"{status_indicator} {item['label']}: {item['status']} "
            f"(due at {item['due_at_km']:,}km)"
        )
    return "\n".join(lines)
