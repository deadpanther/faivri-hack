"""Deterministic evidence extraction and market-range computation.

This module replaces LLM-as-oracle with LLM-as-explainer. Prices are pulled from
live search results by regex, classified with lightweight heuristics, weighted
by source trust and locality, and aggregated into a defensible range in Python.

Downstream, the synthesizer LLM is only given the structured evidence records
plus the pre-computed range; it is not allowed to invent or adjust prices.

Core types:
    ExtractedPrice  — one per-source price record with provenance
    FairRange       — the aggregated market range + confidence + source list

Core functions:
    extract_prices_from_results(web_results, city, state, domain, service)
    compute_fair_range(prices)                -> FairRange  (raises if thin)
    compute_verdict_math(fair_range, quoted)  -> dict (verdict label + overpay)

A verdict that passes through this module is always traceable back to specific
URLs, making the output defensible to a vendor who asks "says who?"
"""

from __future__ import annotations

import logging
import re
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ─── Tunables ────────────────────────────────────────────────────────────────

# Minimum distinct trusted domains required to compute a range in the happy
# path. Below this we try graceful degradation (see DEGRADED_* below) before
# hard-failing. Was 3, lowered to 2 after real "oil change" traffic showed
# Tavily reliably returns 1-2 citation-grade domains + a long tail of
# independent shops and blogs.
MIN_TRUSTED_DOMAINS = 2

# Graceful degradation: when distinct_trusted_domains < MIN but we have
# enough corroborating non-trusted survivors with tight clustering, compute
# the range anyway with confidence capped at DEGRADED_CONFIDENCE_CAP.
# Rationale: a consumer querying "oil change in Fremont, CA" kept hitting
# `got 1` because Tavily's top results for service-chain queries are a mix
# of one citation-grade domain (e.g. repairpal) + 4-6 local shop blogs that
# quote consistent prices. Hard-failing that is worse product behavior than
# returning a range marked "low confidence" — the UI can surface the penalty.
DEGRADED_MIN_TRUSTED = 0             # allow zero-trusted fallback when the
                                     # other guards (surv count + CV) hold.
                                     # Real vendor domains (dental clinics,
                                     # local shops) constantly land outside
                                     # the curated dict; requiring ≥1 trusted
                                     # anchor was 503-ing specific-geo queries
                                     # even when 4+ real listings clustered
                                     # tightly. The CV ≤ 0.35 rail below
                                     # already rejects noisy evidence, and the
                                     # DEGRADED_CONFIDENCE_CAP tells the UI to
                                     # mark the verdict "low confidence".
DEGRADED_MIN_SURVIVORS = 2           # lowered from 4 — real Tavily results
                                     # for specific queries ("front brake pads
                                     # + rotor in LA") often come back with 2-3
                                     # surviving records after outlier filters,
                                     # all from non-trusted local shops. Hard
                                     # 503-ing those is worse than returning a
                                     # "low confidence" range: the CV rail (0.9)
                                     # still rejects garbage, and 2 tightly-
                                     # clustered quotes beat "try again later".
DEGRADED_MAX_CV = 1.5                # raised from 0.9 after live traffic on
                                     # home-services queries ("snake a clogged
                                     # drain in Brooklyn") returned cv 1.0-1.3
                                     # — real plumbing/HVAC markets quote
                                     # $80–$1,200 for the same job depending on
                                     # whether it's emergency vs. scheduled,
                                     # whether DIY rental is included, etc.
                                     # 503-ing a real dispersion that wide felt
                                     # broken to early users; instead we now
                                     # surface a low-confidence verdict with a
                                     # widened band so the UI can warn that
                                     # prices vary heavily. cv > 1.5 still
                                     # rejects truly garbage spreads (a single
                                     # $14k outlier mixed with $200 quotes).
DEGRADED_CONFIDENCE_CAP = 30         # surfaced as "low confidence" in UI —
                                     # lowered from 45 now that we accept
                                     # much noisier evidence.

# Trust cutoffs
TRUST_TRUSTED = 0.6   # "citation-grade" source
TRUST_MEDIUM = 0.3
TRUST_LOW = 0.1

# Locality multiplier applied on top of trust_weight when aggregating.
LOCAL_WEIGHT_MULTIPLIER = 1.5

# Outlier rejection: drop any price outside [median / OUTLIER_RATIO, median * OUTLIER_RATIO].
# Then apply IQR filter on the survivors.
OUTLIER_RATIO = 10.0

