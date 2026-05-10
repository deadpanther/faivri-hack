"""Platform detection + trust calibration for the marketplace $10-vs-$70 bug.

The retail evidence pipeline previously let pristine Amazon anchors drown out
used-market comps, so a $70 Marketplace handbag was verdict-ed at $10 fair. We
now boost used-market domains and dampen pristine retail whenever the caller
flags a secondhand platform — these tests lock that behavior.
"""

from app.intelligence.evidence import (
    PRISTINE_RETAIL_DOMAINS,
    USED_MARKET_DOMAINS,
    USED_MARKET_PRISTINE_DAMPEN,
    USED_MARKET_TRUST_BOOST,
    _calibrate_trust_for_platform,
    _is_used_market_platform,
)
from app.intelligence.web_search import detect_listing_platform


# ─── detect_listing_platform ──────────────────────────────────────────────

def test_detects_ebay_from_free_text():
    assert detect_listing_platform("ebay listing for iphone 14") == "eBay"


def test_detects_facebook_marketplace():
    assert detect_listing_platform("saw this on Facebook Marketplace") == "Facebook Marketplace"


def test_detects_craigslist():
    assert detect_listing_platform("craigslist find in Brooklyn") == "Craigslist"


def test_returns_none_when_no_platform_mention():
    assert detect_listing_platform("how much is a PS5") is None


def test_handles_empty_input():
    assert detect_listing_platform("") is None
    assert detect_listing_platform(None) is None  # type: ignore[arg-type]


# ─── _is_used_market_platform ─────────────────────────────────────────────

def test_recognizes_all_secondhand_platforms():
    for platform in (
        "eBay", "Facebook Marketplace", "Craigslist",
        "Mercari", "OfferUp", "Poshmark", "Depop",
    ):
        assert _is_used_market_platform(platform), platform


def test_ignores_non_marketplace_platforms():
    assert not _is_used_market_platform("Amazon")
    assert not _is_used_market_platform("Walmart")
    assert not _is_used_market_platform(None)
    assert not _is_used_market_platform("")


# ─── _calibrate_trust_for_platform ────────────────────────────────────────

def test_used_market_domain_gets_boost_when_on_marketplace():
    # ebay.com is USED_MARKET; being on Marketplace boosts its weight.
    calibrated = _calibrate_trust_for_platform(
        "ebay.com", base_trust=0.6, domain_label="retail",
        listing_platform="Facebook Marketplace",
    )
    assert calibrated > 0.6
    assert calibrated == min(1.0, 0.6 * USED_MARKET_TRUST_BOOST)


def test_pristine_retail_domain_gets_dampened_when_on_marketplace():
    calibrated = _calibrate_trust_for_platform(
        "amazon.com", base_trust=0.8, domain_label="retail",
        listing_platform="eBay",
    )
    assert calibrated < 0.8
    assert calibrated == max(0.1, 0.8 * USED_MARKET_PRISTINE_DAMPEN)


def test_calibration_is_noop_for_non_retail_domain():
    for domain in ("ebay.com", "amazon.com"):
        assert _calibrate_trust_for_platform(
            domain, 0.7, "auto", "Facebook Marketplace",
        ) == 0.7


def test_calibration_is_noop_when_no_platform_hint():
    assert _calibrate_trust_for_platform(
        "amazon.com", 0.8, "retail", None,
    ) == 0.8


def test_trust_boost_caps_at_one():
    calibrated = _calibrate_trust_for_platform(
        "ebay.com", base_trust=0.95, domain_label="retail",
        listing_platform="eBay",
    )
    assert calibrated <= 1.0


def test_pristine_dampen_floor_is_respected():
    # Base trust already tiny — dampen should not push below the 0.1 floor.
    calibrated = _calibrate_trust_for_platform(
        "walmart.com", base_trust=0.15, domain_label="retail",
        listing_platform="Craigslist",
    )
    assert calibrated >= 0.1


# ─── Domain set sanity (guard against accidental edits) ───────────────────

def test_used_and_pristine_sets_are_disjoint():
    overlap = USED_MARKET_DOMAINS & PRISTINE_RETAIL_DOMAINS
    assert overlap == set(), f"domain lists overlap: {overlap}"
