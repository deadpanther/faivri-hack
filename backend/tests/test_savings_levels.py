"""Level/streak math used by both /feedback and /savings/profile.

Pure functions — no DB, no time — so these lock the contract without a running
Postgres. If the ladder (bronze → silver → gold → platinum) ever changes, this
suite fails fast before the frontend celebration UI goes out of sync.
"""

from app.services.savings import (
    LEVELS,
    crossed_threshold,
    level_for_saved,
    next_level_for_saved,
    progress_to_next,
)


def _threshold(key: str) -> int:
    for k, _label, threshold in LEVELS:
        if k == key:
            return threshold
    raise AssertionError(f"unknown level {key}")


def test_level_bronze_at_zero():
    info = level_for_saved(0)
    assert info.key == "bronze"


def test_level_silver_at_threshold():
    info = level_for_saved(_threshold("silver"))
    assert info.key == "silver"


def test_level_gold_at_threshold():
    info = level_for_saved(_threshold("gold"))
    assert info.key == "gold"


def test_level_platinum_at_threshold_and_above():
    assert level_for_saved(_threshold("platinum")).key == "platinum"
    assert level_for_saved(_threshold("platinum") * 10).key == "platinum"


def test_next_level_from_bronze_points_to_silver():
    nxt = next_level_for_saved(_threshold("bronze"))
    assert nxt is not None and nxt.key == "silver"


def test_next_level_from_platinum_is_none():
    assert next_level_for_saved(_threshold("platinum") + 1) is None


def test_progress_zero_at_tier_floor():
    # Just landed on silver → 0% toward gold.
    assert progress_to_next(_threshold("silver")) == 0


def test_progress_halfway():
    silver = _threshold("silver")
    gold = _threshold("gold")
    halfway = silver + (gold - silver) // 2
    assert 40 <= progress_to_next(halfway) <= 60


def test_progress_maxes_at_platinum():
    assert progress_to_next(_threshold("platinum") + 1) == 100


def test_crossed_threshold_none_when_no_change():
    assert crossed_threshold(0, 0) is None
    assert crossed_threshold(50_000, 50_000) is None


def test_crossed_threshold_detects_silver():
    info = crossed_threshold(_threshold("silver") - 1, _threshold("silver") + 1)
    assert info is not None and info.key == "silver"


def test_crossed_threshold_skips_when_both_on_same_tier():
    # Both values above silver, below gold → no milestone.
    assert crossed_threshold(_threshold("silver") + 100, _threshold("silver") + 200) is None


def test_crossed_threshold_ignores_regression():
    # Savings going down (shouldn't happen, but be defensive).
    assert crossed_threshold(_threshold("gold"), _threshold("silver")) is None