# Confidence scoring
CONFIDENCE_MAX = 95
CONFIDENCE_TRUSTED_DOMAIN_WEIGHT = 15   # per trusted domain
CONFIDENCE_LOCAL_BONUS_FULL = 20        # 2+ local records
CONFIDENCE_LOCAL_BONUS_PARTIAL = 10     # 1 local record
CONFIDENCE_TIGHT_CLUSTER = 15           # cv < 0.2
CONFIDENCE_MEDIUM_CLUSTER = 10          # cv < 0.4

# Verdict bands (applied to `quoted_price` vs fair_price_high)
VERDICT_FAIR_CEILING = 1.00   # quoted <= fair_high → fair
VERDICT_HIGH_CEILING = 1.25   # quoted <= fair_high * 1.25 → high; above → overcharge


# ─── Trusted domain registry ─────────────────────────────────────────────────
# Weights are per-domain because content quality is per-domain.  Keep these
# curated; downgrading a bad domain here is how we keep verdicts defensible.
# Users will see these domains cited in explanations, so every entry here is a
# standards-level decision.

TRUSTED_DOMAINS: dict[str, dict[str, float]] = {
    "auto": {
        # Editorial / reference: highest trust — curated pricing databases.
        "repairpal.com": 1.00,
        "kbb.com": 1.00,
        "edmunds.com": 0.95,
        "yourmechanic.com": 0.90,
        "caranddriver.com": 0.70,
        "carfax.com": 0.70,
        "jdpower.com": 0.80,
        "nada.com": 0.90,
        "nadaguides.com": 0.85,
        "nhtsa.gov": 1.00,
        "consumerreports.org": 0.85,
        # Service chains: first-party menu pricing for the services they sell.
        # These ARE the US auto-service market — excluding them made common
        # queries like "oil change" fail MIN_TRUSTED_DOMAINS with 0 matches
        # even though Tavily returned dozens of results. Raised to ≥0.60 so
        # they count as trusted citations, same as editorial sources.
        "jiffylube.com": 0.70,
        "valvoline.com": 0.70,
        "takecareoftheoil.com": 0.65,
        "take5oilchange.com": 0.65,
        "midas.com": 0.65,
        "firestonecompleteautocare.com": 0.65,
        "meineke.com": 0.65,
        "pepboys.com": 0.65,
        "goodyearautoservice.com": 0.65,
        "bigotires.com": 0.65,
        "discounttire.com": 0.60,
        "mavis.com": 0.60,
        "mrlube.com": 0.60,
        "walmart.com": 0.60,
        "costco.com": 0.65,
        "samsclub.com": 0.60,
        # Parts retailers: publish transparent retail pricing; aggregation
        # of their numbers gives a solid parts-side floor.
        "autozone.com": 0.65,
        "advanceautoparts.com": 0.60,
        "oreillyauto.com": 0.60,
        "napaonline.com": 0.60,
        "rockauto.com": 0.60,
        # Community-quality — contribute signal but cannot alone drive a verdict.
        "reddit.com": 0.20,
        "quora.com": 0.10,
    },
    "home": {
        # Editorial / aggregator: highest trust — these are the canonical
        # consumer-pricing references for home services in the US.
        "homeadvisor.com": 1.00,
        "angi.com": 1.00,
        "angieslist.com": 1.00,
        "thumbtack.com": 1.00,
        "homewyse.com": 0.90,
        "fixr.com": 0.75,
        "remodelingcalculator.org": 0.70,
        "hometips.com": 0.60,
        "homedepot.com": 0.55,
        "lowes.com": 0.55,
        "bobvila.com": 0.55,
        "thisoldhouse.com": 0.70,
        # National service chains: first-party menu pricing for the trades
        # they sell. Same logic as `auto` above — excluding them was making
        # plumber/HVAC/electrician queries fail MIN_TRUSTED_DOMAINS even when
        # Tavily returned consistent quotes from these chains. ≥0.60 so they
        # count as trusted citations.
        "rotorooter.com": 0.70,
        "mrrooter.com": 0.65,
        "eliterooter.com": 0.60,
        "benjaminfranklinplumbing.com": 0.65,
        "rescuerooterservice.com": 0.60,
        "aquaplumbing.com": 0.55,
        "mrelectric.com": 0.65,
        "mrhandyman.com": 0.65,
        "mrappliance.com": 0.60,
        "aireserv.com": 0.65,           # HVAC chain
        "oneandonlyhomeservices.com": 0.55,
        "michaelandsonservices.com": 0.55,
        "arsrescuerooter.com": 0.60,    # ARS/Rescue Rooter
        "leaffilter.com": 0.60,
        "puroclean.com": 0.55,
        "servpro.com": 0.65,
        "stanleysteemer.com": 0.65,
        "terminix.com": 0.65,
        "orkin.com": 0.65,
        "trugreen.com": 0.60,
        "yelp.com": 0.30,               # local-shop signal, not authority
        "reddit.com": 0.20,
    },
    "medical": {
        "healthcarebluebook.com": 1.00,
        "fairhealthconsumer.org": 1.00,
        "goodrx.com": 1.00,
        "cms.gov": 1.00,
        "medicare.gov": 1.00,
        "costplusdrugs.com": 0.90,
        "mdsave.com": 0.80,
        "nerdwallet.com": 0.40,
        "verywellhealth.com": 0.40,
    },
    "legal": {
        "avvo.com": 1.00,
        "martindale.com": 0.90,
        "legalzoom.com": 0.80,
        "nolo.com": 0.80,
        "findlaw.com": 0.75,
        "americanbar.org": 0.95,
    },
    "retail": {
        # Big-box + online retailers: first-party new-goods pricing.
        "amazon.com": 1.00,
        "walmart.com": 1.00,
        "costco.com": 1.00,
        "target.com": 0.95,
        "bestbuy.com": 1.00,
        "newegg.com": 0.95,
        "homedepot.com": 0.85,
        "lowes.com": 0.85,
        "bhphotovideo.com": 0.90,
        "apple.com": 0.95,
        "samsung.com": 0.90,
        "microcenter.com": 0.90,
        "microsoft.com": 0.85,
        # Price-history / aggregators: strongest signal for "fake discount"
        # detection because they show what the price was BEFORE a supposed sale.
        "camelcamelcamel.com": 1.00,
        "keepa.com": 1.00,
        "pcpartpicker.com": 0.95,
        "slickdeals.net": 0.60,
        # Used marketplaces. eBay sold listings are the gold standard for used
        # pricing; weighted high because completed sales = real demand.
        "ebay.com": 0.85,
        "facebook.com": 0.40,           # Marketplace listings — ask, not sold
        "craigslist.org": 0.40,
        "swappa.com": 0.80,             # curated used phones/tablets
        "backmarket.com": 0.80,         # certified refurb
        "gazelle.com": 0.70,
        # Manufacturer direct (when applicable)
        "nvidia.com": 0.90,
        "amd.com": 0.85,
        "intel.com": 0.85,
        "dell.com": 0.85,
        "hp.com": 0.80,
        "lenovo.com": 0.80,
        "sony.com": 0.85,
        "lg.com": 0.80,
        # Community-quality — signal, not authority.
        "reddit.com": 0.20,
        "quora.com": 0.10,
    },
}


