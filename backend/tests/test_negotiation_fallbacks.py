"""Deterministic behavior when the LLM is down.

Two overnight hardening features get pinned here:

1. `build_fallback_negotiation()` — used when generate_negotiation returns
   garbage (or errors twice) so the extension always gets a structurally
   complete playbook instead of a 502.

2. `_fallback_chat_turn()` — same idea for the conversational chat: if the
   chat LLM fails to return parseable JSON we still hand the user a sensible
   "here's what to text next" instead of a red error banner.
"""

from app.services.llm import (
    _fallback_chat_turn,
    build_fallback_negotiation,
)


# ─── Negotiation playbook fallback ──────────────────────────────────────

def _verdict(**overrides):
    base = {
        "fair_price_low": 20000,
        "fair_price_mid": 30000,
        "fair_price_high": 40000,
        "target_price": 22400,
        "walk_away_above": 44000,
        "quoted_price": 70000,
        "domain": "retail",
    }
    base.update(overrides)
    return base


def test_fallback_returns_full_playbook_shape():
    result = build_fallback_negotiation(_verdict())
    assert "scripts" in result
    assert "tactics" in result
    assert "evidence_summary" in result
    assert result.get("_fallback") is True


def test_fallback_scripts_cover_all_playbook_stages():
    result = build_fallback_negotiation(_verdict())
    roles = {s["role"] for s in result["scripts"]}
    assert {"you_opening", "you_evidence", "you_final_offer", "you_walkaway"} <= roles


def test_fallback_tactics_are_domain_appropriate():
    result = build_fallback_negotiation(_verdict(domain="retail"))
    joined = " ".join(t["name"] for t in result["tactics"]).lower()
    # Retail domain tactics reference marketplaces — sanity check at least one.
    assert any(token in joined for token in ("ebay", "amazon", "walmart", "marketplace", "model"))


def test_fallback_opener_cites_anchor_price():
    result = build_fallback_negotiation(_verdict())
    opener = next(s["text"] for s in result["scripts"] if s["role"] == "you_opening")
    # Anchor target is $224 in this fixture.
    assert "$224" in opener


def test_fallback_handles_missing_anchor_fields():
    # Verdict with no computed anchors — shouldn't crash, just degrade.
    minimal = {"fair_price_low": 0, "fair_price_high": 0, "target_price": 0,
               "walk_away_above": 0, "quoted_price": 0, "domain": "retail"}
    result = build_fallback_negotiation(minimal)
    assert result["scripts"]  # still produces a playbook
    assert result["evidence_summary"]


# ─── Conversational chat fallback ────────────────────────────────────────

def test_chat_fallback_with_seller_message_suggests_counter():
    result = _fallback_chat_turn(
        fair_low=200, fair_high=400,
        anchor_target=224, seller_message="I can do $350",
    )
    assert result["tone"] == "friendly"
    assert "$224" in result["reply"]
    assert result["suggested_price_cents"] == 22400


def test_chat_fallback_without_seller_produces_opener():
    result = _fallback_chat_turn(
        fair_low=200, fair_high=400,
        anchor_target=224, seller_message=None,
    )
    assert "still available" in result["reply"].lower()
    assert result["should_accept"] is False


def test_chat_fallback_degenerates_gracefully_without_range():
    result = _fallback_chat_turn(
        fair_low=0, fair_high=0,
        anchor_target=0, seller_message="hello",
    )
    assert result["reply"]
    # With no anchor we shouldn't fabricate a suggested price.
    assert result["suggested_price_cents"] is None
