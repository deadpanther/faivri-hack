"""Smoke tests for deterministic negotiation anchors.

The router must compute `target_price` and `walk_away_above` in Python from
the fair range — the LLM never decides them. These tests lock the math and
the degenerate-input fallback so a future prompt tweak can't drift the
final numbers returned to users.
"""

from app.routers.negotiate import (
    NEGOTIATION_LISTING_HAIRCUT,
    NEGOTIATION_TARGET_MULTIPLIER,
    NEGOTIATION_WALKAWAY_MULTIPLIER,
    _compute_anchors,
)


def test_target_is_fair_low_times_multiplier():
    target, _ = _compute_anchors(30000, 50000)
    assert target == int(round(30000 * NEGOTIATION_TARGET_MULTIPLIER))


def test_walk_away_is_fair_high_times_multiplier():
    _, walk_away = _compute_anchors(30000, 50000)
    assert walk_away == int(round(50000 * NEGOTIATION_WALKAWAY_MULTIPLIER))


def test_walk_away_always_exceeds_target():
    # Spread is small enough that naive math would cross — the guard kicks in.
    target, walk_away = _compute_anchors(10000, 10100)
    assert walk_away > target


def test_returns_zero_when_range_missing():
    assert _compute_anchors(0, 0) == (0, 0)
    assert _compute_anchors(0, 5000) == (0, 0)
    assert _compute_anchors(5000, 0) == (0, 0)


def test_returns_zero_when_range_inverted():
    # fair_high < fair_low is nonsense evidence → refuse to anchor.
    assert _compute_anchors(9000, 4000) == (0, 0)


# ─── Listing-aware anchors (never offer ABOVE the seller's asking price) ──

def test_listing_below_fair_range_anchors_off_listing():
    # Fair $700–$1000 but seller asks $500 — offering $784 (1.12 * fair_low)
    # would be negotiating UP. We anchor a 12% haircut off listing instead.
    target, walk_away = _compute_anchors(
        fair_low=70000, fair_high=100000, quoted_price=50000,
    )
    expected_target = int(round(50000 * NEGOTIATION_LISTING_HAIRCUT))
    assert target == expected_target
    assert target < 50000
    # Never walk-away above listing — you'd just accept it.
    assert walk_away <= 50000


def test_listing_above_fair_range_uses_fair_floor_anchor():
    # Classic overcharge: seller asks $1500 for $700–$1000 fair. Pull them down.
    target, walk_away = _compute_anchors(
        fair_low=70000, fair_high=100000, quoted_price=150000,
    )
    assert target == int(round(70000 * NEGOTIATION_TARGET_MULTIPLIER))
    assert walk_away == int(round(100000 * NEGOTIATION_WALKAWAY_MULTIPLIER))


def test_listing_inside_fair_range_caps_anchor_below_listing():
    # Seller at fair_mid — anchor should still be below listing so the
    # opening offer is a credible ask, not an invitation to accept.
    target, walk_away = _compute_anchors(
        fair_low=70000, fair_high=100000, quoted_price=85000,
    )
    assert target < 85000
    assert walk_away <= 85000


def test_listing_zero_falls_back_to_range_only():
    # Missing quote → old behavior (pure fair-range anchors).
    target_listing, _ = _compute_anchors(70000, 100000, quoted_price=0)
    target_legacy, _ = _compute_anchors(70000, 100000)
    assert target_listing == target_legacy


def test_walk_away_still_exceeds_target_when_listing_is_low():
    # Aggressively low listing — guard still ensures spread > 0.
    target, walk_away = _compute_anchors(
        fair_low=70000, fair_high=100000, quoted_price=10000,
    )
    assert walk_away > target