# ─── Enums + dataclasses ─────────────────────────────────────────────────────

class PriceType(str, Enum):
    PARTS = "parts"
    LABOR = "labor"
    TOTAL = "total"
    HOURLY = "hourly"
    UNKNOWN = "unknown"


@dataclass
class ExtractedPrice:
    """One price record extracted from one search result."""

    url: str
    domain_root: str          # e.g. "repairpal.com" (no subdomain, no path)
    title: str
    price_cents: int          # canonical USD cents
    price_type: PriceType
    raw_snippet: str          # the sentence the price came from (trimmed)
    trust_weight: float       # 0.0 - 1.0 — from TRUSTED_DOMAINS, 0.2 default
    is_local: bool            # mentions the user's city or state
    city_hint: Optional[str] = None
    state_hint: Optional[str] = None
    extracted_at: datetime = field(default_factory=datetime.utcnow)

    def effective_weight(self) -> float:
        return self.trust_weight * (LOCAL_WEIGHT_MULTIPLIER if self.is_local else 1.0)

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "domain": self.domain_root,
            "title": self.title,
            "price_cents": self.price_cents,
            "price_type": self.price_type.value,
            "trust_weight": round(self.trust_weight, 2),
            "is_local": self.is_local,
            "city_hint": self.city_hint,
            "state_hint": self.state_hint,
            "snippet": self.raw_snippet[:280],
            "extracted_at": self.extracted_at.isoformat(),
        }


@dataclass
class FairRange:
    """Aggregated market range computed from ExtractedPrice records."""

    fair_price_low: int       # cents, weighted p25
    fair_price_mid: int       # cents, weighted median
    fair_price_high: int      # cents, weighted p75
    confidence_score: int     # 0-100
    data_points_count: int    # records that contributed to the range
    trusted_count: int        # records with trust_weight >= TRUST_TRUSTED
    local_count: int          # records with is_local=True
    distinct_trusted_domains: int
    std_dev_cents: int        # sample stdev of the contributing prices
    sources: list[dict]       # ExtractedPrice.to_dict() for each contributor

    def to_dict(self) -> dict:
        return {
            "fair_price_low": self.fair_price_low,
            "fair_price_mid": self.fair_price_mid,
            "fair_price_high": self.fair_price_high,
            "confidence_score": self.confidence_score,
            "data_points_count": self.data_points_count,
            "trusted_count": self.trusted_count,
            "local_count": self.local_count,
            "distinct_trusted_domains": self.distinct_trusted_domains,
            "std_dev_cents": self.std_dev_cents,
            "sources": self.sources,
        }


