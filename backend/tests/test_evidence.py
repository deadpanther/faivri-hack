"""Smoke tests for the deterministic evidence pipeline.

No network, no DB, no LLM. Just feeds Tavily-shaped dicts through the
extraction + range + verdict math and asserts the math stays honest.
"""

import pytest

from app.intelligence.evidence import (
    DEGRADED_CONFIDENCE_CAP,
    MIN_TRUSTED_DOMAINS,
    PriceType,
    compute_fair_range,
    compute_verdict_math,
    extract_price_candidates,
    extract_prices_from_results,
)


# ─── extract_price_candidates ─────────────────────────────────────────────────

def test_extracts_plain_dollar():
    out = extract_price_candidates("Brake pad replacement costs about $325 in most shops.", "auto")
    cents = [c for c, *_ in out]
    assert 32500 in cents


def test_extracts_thousands_separator():
    out = extract_price_candidates("Transmission rebuild averages $2,450 nationally.", "auto")
    cents = [c for c, *_ in out]
    assert 245000 in cents


def test_extracts_range_both_ends():
    out = extract_price_candidates("Oil change ranges from $45 to $85 depending on type.", "auto")
    cents = sorted({c for c, *_ in out})
    assert 4500 in cents and 8500 in cents


def test_extracts_unicode_dash_range():
    out = extract_price_candidates("Typical labor $120\u2013$180 per hour.", "auto")
    cents = sorted({c for c, *_ in out})
    assert 12000 in cents and 18000 in cents


def test_rejects_under_min_threshold():
    # Sales tax of $0.05 should not pollute evidence.
    out = extract_price_candidates("Sales tax adds $0.05 per line item.", "auto")
    assert out == []


def test_classifies_hourly():
    out = extract_price_candidates("Mechanic labor rate is $125 per hour in Austin.", "auto")
    assert any(ptype == PriceType.HOURLY for _, ptype, _ in out)


def test_classifies_labor():
    out = extract_price_candidates("Labor charge is $400 for this job.", "auto")
    assert any(ptype == PriceType.LABOR for _, ptype, _ in out)


# ─── extract_prices_from_results ──────────────────────────────────────────────

def _result(url: str, title: str, content: str) -> dict:
    return {"url": url, "title": title, "content": content}


def test_flags_local_when_city_matches():
    results = [
        _result(
            "https://repairpal.com/austin-brake-pad",
            "Brake pad cost in Austin, TX",
            "Austin shops typically charge $350 for brake pads.",
        ),
    ]
    prices = extract_prices_from_results(
        results, target_city="Austin", target_state="TX", domain_label="auto"
    )
    assert len(prices) == 1
    assert prices[0].is_local is True
    assert prices[0].domain_root == "repairpal.com"


def test_unknown_domain_gets_low_trust():
    results = [
        _result(
            "https://random-blog.example/post",
            "Random post",
            "I paid about $400 for brake pads.",
        ),
    ]
    prices = extract_prices_from_results(
        results, target_city=None, target_state=None, domain_label="auto"
    )
    assert len(prices) == 1
    assert 0 < prices[0].trust_weight < 0.3


# ─── compute_fair_range ───────────────────────────────────────────────────────

def _seeded_auto_results() -> list[dict]:
    """Five trusted-auto-source results with clustered prices around $300–$420."""
    return [
        _result(
            "https://repairpal.com/brake-pad-austin",
            "Brake pad replacement cost",
            "Brake pad replacement in Austin, TX averages $350. Labor around $120.",
        ),
        _result(
            "https://kbb.com/service/brakes",
            "KBB brake service estimator",
            "KBB estimates $300 to $420 for brake pad replacement on mid-size sedans.",
        ),
        _result(
            "https://edmunds.com/brake-cost",
            "What does a brake job cost",
            "Edmunds readers report paying $380 on average for brake pad replacement.",
        ),
        _result(
            "https://yourmechanic.com/brake-service",
            "Brake pad replacement quote",
            "YourMechanic prices brake pads at $320–$400 for most vehicles.",
        ),
        _result(
            "https://midas.com/services",
            "Midas brake service",
            "Brake pad replacement starts at $299 at Midas.",
        ),
    ]


def test_compute_fair_range_success():
    prices = extract_prices_from_results(
        _seeded_auto_results(),
        target_city="Austin",
        target_state="TX",
        domain_label="auto",
    )
    fr = compute_fair_range(prices)
    assert fr.distinct_trusted_domains >= MIN_TRUSTED_DOMAINS
    assert fr.fair_price_low <= fr.fair_price_mid <= fr.fair_price_high
    assert 20000 <= fr.fair_price_low <= fr.fair_price_high <= 60000
    assert fr.confidence_score > 0
    assert fr.sources, "evidence list must not be empty"


