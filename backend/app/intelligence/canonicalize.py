"""Canonical service fingerprints for community-price rows (LIVE-P1-10).

Before this module, `community_prices.service_type` stored the user's raw
query text truncated to 200 characters. The same brake job landed as:

    "front brake pads replacement 2019 honda civic"
    "brake pad replace civic honda"
    "replace the pads on my 2019 civic"
    "i need new brakes asap please help its squealing"

Once the community table is used as live evidence, those rows have to cluster
to the same service or the baseline goes noisy. We need a stable key that
strips filler and orders tokens deterministically so insertion order and
phrasing don't matter.

The fingerprint is intentionally simple and language-specific: lowercase alpha
tokens ≥ 4 chars, dropped stopwords, sorted, pipe-joined. It's not a full NLP
canonicalizer — it's the cheapest thing that collapses obvious duplicates
without pretending to do more than that. Make/model hints aren't folded in
because the per-vehicle split happens separately (make/model live on their
own columns on the query row).

Rows whose fingerprint ends up empty (too short, or all stopwords) get
`_EMPTY_FINGERPRINT` so they never silently cluster with each other.
"""

from __future__ import annotations

import re


# Narrow stopword set — domain-specific filler, not the full English list.
# Over-trimming would merge "brake pads" and "brake rotors" into the same
# bucket, which would poison the clusters more than leaving them separate.
_STOPWORDS = frozenset({
    "the", "and", "for", "with", "this", "that", "have", "need",
    "want", "please", "help", "asap", "today", "tomorrow",
    "can", "you", "my", "me",
})

_MIN_TOKEN_LEN = 4
_EMPTY_FINGERPRINT = "unknown"


def _tokens(text: str) -> list[str]:
    if not text:
        return []
    raw = re.findall(r"[a-zA-Z]+", text)
    return [t.lower() for t in raw if len(t) >= _MIN_TOKEN_LEN]


def canonical_service_key(raw_service: str | None) -> str:
    """Short human-readable canonical form (for debugging / UI).

    Example: 'Front Brake Pads Replacement — 2019 Honda Civic!'
      → 'brake pads replacement civic honda'
    """
    tokens = [t for t in _tokens(raw_service or "") if t not in _STOPWORDS]
    if not tokens:
        return _EMPTY_FINGERPRINT
    # Preserve original-order (but deduplicated) tokens so the UI rendering
    # still reads naturally. Fingerprint below is the sort-stable one used
    # for joins.
    seen: set[str] = set()
    ordered: list[str] = []
    for t in tokens:
        if t in seen:
            continue
        seen.add(t)
        ordered.append(t)
    return " ".join(ordered)


def service_fingerprint(raw_service: str | None) -> str:
    """Stable, sort-order-insensitive fingerprint for clustering.

    This is the column the community loader joins on. Two rows with the same
    fingerprint are treated as the same service; different fingerprints are
    treated as different services.
    """
    tokens = {t for t in _tokens(raw_service or "") if t not in _STOPWORDS}
    if not tokens:
        return _EMPTY_FINGERPRINT
    return "|".join(sorted(tokens))