# ─── Price regex + classification ────────────────────────────────────────────

# USD-only price matcher. Captures:
#   $450
#   $450.00
#   $1,234
#   $1,234.56
# Optionally handles ranges like "$100 to $200" / "$100-$200" (emits both ends).
# Range marker must include whitespace or be a unicode dash to avoid absorbing
# dates and version numbers.
_PRICE_RE = re.compile(
    r"""
    \$\s*                                           # dollar sign
    (?P<lo>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?         # thousands-grouped (at least one comma)
          |\d{1,7}(?:\.\d{1,2})?                    # or plain digits
    )
    (?:\s*(?:to|through|[-\u2013\u2014])\s*         # optional range separator (incl. en/em dash)
        \$?\s*
        (?P<hi>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?
              |\d{1,7}(?:\.\d{1,2})?
        )
    )?
    """,
    re.VERBOSE | re.IGNORECASE,
)

# Amounts at or below this threshold are almost certainly not a service price —
# often they are sales tax, small parts, or a surcharge.  Apply per domain.
_MIN_PLAUSIBLE_CENTS = {
    "auto": 500,       # $5
    "home": 500,       # $5
    "medical": 100,    # $1 (generic drug floor)
    "legal": 2500,     # $25 (minimum billing increment)
    "retail": 100,     # $1 (lowest plausible new-goods line item)
}
_MAX_PLAUSIBLE_CENTS = {
    "auto": 5_000_000,       # $50k (catastrophic repairs still plausible)
    "home": 50_000_000,      # $500k (major remodel)
    "medical": 50_000_000,   # $500k
    "legal": 50_000_000,     # $500k retainer
    "retail": 20_000_000,    # $200k (rare high-end like pro equipment / appliances)
}

# Context cues for price type classification. Order matters — hourly wins over
# labor because "labor rate per hour" should classify as HOURLY.
_PRICE_TYPE_CUES = [
    (PriceType.HOURLY, re.compile(r"\b(per\s*hour|/\s*hr\b|hourly\s+rate|an\s+hour)", re.I)),
    (PriceType.LABOR, re.compile(r"\b(labor(?:\s+only)?|labour|labor\s+cost|labor\s+charge)\b", re.I)),
    (PriceType.PARTS, re.compile(r"\b(parts?(?:\s+only)?|parts?\s+cost|replacement\s+part)\b", re.I)),
    (PriceType.TOTAL, re.compile(r"\b(total|all[-\s]?in|installed|out\s+the\s+door|including\s+labor\s+and\s+parts)\b", re.I)),
]


def _parse_price_string(raw: str) -> Optional[int]:
    """Parse '1,234.56' → 123456 cents. Returns None on failure."""
    try:
        cleaned = raw.replace(",", "").strip()
        dollars = float(cleaned)
        cents = int(round(dollars * 100))
        if cents <= 0:
            return None
        return cents
    except (ValueError, TypeError):
        return None


def _classify_price_type(local_context: str) -> PriceType:
    """Look at the ~80 chars around a price to classify it."""
    for label, pattern in _PRICE_TYPE_CUES:
        if pattern.search(local_context):
            return label
    return PriceType.UNKNOWN


def _split_into_sentences(text: str) -> list[str]:
    """Rough sentence splitter — good enough for snippet provenance."""
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z$])", text)
    return [p.strip() for p in parts if p.strip()]


