"""Tests for the used-car diligence adjustment engine.

Pure-math tests — no DB, no LLM, no network. Verifies the deterministic
adjustment table maps diligence answers → price adjustments correctly,
and that safety advice always returns the universal-tips block.
"""

from app.intelligence.purchase_diligence import (
    DiligenceAnswers,
    UNIVERSAL_SAFETY_TIPS,
    compute_adjusted_pricing,
    compute_adjustments,
    compute_safety_advice,
    top_negotiation_levers,
)


# ─── DiligenceAnswers parsing ────────────────────────────────────────────────

def test_diligence_from_dict_filters_unknown_fields():
    d = DiligenceAnswers.from_dict({
        "title_status": "clean",
        "smoking_on_start": True,
        "evil_field": "should be dropped",
    })
    assert d.title_status == "clean"
    assert d.smoking_on_start is True


def test_diligence_from_dict_handles_none_input():
    d = DiligenceAnswers.from_dict(None)
    assert d.title_status is None
    assert d.smoking_on_start is None


# ─── Adjustments — penalties ─────────────────────────────────────────────────

def test_no_diligence_means_no_adjustments():
    d = DiligenceAnswers()
    assert compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=80_000) == []


def test_salvage_title_takes_30pct_penalty():
    d = DiligenceAnswers(title_status="salvage")
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=80_000)
    salvage = next(a for a in adjustments if a.label == "Salvage/lemon title")
    assert salvage.kind == "penalty"
    assert salvage.cents == -int(1_500_000 * 0.30)
    assert salvage.category == "title"


def test_major_accident_takes_15pct_penalty():
    d = DiligenceAnswers(accident_history="major")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=50_000)
    major = next(a for a in adjustments if a.label == "Major accident history")
    assert major.cents == -int(1_000_000 * 0.15)


def test_timing_belt_overdue_penalty():
    d = DiligenceAnswers(timing_belt_status="overdue")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=120_000)
    belt = next(a for a in adjustments if a.label == "Timing belt overdue")
    assert belt.cents == -100_000


def test_brake_pads_replacement_penalty():
    d = DiligenceAnswers(brake_pads_condition="needs_replacement")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=80_000)
    brake = next(a for a in adjustments if a.label == "Brake pads need replacement")
    assert brake.cents == -40_000


def test_tires_aged_out_penalty():
    d = DiligenceAnswers(tires_age_years=8)
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=80_000)
    tires = next(a for a in adjustments if "Tires aged" in a.label)
    assert tires.cents == -50_000


def test_smokes_on_start_takes_2k_penalty():
    d = DiligenceAnswers(smoking_on_start=True)
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=80_000)
    smoke = next(a for a in adjustments if a.label == "Smokes on cold start")
    assert smoke.cents == -200_000  # $2,000


def test_50k_service_deferred_when_no_records():
    d = DiligenceAnswers(has_service_records=False)
    # 100k km is over both 50k and 100k mile thresholds (in km: 80k and 160k).
    # 100k km is between → only 50k bundle should fire.
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=100_000)
    fifty_k = [a for a in adjustments if "50k-mile" in a.label]
    one_hundred_k = [a for a in adjustments if "100k-mile" in a.label]
    assert len(fifty_k) == 1
    assert len(one_hundred_k) == 0


def test_100k_service_deferred_when_no_records_and_no_belt():
    d = DiligenceAnswers(has_service_records=False)
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=180_000)
    one_hundred_k = next(a for a in adjustments if "100k-mile" in a.label)
    assert one_hundred_k.cents == -100_000


def test_recent_timing_belt_suppresses_100k_bundle():
    # If buyer confirms the timing belt was replaced, we shouldn't double-charge
    # the 100k bundle (which assumes it wasn't done).
    d = DiligenceAnswers(has_service_records=False, timing_belt_status="replaced")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=180_000)
    one_hundred_k = [a for a in adjustments if "100k-mile" in a.label]
    assert one_hundred_k == []


# ─── Adjustments — credits ───────────────────────────────────────────────────

def test_documented_oil_changes_credit():
    d = DiligenceAnswers(oil_change_history="regular", has_service_records=True)
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=80_000)
    oil = next(a for a in adjustments if a.label == "Documented regular oil changes")
    assert oil.kind == "credit"
    assert oil.cents == 50_000


def test_full_documentation_credit():
    d = DiligenceAnswers(has_carfax=True, has_service_records=True)
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=80_000)
    docs = next(a for a in adjustments if "Full documentation" in a.label)
    assert docs.kind == "credit"
    assert docs.cents == 30_000


def test_recent_timing_belt_credit():
    d = DiligenceAnswers(timing_belt_status="replaced")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=120_000)
    belt = next(a for a in adjustments if "replaced recently" in a.label)
    assert belt.kind == "credit"
    assert belt.cents == 80_000


# ─── compute_adjusted_pricing ────────────────────────────────────────────────

