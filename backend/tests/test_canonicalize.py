"""Canonical service fingerprint tests (LIVE-P1-10).

These are the unit tests that guard the clustering behavior downstream. If the
fingerprint stops being stable across phrasing, the community baseline goes
noisy even before the rest of the pipeline notices.
"""

from app.intelligence.canonicalize import (
    canonical_service_key, service_fingerprint,
)


def test_fingerprint_stable_across_token_order():
    """Different phrasings of the same repair cluster together."""
    a = service_fingerprint("front brake pads replacement")
    b = service_fingerprint("replacement of brake pads front")
    assert a == b
    assert "brake" in a
    assert "|" in a  # pipe-joined for readability


def test_fingerprint_drops_filler_words():
    """Stopwords don't leak into the key."""
    fp = service_fingerprint("please help — I need brake pads replaced today")
    assert "please" not in fp
    assert "need" not in fp
    assert "today" not in fp
    assert "brake" in fp


def test_fingerprint_empty_or_gibberish_returns_unknown():
    """Too-short or all-stopword inputs never cluster together."""
    assert service_fingerprint("") == "unknown"
    assert service_fingerprint(None) == "unknown"
    assert service_fingerprint("the a my") == "unknown"
    assert service_fingerprint("a x y") == "unknown"  # tokens below min length


def test_fingerprint_case_insensitive():
    assert service_fingerprint("BRAKE Pads") == service_fingerprint("brake PADS")


def test_canonical_key_preserves_order_but_dedupes():
    """Readable canonical form keeps first-seen order but drops dupes."""
    key = canonical_service_key("brake brake pads civic honda")
    tokens = key.split()
    # "brake" appears once, not twice
    assert tokens.count("brake") == 1
    assert tokens[0] == "brake"  # original order preserved


def test_canonical_key_handles_punctuation():
    key = canonical_service_key("Oil-change & filter! (2019)")
    assert "change" in key
    assert "filter" in key
    # Numbers are stripped by the alpha-only tokenizer
    assert "2019" not in key