def extract_price_candidates(
    text: str,
    domain_label: str,
) -> list[tuple[int, PriceType, str]]:
    """Pull every plausible price from a blob of text.

    Returns a list of (price_cents, price_type, snippet) tuples.
    Applies per-domain plausibility bounds so tax/surcharge/parts-line-items
    don't contaminate the evidence pool.

    A single '$X to $Y' range expands into two records so both bounds show up
    in the aggregate — otherwise we lose the low half of every range.
    """
    if not text:
        return []

    min_cents = _MIN_PLAUSIBLE_CENTS.get(domain_label, 500)
    max_cents = _MAX_PLAUSIBLE_CENTS.get(domain_label, 50_000_000)

    results: list[tuple[int, PriceType, str]] = []
    sentences = _split_into_sentences(text)

    for sentence in sentences:
        for match in _PRICE_RE.finditer(sentence):
            lo_str = match.group("lo")
            hi_str = match.group("hi")
            lo = _parse_price_string(lo_str) if lo_str else None
            hi = _parse_price_string(hi_str) if hi_str else None

            # Context window: 40 chars before + 40 chars after (capped to sentence)
            start = max(0, match.start() - 40)
            end = min(len(sentence), match.end() + 40)
            local_ctx = sentence[start:end]
            price_type = _classify_price_type(local_ctx)

            for candidate in (lo, hi):
                if candidate is None:
                    continue
                if candidate < min_cents or candidate > max_cents:
                    continue
                results.append((candidate, price_type, sentence[:280]))

    return results


# ─── Locality detection ──────────────────────────────────────────────────────

# Minimal US state map (postal → full name) for "in California" / "in CA" matches.
# Not exhaustive for edge cases (e.g. Washington DC) — pragmatic for US market.
_US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def _detect_locality(
    text: str,
    target_city: Optional[str],
    target_state: Optional[str],
) -> bool:
    """Did this snippet/URL/title mention the user's geography?"""
    if not text:
        return False
    lowered = text.lower()
    if target_city and target_city.lower() in lowered:
        return True
    if target_state:
        code = target_state.strip().upper()
        full = _US_STATES.get(code)
        if full and full.lower() in lowered:
            return True
        # word-boundary check for postal code
        if re.search(rf"\b{re.escape(code)}\b", text):
            return True
    return False


# ─── Domain trust lookup ─────────────────────────────────────────────────────

def _extract_domain_root(url: str) -> str:
    """Strip scheme/subdomain/path → 'repairpal.com'."""
    if not url:
        return ""
    try:
        host = urlparse(url).netloc.lower()
    except ValueError:
        return ""
    if not host:
        return url.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _domain_trust(domain_root: str, domain_label: str) -> float:
    """Trust weight for a given URL domain within a FairCheck domain.

    Unknown sources default to TRUST_LOW so they count a little but can't drive
    a verdict by themselves. Known sources override.
    """
    registry = TRUSTED_DOMAINS.get(domain_label, {})
    if domain_root in registry:
        return registry[domain_root]
    # Allow subdomain match: e.g. "blog.repairpal.com" → "repairpal.com"
    for known, weight in registry.items():
        if domain_root.endswith("." + known):
            return weight
    return 0.2  # unknown but not worthless


# ─── Public API: extraction ──────────────────────────────────────────────────

# Domains that represent the used / secondhand market. When the user is
# pricing a listing from a used-market platform, these get a trust BOOST
# relative to the default retail weights because they reflect what the
# item *actually sells for today*, not what a pristine new-in-box unit costs.
# Pristine-retail anchors (Amazon / Walmart / manufacturer MSRP) get
# dampened in the same scenario so a $1,200 new-in-box comp doesn't drown
# out the $200-400 cluster of real used sales.
USED_MARKET_DOMAINS = {
    "ebay.com",
    "facebook.com",
    "craigslist.org",
    "mercari.com",
    "offerup.com",
    "poshmark.com",
    "depop.com",
    "swappa.com",
    "backmarket.com",
    "gazelle.com",
}

PRISTINE_RETAIL_DOMAINS = {
    "amazon.com",
    "walmart.com",
    "costco.com",
    "target.com",
    "bestbuy.com",
    "newegg.com",
    "bhphotovideo.com",
    "apple.com",
    "samsung.com",
    "microcenter.com",
    "microsoft.com",
    "dell.com",
    "hp.com",
    "lenovo.com",
    "sony.com",
    "lg.com",
    "nvidia.com",
    "amd.com",
    "intel.com",
    "homedepot.com",
    "lowes.com",
}

USED_MARKET_TRUST_BOOST = 1.35     # raise used-comp domains in used-market mode
USED_MARKET_PRISTINE_DAMPEN = 0.55  # dampen pristine-retail anchors


def _is_used_market_platform(platform: str | None) -> bool:
    if not platform:
        return False
    lower = platform.lower()
    return any(
        needle in lower
        for needle in ("ebay", "facebook", "marketplace", "craigslist",
                       "mercari", "offerup", "poshmark", "depop")
    )