def test_adjusted_pricing_applies_penalty_total():
    d = DiligenceAnswers(timing_belt_status="overdue", brake_pads_condition="needs_replacement")
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=120_000)
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=1_400_000,
        baseline_high_cents=1_600_000,
        asking_price_cents=1_500_000,
        adjustments=adjustments,
    )
    assert adjusted.adjustment_total == -140_000  # belt -1k, brakes -400
    assert adjusted.adjusted_low == 1_400_000 - 140_000
    assert adjusted.adjusted_high == 1_600_000 - 140_000
    assert adjusted.adjusted_mid == (adjusted.adjusted_low + adjusted.adjusted_high) // 2


def test_adjusted_pricing_floors_at_zero():
    d = DiligenceAnswers(title_status="salvage")
    adjustments = compute_adjustments(d, asking_price_cents=1_000_000, mileage_km=80_000)
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=200_000,
        baseline_high_cents=300_000,
        asking_price_cents=1_000_000,
        adjustments=adjustments,
    )
    # 30% of $10k asking = $3k penalty, but baseline is only $2-3k → floor at 0
    assert adjusted.adjusted_low == 0
    assert adjusted.adjusted_high >= 0


def test_walk_away_is_5pct_above_adjusted_high():
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=1_000_000,
        baseline_high_cents=1_500_000,
        asking_price_cents=2_000_000,
        adjustments=[],
    )
    assert adjusted.walk_away_above == int(1_500_000 * 1.05)


def test_opening_offer_is_8pct_below_target():
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=1_000_000,
        baseline_high_cents=1_500_000,
        asking_price_cents=1_500_000,
        adjustments=[],
    )
    assert adjusted.target_offer == 1_250_000  # midpoint
    assert adjusted.opening_offer == int(1_250_000 * 0.92)


def test_overpay_amount_when_asking_above_adjusted_high():
    adjusted = compute_adjusted_pricing(
        baseline_low_cents=1_000_000,
        baseline_high_cents=1_500_000,
        asking_price_cents=2_000_000,
        adjustments=[],
    )
    assert adjusted.overpay_amount == 500_000


# ─── Safety advice ───────────────────────────────────────────────────────────

def test_universal_tips_always_returned():
    safety = compute_safety_advice(
        diligence=DiligenceAnswers(),
        asking_price_cents=1_500_000,
        baseline_low_cents=1_400_000,
        baseline_high_cents=1_600_000,
    )
    assert safety.universal == list(UNIVERSAL_SAFETY_TIPS)
    # Critical anti-scam tips must be present
    joined = " ".join(safety.universal).lower()
    assert "police" in joined or "public" in joined
    assert "vin" in joined
    assert "wire" in joined or "cashier" in joined


def test_too_good_to_be_true_price_triggers_red_flag():
    safety = compute_safety_advice(
        diligence=DiligenceAnswers(),
        asking_price_cents=500_000,  # $5k
        baseline_low_cents=1_400_000,  # baseline $14k
        baseline_high_cents=1_600_000,
    )
    joined = " ".join(safety.scam_red_flags).lower()
    assert "below" in joined  # both bands say "below" market


def test_salvage_title_adds_contextual_advice():
    safety = compute_safety_advice(
        diligence=DiligenceAnswers(title_status="salvage"),
        asking_price_cents=1_500_000,
        baseline_low_cents=1_400_000,
        baseline_high_cents=1_600_000,
    )
    contextual = " ".join(safety.contextual).lower()
    assert "insur" in contextual or "salvage" in contextual or "rebuilt" in contextual


def test_dealer_seller_gets_doc_fee_advice():
    safety = compute_safety_advice(
        diligence=DiligenceAnswers(seller_type="dealer"),
        asking_price_cents=1_500_000,
        baseline_low_cents=1_400_000,
        baseline_high_cents=1_600_000,
    )
    contextual = " ".join(safety.contextual).lower()
    assert "doc" in contextual and "fee" in contextual


# ─── Negotiation leverage ────────────────────────────────────────────────────

def test_top_levers_returns_penalties_only():
    d = DiligenceAnswers(
        timing_belt_status="overdue",
        brake_pads_condition="needs_replacement",
        oil_change_history="regular",
        has_service_records=True,  # this triggers a credit
    )
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=120_000)
    levers = top_negotiation_levers(adjustments, limit=3)
    assert all(lv["cents_impact"] < 0 for lv in levers)
    # Highest-impact penalty (timing belt -$1k) should be first
    assert levers[0]["label"] == "Timing belt overdue"


def test_top_levers_respects_limit():
    d = DiligenceAnswers(
        timing_belt_status="overdue",
        brake_pads_condition="needs_replacement",
        tires_condition="needs_replacement",
        smoking_on_start=True,
        burning_oil=True,
    )
    adjustments = compute_adjustments(d, asking_price_cents=1_500_000, mileage_km=120_000)
    levers = top_negotiation_levers(adjustments, limit=2)
    assert len(levers) == 2