def test_compute_fair_range_rejects_thin_evidence():
    # Only one trusted domain → should raise. Floor is MIN_TRUSTED_DOMAINS (2).
    thin = [
        _result(
            "https://repairpal.com/x",
            "brake",
            "Brake service averages $350.",
        ),
    ]
    prices = extract_prices_from_results(
        thin, target_city=None, target_state=None, domain_label="auto"
    )
    with pytest.raises(ValueError):
        compute_fair_range(prices)


def test_compute_fair_range_degrades_with_one_trusted_and_consistent_tail():
    # 1 trusted citation + 4 consistent independent-shop blogs. Prices
    # cluster tightly, so the degraded path should produce a range with
    # confidence capped at DEGRADED_CONFIDENCE_CAP rather than hard-failing.
    results = [
        _result(
            "https://repairpal.com/oil-change",
            "Oil change cost",
            "Oil change typically runs $55.",
        ),
        _result(
            "https://mikes-auto-shop.example/prices",
            "Mike's oil change",
            "Our oil change is $60.",
        ),
        _result(
            "https://downtown-garage.example/services",
            "Downtown Garage",
            "Oil change is $58.",
        ),
        _result(
            "https://eastside-lube.example/menu",
            "Eastside Lube menu",
            "Synthetic oil change $65.",
        ),
        _result(
            "https://valley-auto.example/pricing",
            "Valley Auto pricing",
            "Oil change runs $62.",
        ),
    ]
    prices = extract_prices_from_results(
        results, target_city=None, target_state=None, domain_label="auto"
    )
    fr = compute_fair_range(prices)
    assert fr.distinct_trusted_domains == 1
    assert fr.confidence_score <= DEGRADED_CONFIDENCE_CAP
    assert fr.confidence_score > 0
    assert 5000 <= fr.fair_price_low <= fr.fair_price_high <= 7000


def test_compute_fair_range_still_rejects_scattered_non_trusted():
    # No trusted anchors and dispersion that survives IQR — degraded path
    # must refuse rather than fabricate a "fair range" out of garbage.
    # Threshold was raised to cv≤1.5 (from 0.9) to admit honest plumbing /
    # HVAC spreads, so this test uses 3 values (which skip stage-2 IQR) with
    # cv ≈ 1.55 to ensure the rail still bites on real garbage.
    results = [
        _result(
            "https://blog1.example/a",
            "blog 1",
            "I paid $20 for an oil change.",
        ),
        _result(
            "https://blog2.example/b",
            "blog 2",
            "Oil change was $300 at the dealer.",
        ),
        _result(
            "https://blog3.example/c",
            "blog 3",
            "Spent $5,000 on the most absurd oil change ever.",
        ),
    ]
    prices = extract_prices_from_results(
        results, target_city=None, target_state=None, domain_label="auto"
    )
    with pytest.raises(ValueError):
        compute_fair_range(prices)


def test_compute_fair_range_drops_extreme_outlier():
    poisoned = _seeded_auto_results() + [
        _result(
            "https://avvo.com/noise",
            "irrelevant",
            "Some unrelated service costs $50,000 in legal fees.",
        ),
    ]
    prices = extract_prices_from_results(
        poisoned, target_city="Austin", target_state="TX", domain_label="auto"
    )
    fr = compute_fair_range(prices)
    # $50k should not have dragged the high end above $10k
    assert fr.fair_price_high < 1_000_000


# ─── compute_verdict_math ─────────────────────────────────────────────────────

def test_verdict_fair_when_quote_inside_range():
    prices = extract_prices_from_results(
        _seeded_auto_results(),
        target_city="Austin",
        target_state="TX",
        domain_label="auto",
    )
    fr = compute_fair_range(prices)
    math = compute_verdict_math(fr, fr.fair_price_mid)
    assert math["verdict"] == "fair"
    assert math["conservative_overpay"] == 0
    assert math["expected_overpay"] == 0


def test_verdict_overcharge_when_quote_far_above():
    prices = extract_prices_from_results(
        _seeded_auto_results(),
        target_city="Austin",
        target_state="TX",
        domain_label="auto",
    )
    fr = compute_fair_range(prices)
    inflated = fr.fair_price_high * 3
    math = compute_verdict_math(fr, inflated)
    assert math["verdict"] == "overcharge"
    assert math["conservative_overpay"] == inflated - fr.fair_price_high
    assert math["expected_overpay"] == inflated - fr.fair_price_mid
    assert math["conservative_overpay"] <= math["expected_overpay"]


def test_verdict_no_quote_returns_range_without_overpay():
    prices = extract_prices_from_results(
        _seeded_auto_results(),
        target_city="Austin",
        target_state="TX",
        domain_label="auto",
    )
    fr = compute_fair_range(prices)
    math = compute_verdict_math(fr, None)
    assert math["conservative_overpay"] == 0
    assert math["expected_overpay"] == 0
    assert math["verdict"] == "fair"  # placeholder label