def _calibrate_trust_for_platform(
    domain_root: str,
    base_trust: float,
    domain_label: str,
    listing_platform: str | None,
) -> float:
    """Adjust per-source trust when the user is on a used-market platform.

    Returning a boosted or dampened weight shifts the weighted-percentile
    fair range toward what the item sells for *in that market*. A new $1,200
    listing from amazon.com is still evidence, just not the anchor for a
    $70 Facebook Marketplace handbag.
    """
    if domain_label != "retail":
        return base_trust
    if not _is_used_market_platform(listing_platform):
        return base_trust
    if domain_root in USED_MARKET_DOMAINS or any(
        domain_root.endswith("." + d) for d in USED_MARKET_DOMAINS
    ):
        return min(1.0, base_trust * USED_MARKET_TRUST_BOOST)
    if domain_root in PRISTINE_RETAIL_DOMAINS or any(
        domain_root.endswith("." + d) for d in PRISTINE_RETAIL_DOMAINS
    ):
        return max(0.1, base_trust * USED_MARKET_PRISTINE_DAMPEN)
    return base_trust


def extract_prices_from_results(
    web_results: list[dict],
    *,
    target_city: Optional[str],
    target_state: Optional[str],
    domain_label: str,
    listing_platform: Optional[str] = None,
) -> list[ExtractedPrice]:
    """Turn Tavily-style results into structured ExtractedPrice records.

    Input contract: each item in `web_results` has `url`, `title`, `content`.
    Output is a flat list — a single article can contribute multiple records.

    When `listing_platform` hints that the user is pricing against a
    secondhand listing (eBay, Marketplace, Craigslist, …), used-market
    domains get a trust boost and pristine-retail anchors get dampened so
    the weighted range reflects real resale value, not MSRP.
    """
    out: list[ExtractedPrice] = []
    for result in web_results:
        url = result.get("url") or ""
        title = result.get("title") or ""
        content = result.get("content") or ""
        if not url or not content:
            continue

        domain_root = _extract_domain_root(url)
        if not domain_root:
            continue

        base_trust = _domain_trust(domain_root, domain_label)
        trust = _calibrate_trust_for_platform(
            domain_root, base_trust, domain_label, listing_platform,
        )
        body_for_locality = f"{url} {title} {content}"
        is_local = _detect_locality(body_for_locality, target_city, target_state)

        candidates = extract_price_candidates(content, domain_label)
        # Also pull from the title — many listings put the headline price there.
        candidates += extract_price_candidates(title, domain_label)

        for price_cents, price_type, snippet in candidates:
            out.append(
                ExtractedPrice(
                    url=url,
                    domain_root=domain_root,
                    title=title[:280],
                    price_cents=price_cents,
                    price_type=price_type,
                    raw_snippet=snippet,
                    trust_weight=trust,
                    is_local=is_local,
                    city_hint=target_city,
                    state_hint=target_state,
                )
            )
    return out


# ─── Outlier rejection ───────────────────────────────────────────────────────

def _drop_outliers(prices: list[ExtractedPrice]) -> list[ExtractedPrice]:
    """Two-stage outlier rejection.

    Stage 1: drop anything outside [median / OUTLIER_RATIO, median * OUTLIER_RATIO].
    Stage 2: drop anything outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR] on the survivors.

    Requires at least 4 records before stage 2 runs; below that, we only apply
    stage 1. This prevents aggressive IQR trimming from collapsing a thin but
    consistent evidence set.
    """
    if len(prices) < 4:
        return prices

    values = [p.price_cents for p in prices]
    median = statistics.median(values)
    if median <= 0:
        return prices

    coarse = [
        p for p in prices
        if (median / OUTLIER_RATIO) <= p.price_cents <= (median * OUTLIER_RATIO)
    ]
    if len(coarse) < 4:
        return coarse

    coarse_values = sorted(p.price_cents for p in coarse)
    q1 = statistics.quantiles(coarse_values, n=4)[0]
    q3 = statistics.quantiles(coarse_values, n=4)[2]
    iqr = q3 - q1
    low_fence = q1 - 1.5 * iqr
    high_fence = q3 + 1.5 * iqr
    return [p for p in coarse if low_fence <= p.price_cents <= high_fence]


# ─── Weighted percentiles ────────────────────────────────────────────────────

def _weighted_percentile(
    prices_with_weights: list[tuple[int, float]],
    p: float,
) -> int:
    """Linear-interpolated weighted percentile.

    prices_with_weights: [(cents, weight), ...] — weights must be positive.
    p: 0..1.  Returns cents.
    """
    if not prices_with_weights:
        return 0
    sorted_pw = sorted(prices_with_weights, key=lambda x: x[0])
    total_w = sum(w for _, w in sorted_pw)
    if total_w <= 0:
        return sorted_pw[len(sorted_pw) // 2][0]

    target = p * total_w
    cum = 0.0
    for i, (price, weight) in enumerate(sorted_pw):
        next_cum = cum + weight
        if next_cum >= target:
            if i == 0 or weight == 0:
                return price
            prev_price = sorted_pw[i - 1][0]
            # Linear interpolation within this step
            frac = (target - cum) / weight
            return int(round(prev_price + (price - prev_price) * frac))
        cum = next_cum
    return sorted_pw[-1][0]


# ─── Confidence ──────────────────────────────────────────────────────────────

def _confidence_score(survivors: list[ExtractedPrice]) -> int:
    if not survivors:
        return 0

    distinct_trusted = len({
        p.domain_root for p in survivors if p.trust_weight >= TRUST_TRUSTED
    })
    local_count = sum(1 for p in survivors if p.is_local)

    # Survivor floor — any analysis backed by ≥1 piece of real evidence is
    # worth a small non-zero number, scaled by sample size. Without this any
    # degraded-mode query that didn't hit a citation-grade domain (the trust
    # registry is per-FairCheck-domain; misclassified or niche queries can
    # legitimately come back with `distinct_trusted == 0` but still useful
    # survivors) bottomed out at exactly 0% confidence even when the
    # weighted-percentile range was perfectly informative. Capped at 25 so a
    # blizzard of low-trust hits can't outrun a single citation-grade source.
    score: float = 5 + min(20, len(survivors) * 3)

    score += min(60, distinct_trusted * CONFIDENCE_TRUSTED_DOMAIN_WEIGHT)

    if local_count >= 2:
        score += CONFIDENCE_LOCAL_BONUS_FULL
    elif local_count == 1:
        score += CONFIDENCE_LOCAL_BONUS_PARTIAL

    if len(survivors) >= 3:
        values = [p.price_cents for p in survivors]
        mean = statistics.mean(values)
        if mean > 0:
            stdev = statistics.stdev(values) if len(values) > 1 else 0
            cv = stdev / mean
            if cv < 0.2:
                score += CONFIDENCE_TIGHT_CLUSTER
            elif cv < 0.4:
                score += CONFIDENCE_MEDIUM_CLUSTER
    elif len(survivors) == 2:
        # Two-sample cluster check. The CV-based path above needs ≥3 samples
        # for statistics.stdev to be meaningful, so 2-survivor analyses
        # previously got no cluster credit even when the two prices nearly
        # agreed. Here we use the simpler ratio test: two prices within 20%
        # of each other are informative corroboration.
        prices = sorted(p.price_cents for p in survivors)
        lo, hi = prices[0], prices[1]
        if lo > 0 and (hi / lo) < 1.2:
            score += CONFIDENCE_MEDIUM_CLUSTER

    return min(CONFIDENCE_MAX, int(score))


# ─── Public API: range computation ───────────────────────────────────────────

def compute_fair_range(prices: list[ExtractedPrice]) -> FairRange:
    """Aggregate ExtractedPrice records into a defensible market range.

    Raises ValueError if the evidence does not meet MIN_TRUSTED_DOMAINS.
    The caller is expected to surface this as an HTTP 503; we will not silently
    fabricate a range from thin evidence.
    """
    if not prices:
        raise ValueError(
            "No price records extracted from live search results. "
            "Cannot compute a market range without real evidence."
        )

    # Prefer TOTAL > UNKNOWN > LABOR/PARTS/HOURLY when deciding what to aggregate.
    # Line-item prices (parts alone) undervalue the service — if we have any
    # TOTAL records, drop the line-items. Otherwise, keep UNKNOWN since most
    # summary prices are classified that way.
    totals = [p for p in prices if p.price_type == PriceType.TOTAL]
    unknowns = [p for p in prices if p.price_type == PriceType.UNKNOWN]
    pool = totals or unknowns or prices

    survivors = _drop_outliers(pool)
    if not survivors:
        raise ValueError(
            "All price records were rejected as outliers. Retry with a more "
            "specific query."
        )

    distinct_trusted_domains = len({
        p.domain_root for p in survivors if p.trust_weight >= TRUST_TRUSTED
    })

    degraded = False
    if distinct_trusted_domains < MIN_TRUSTED_DOMAINS:
        cv: Optional[float] = None
        if len(survivors) > 1:
            vals = [p.price_cents for p in survivors]
            mean = statistics.mean(vals)
            if mean > 0:
                cv = statistics.stdev(vals) / mean

        can_degrade = (
            distinct_trusted_domains >= DEGRADED_MIN_TRUSTED
            and len(survivors) >= DEGRADED_MIN_SURVIVORS
            and cv is not None
            and cv <= DEGRADED_MAX_CV
        )
        if can_degrade:
            degraded = True
            logger.info(
                "Evidence degraded-mode: trusted=%d survivors=%d cv=%.2f — "
                "proceeding with confidence cap %d",
                distinct_trusted_domains, len(survivors), cv, DEGRADED_CONFIDENCE_CAP,
            )
        else:
            encountered = sorted({p.domain_root for p in survivors})
            logger.warning(
                "Insufficient trusted evidence: trusted=%d survivors=%d cv=%s "
                "domains=%s",
                distinct_trusted_domains, len(survivors),
                f"{cv:.2f}" if cv is not None else "n/a", encountered,
            )
            raise ValueError(
                f"Live pricing insufficient — needed {MIN_TRUSTED_DOMAINS} distinct "
                f"trusted sources, got {distinct_trusted_domains}. "
                "Retry with a more specific query or different geography."
            )

    # Weighted percentiles drive the range.
    pw = [(p.price_cents, p.effective_weight()) for p in survivors]
    fair_low = _weighted_percentile(pw, 0.25)
    fair_mid = _weighted_percentile(pw, 0.50)
    fair_high = _weighted_percentile(pw, 0.75)

    # Guard against degenerate ranges (e.g. all survivors have identical price).
    if fair_high < fair_low:
        fair_low, fair_high = fair_high, fair_low
    if fair_high == fair_low:
        # give a ±10% band so downstream verdict math stays meaningful
        spread = max(100, int(fair_mid * 0.1))
        fair_low = max(1, fair_mid - spread)
        fair_high = fair_mid + spread

    prices_only = [p.price_cents for p in survivors]
    std_dev = (
        int(statistics.stdev(prices_only))
        if len(prices_only) > 1
        else 0
    )

    confidence = _confidence_score(survivors)
    if degraded:
        confidence = min(confidence, DEGRADED_CONFIDENCE_CAP)

    return FairRange(
        fair_price_low=fair_low,
        fair_price_mid=fair_mid,
        fair_price_high=fair_high,
        confidence_score=confidence,
        data_points_count=len(survivors),
        trusted_count=sum(1 for p in survivors if p.trust_weight >= TRUST_TRUSTED),
        local_count=sum(1 for p in survivors if p.is_local),
        distinct_trusted_domains=distinct_trusted_domains,
        std_dev_cents=std_dev,
        sources=[p.to_dict() for p in survivors],
    )


# ─── Public API: verdict math ────────────────────────────────────────────────

def compute_verdict_math(
    fair_range: FairRange,
    quoted_price_cents: Optional[int],
) -> dict:
    """Compute verdict label + conservative/expected overpay from the range.

    Two overpay numbers are returned because there is no honest "single overpay
    number" when evidence spans a range:

    - conservative_overpay = max(0, quoted - fair_price_high)
        The amount the vendor is above even the most generous market comp.
        This is the number the user can defend in a negotiation without being
        accused of low-balling.

    - expected_overpay = max(0, quoted - fair_price_mid)
        The amount above the weighted median of comps. A fuller picture of
        what "most people pay" vs. what this vendor is charging.

    Both are returned in cents. Verdict label is based on `conservative_overpay`
    (benefit of the doubt, vendor-side). If no quoted_price is provided, we
    return the range with zero overpay and a "fair" placeholder label so the
    frontend can render the range without a verdict badge.
    """
    result = {
        "fair_price_low": fair_range.fair_price_low,
        "fair_price_mid": fair_range.fair_price_mid,
        "fair_price_high": fair_range.fair_price_high,
        "conservative_overpay": 0,
        "expected_overpay": 0,
        "overcharge_multiplier": 1.0,
        "verdict": "fair",
    }

    if quoted_price_cents is None or quoted_price_cents <= 0:
        return result

    result["quoted_price"] = quoted_price_cents
    result["conservative_overpay"] = max(0, quoted_price_cents - fair_range.fair_price_high)
    result["expected_overpay"] = max(0, quoted_price_cents - fair_range.fair_price_mid)

    if fair_range.fair_price_mid > 0:
        result["overcharge_multiplier"] = round(
            quoted_price_cents / fair_range.fair_price_mid, 2
        )

    ratio = quoted_price_cents / fair_range.fair_price_high if fair_range.fair_price_high else 1.0
    if ratio <= VERDICT_FAIR_CEILING:
        result["verdict"] = "fair"
    elif ratio <= VERDICT_HIGH_CEILING:
        result["verdict"] = "high"
    else:
        result["verdict"] = "overcharge"

    return result
