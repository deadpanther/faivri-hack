"""Used-car diligence engine — adjustments, safety tips, negotiation leverage.

A LLM-returned fair price range is a *baseline*; what people actually pay
turns on the deal-specific facts: title status, deferred maintenance, tires
half-bald, smoke on cold start. This module takes the buyer's diligence
answers and returns:

    1. A list of `Adjustment` items (penalties + credits in cents) to nudge
       the baseline range toward the deal-adjusted fair price.
    2. A `SafetyAdvice` block — always populated, contextually expanded —
       telling the buyer how to *not get scammed* during the transaction
       (meet at police station, verify VIN, never wire money, etc.).
    3. The top-3 negotiation leverage points the buyer should raise.

Heuristics, not science. Calibrated against real average labor + parts
prices for typical 5-15 yr-old cars; tune on real user feedback.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ─── Diligence schema ────────────────────────────────────────────────────────

# Canonical answer values for each free-form-ish question. We keep these
# explicit so the frontend and the adjustment table stay in lockstep.
SERVICE_CADENCE = {"regular", "occasional", "unknown", "documented"}
TIMING_BELT_STATUS = {"replaced", "overdue", "due_soon", "not_applicable", "unknown"}
WEAR_CONDITION = {"new", "good", "worn", "needs_replacement", "unknown"}
ACCIDENT_HISTORY = {"none", "minor", "major", "unknown"}
TITLE_STATUS = {"clean", "salvage", "rebuilt", "lemon", "unknown"}
SELLER_TYPE = {"private", "dealer", "unknown"}


@dataclass
class DiligenceAnswers:
    """Buyer's pre-purchase questions answered by/about the seller.

    Every field is optional — buyers may not have all the info, and the
    UI shouldn't force them to lie. Missing fields produce no adjustment
    (we don't penalize ignorance, just the absence of evidence).
    """

    # Service history
    oil_change_history: Optional[str] = None
    timing_belt_status: Optional[str] = None
    transmission_fluid_changed: Optional[bool] = None
    coolant_flush_done: Optional[bool] = None
    spark_plugs_replaced: Optional[bool] = None

    # Wear items
    brake_pads_condition: Optional[str] = None
    tires_condition: Optional[str] = None
    tires_age_years: Optional[int] = None
    battery_age_years: Optional[int] = None

    # History & flags
    accident_history: Optional[str] = None
    title_status: Optional[str] = None
    previous_owners: Optional[int] = None

    # Behavior signals
    smoking_on_start: Optional[bool] = None
    burning_oil: Optional[bool] = None
    has_modifications: Optional[bool] = None
    check_engine_history: Optional[bool] = None

    # Documentation
    has_service_records: Optional[bool] = None
    has_carfax: Optional[bool] = None

    # Seller context
    seller_type: Optional[str] = None
    reason_for_selling: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> "DiligenceAnswers":
        if not data or not isinstance(data, dict):
            return cls()
        # Accept only known fields — silently drop unknown keys so a
        # mistyped frontend payload can't poison the adjustment math.
        known = {f.name for f in cls.__dataclass_fields__.values()}
        return cls(**{k: v for k, v in data.items() if k in known})

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class Adjustment:
    """One row of the adjustment table — penalty or credit, with rationale."""

    kind: str  # "penalty" | "credit"
    label: str
    cents: int  # negative = penalty, positive = credit
    reason: str
    category: str  # service | wear | title | behavior | documentation


@dataclass
class SafetyAdvice:
    """Anti-scam advice, always returned, expanded based on context."""

    universal: list[str] = field(default_factory=list)
    contextual: list[str] = field(default_factory=list)
    scam_red_flags: list[str] = field(default_factory=list)


# ─── Adjustment computation ──────────────────────────────────────────────────

# Mileage thresholds in km for major service intervals (50k mi ≈ 80,000 km,
# 100k mi ≈ 160,000 km). Used cars in the US are sold in miles but our
# pipeline normalizes to km — keep both visible here for sanity reviews.
KM_PER_MILE = 1.609
MAJOR_SERVICE_50K_KM = 80_000
MAJOR_SERVICE_100K_KM = 160_000

# Per-item adjustment magnitudes in cents. Conservative on the credit side
# (don't pay people for theoretical maintenance), aggressive on the penalty
# side (deferred maintenance is what bites buyers the hardest).
PENALTY_NO_OIL_RECORDS = -50_000          # $500 — engine condition uncertainty
PENALTY_TIMING_BELT_OVERDUE = -100_000     # $1,000 — major service
PENALTY_TIMING_BELT_DUE = -50_000          # $500 — coming due
PENALTY_BRAKE_PADS = -40_000               # $400 — front brake job
PENALTY_TIRES_REPLACE = -80_000            # $800 — set of 4 mid-tier
PENALTY_TIRES_AGED_OUT = -50_000           # $500 — old rubber
PENALTY_BATTERY_OLD = -15_000              # $150 — basic battery
PENALTY_TRANSMISSION_NEVER = -30_000       # $300 — fluid + filter
PENALTY_SPARK_PLUGS_OVERDUE = -25_000      # $250 — labor-light job
PENALTY_COOLANT_NEVER = -15_000            # $150 — flush + fluid
PENALTY_50K_DEFERRED = -50_000             # $500 — bundle of 50k items
PENALTY_100K_DEFERRED = -100_000           # $1,000 — bundle of 100k items
PENALTY_SMOKES_ON_START = -200_000         # $2,000 — likely engine work
PENALTY_BURNS_OIL = -200_000               # $2,000 — engine wear
PENALTY_CHECK_ENGINE_HISTORY = -30_000     # $300 — diagnostic + likely repair
PENALTY_MULTI_OWNER_PCT = 0.05             # 5% off baseline

CREDIT_DOCUMENTED_OIL = 50_000             # $500 — confidence boost
CREDIT_TIMING_BELT_NEW = 80_000            # $800 — fresh major service
CREDIT_BRAKES_NEW = 20_000                 # $200
CREDIT_TIRES_NEW = 50_000                  # $500
CREDIT_FULL_DOCS = 30_000                  # $300 — Carfax + records


def compute_adjustments(
    diligence: DiligenceAnswers,
    asking_price_cents: int,
    mileage_km: int,
) -> list[Adjustment]:
    """Translate diligence answers into a list of price adjustments.

    Pure function — no IO, no LLM. Easy to unit-test and easy to explain
    to the user ("here's exactly why we knocked $1,800 off the baseline").
    """

    out: list[Adjustment] = []

    # ── Title / accident — biggest single levers ──
    if diligence.title_status in {"salvage", "lemon"}:
        out.append(Adjustment(
            kind="penalty",
            label="Salvage/lemon title",
            cents=-int(asking_price_cents * 0.30),
            reason="Salvage/lemon titles slash resale value 25–40%, can't get full-coverage insurance, financing usually unavailable.",
            category="title",
        ))
    elif diligence.title_status == "rebuilt":
        out.append(Adjustment(
            kind="penalty",
            label="Rebuilt title",
            cents=-int(asking_price_cents * 0.20),
            reason="Rebuilt titles take a 15–25% resale hit and complicate insurance.",
            category="title",
        ))

    if diligence.accident_history == "major":
        out.append(Adjustment(
            kind="penalty",
            label="Major accident history",
            cents=-int(asking_price_cents * 0.15),
            reason="Major-accident vehicles depreciate 10–20% faster and may carry hidden frame/structural damage.",
            category="title",
        ))
    elif diligence.accident_history == "minor":
        out.append(Adjustment(
            kind="penalty",
            label="Minor accident history",
            cents=-int(asking_price_cents * 0.06),
            reason="Even minor reported accidents knock 5–8% off comparable resale.",
            category="title",
        ))

    # ── Service history ──
    if diligence.oil_change_history == "regular" and diligence.has_service_records:
        out.append(Adjustment(
            kind="credit",
            label="Documented regular oil changes",
            cents=CREDIT_DOCUMENTED_OIL,
            reason="Documented oil-change cadence is the single best engine-longevity signal — worth a real premium.",
            category="documentation",
        ))
    elif diligence.oil_change_history in {"occasional", "unknown"} or (
        diligence.has_service_records is False
        and diligence.oil_change_history != "regular"
    ):
        out.append(Adjustment(
            kind="penalty",
            label="No oil-change records",
            cents=PENALTY_NO_OIL_RECORDS,
            reason="Without records, the engine's actually-maintained mileage is unknown — discount for risk.",
            category="service",
        ))

    if diligence.timing_belt_status == "overdue":
        out.append(Adjustment(
            kind="penalty",
            label="Timing belt overdue",
            cents=PENALTY_TIMING_BELT_OVERDUE,
            reason="Timing-belt replacement runs $700–$1,500 at a shop and a snap can total the engine.",
            category="service",
        ))
    elif diligence.timing_belt_status == "due_soon":
        out.append(Adjustment(
            kind="penalty",
            label="Timing belt due soon",
            cents=PENALTY_TIMING_BELT_DUE,
            reason="Timing belt within 10–15k km of recommended interval — budget the job.",
            category="service",
        ))
    elif diligence.timing_belt_status == "replaced":
        out.append(Adjustment(
            kind="credit",
            label="Timing belt replaced recently",
            cents=CREDIT_TIMING_BELT_NEW,
            reason="Recent timing belt is $800–$1,200 of work you don't have to pay for.",
            category="service",
        ))

    if diligence.transmission_fluid_changed is False:
        out.append(Adjustment(
            kind="penalty",
            label="Transmission fluid never changed",
            cents=PENALTY_TRANSMISSION_NEVER,
            reason="Old transmission fluid accelerates wear; service runs $200–$400.",
            category="service",
        ))

    if diligence.coolant_flush_done is False:
        out.append(Adjustment(
            kind="penalty",
            label="Coolant never flushed",
            cents=PENALTY_COOLANT_NEVER,
            reason="Old coolant can corrode the cooling system; flush is $100–$200.",
            category="service",
        ))

    if diligence.spark_plugs_replaced is False and mileage_km > MAJOR_SERVICE_50K_KM:
        out.append(Adjustment(
            kind="penalty",
            label="Spark plugs overdue",
            cents=PENALTY_SPARK_PLUGS_OVERDUE,
            reason="Plugs past their interval cause misfires and fuel-economy loss; replacement $150–$350.",
            category="service",
        ))

    # ── Wear items ──
    if diligence.brake_pads_condition == "needs_replacement":
        out.append(Adjustment(
            kind="penalty",
            label="Brake pads need replacement",
            cents=PENALTY_BRAKE_PADS,
            reason="Front brake job runs $300–$500.",
            category="wear",
        ))
    elif diligence.brake_pads_condition == "new":
        out.append(Adjustment(
            kind="credit",
            label="Brake pads new",
            cents=CREDIT_BRAKES_NEW,
            reason="Recent brake job is $200–$400 of work already done.",
            category="wear",
        ))

    if diligence.tires_condition == "needs_replacement":
        out.append(Adjustment(
            kind="penalty",
            label="Tires need replacement",
            cents=PENALTY_TIRES_REPLACE,
            reason="A set of 4 mid-tier tires installed runs $600–$1,200.",
            category="wear",
        ))
    elif diligence.tires_condition == "new":
        out.append(Adjustment(
            kind="credit",
            label="New tires",
            cents=CREDIT_TIRES_NEW,
            reason="Recent set of tires is $600+ of value already in the deal.",
            category="wear",
        ))
    elif (
        diligence.tires_age_years is not None
        and diligence.tires_age_years > 6
        and diligence.tires_condition != "new"
    ):
        out.append(Adjustment(
            kind="penalty",
            label="Tires aged out (>6 years)",
            cents=PENALTY_TIRES_AGED_OUT,
            reason="Rubber compound degrades past 6 years regardless of tread depth — replace for safety.",
            category="wear",
        ))

    if diligence.battery_age_years is not None and diligence.battery_age_years >= 4:
        out.append(Adjustment(
            kind="penalty",
            label="Battery near end of life",
            cents=PENALTY_BATTERY_OLD,
            reason="Most car batteries last 3–5 years; budget $120–$200 for replacement.",
            category="wear",
        ))

    # ── Major-service interval bundles (only if no records) ──
    if (
        mileage_km >= MAJOR_SERVICE_100K_KM
        and diligence.has_service_records is False
        and diligence.timing_belt_status not in {"replaced", "not_applicable"}
    ):
        out.append(Adjustment(
            kind="penalty",
            label="100k-mile major service likely deferred",
            cents=PENALTY_100K_DEFERRED,
            reason="100k-mile service (timing belt + water pump + plugs + fluids) runs $800–$1,500 if not already done.",
            category="service",
        ))
    elif (
        mileage_km >= MAJOR_SERVICE_50K_KM
        and diligence.has_service_records is False
    ):
        out.append(Adjustment(
            kind="penalty",
            label="50k-mile service likely deferred",
            cents=PENALTY_50K_DEFERRED,
            reason="Bundled 50k service (fluids, plugs, filters) costs $400–$800 if it wasn't done.",
            category="service",
        ))

    # ── Behavioral red flags ──
    if diligence.smoking_on_start:
        out.append(Adjustment(
            kind="penalty",
            label="Smokes on cold start",
            cents=PENALTY_SMOKES_ON_START,
            reason="Cold-start smoke usually means valve seals or head-gasket — repair often $2k+.",
            category="behavior",
        ))
    if diligence.burning_oil:
        out.append(Adjustment(
            kind="penalty",
            label="Burns oil between changes",
            cents=PENALTY_BURNS_OIL,
            reason="Oil consumption signals piston-ring or valve-seal wear — major engine work.",
            category="behavior",
        ))
    if diligence.check_engine_history:
        out.append(Adjustment(
            kind="penalty",
            label="Check-engine light history",
            cents=PENALTY_CHECK_ENGINE_HISTORY,
            reason="Cleared codes can mask intermittent issues — get a scan tool readout before buying.",
            category="behavior",
        ))
    if diligence.has_modifications:
        out.append(Adjustment(
            kind="penalty",
            label="Aftermarket modifications",
            cents=-int(asking_price_cents * 0.05),
            reason="Mods void powertrain warranties and reduce buyer pool on resale (~5% hit).",
            category="behavior",
        ))

    # ── Owner count ──
    if diligence.previous_owners is not None and diligence.previous_owners >= 4:
        out.append(Adjustment(
            kind="penalty",
            label="4+ previous owners",
            cents=-int(asking_price_cents * PENALTY_MULTI_OWNER_PCT),
            reason="High owner-turnover often signals a problem car or short ownership = poor maintenance.",
            category="title",
        ))

    # ── Documentation premium ──
    if diligence.has_carfax and diligence.has_service_records:
        out.append(Adjustment(
            kind="credit",
            label="Full documentation (Carfax + service records)",
            cents=CREDIT_FULL_DOCS,
            reason="Verifiable history reduces risk; documented cars sell faster and command a premium.",
            category="documentation",
        ))

    return out


# ─── Adjusted price math ─────────────────────────────────────────────────────

@dataclass
class AdjustedPricing:
    """Final negotiation-ready numbers after applying adjustments."""

    baseline_low: int
    baseline_high: int
    adjustment_total: int  # sum of all adjustments in cents (signed)
    adjusted_low: int      # baseline_low + adjustment_total (floor 0)
    adjusted_high: int     # baseline_high + adjustment_total (floor 0)
    adjusted_mid: int
    target_offer: int      # what to actually offer
    opening_offer: int     # 8–10% below target — first counter
    walk_away_above: int   # >5% above adjusted_high → walk away
    overpay_amount: int    # asking - adjusted_high (positive = overpaying)
    asking_price: int
    asking_vs_baseline_pct: float


def compute_adjusted_pricing(
    baseline_low_cents: int,
    baseline_high_cents: int,
    asking_price_cents: int,
    adjustments: list[Adjustment],
    maintenance_estimate_cents: int = 0,
) -> AdjustedPricing:
    """Apply adjustments to baseline range; produce negotiation-ready numbers.

    Earlier versions anchored the target on the *midpoint* of the adjusted
    range. When asking sat near the top of that range, target ≈ asking and
    the playbook offered no real room — buyers showed us $6,997 ask /
    $6,923 target, which is not negotiation. New rules:

    * Anchor in the **lower third** of the fair range, not the middle.
    * Each diligence concern (penalty) tilts the anchor *further* toward
      the floor — more concerns = more aggressive ask.
    * **Always** keep the target a meaningful distance below asking — the
      bigger of $500, 5% of asking, or *half the projected 12-month
      maintenance burden*. The maintenance floor is what was missing for
      old/high-mileage cars: a $7k Accord with $2k of upcoming maintenance
      should target ≥ $1k below asking, not $500.
    * If asking is below `adjusted_low`, the deal is already good and we
      don't push lower; target = asking.
    * If asking is above `adjusted_high`, target caps at `adjusted_high`
      (top of fair). The "overpay_amount" carries the rest of the story.
    """

    adjustment_total = sum(a.cents for a in adjustments)

    adjusted_low = max(0, baseline_low_cents + adjustment_total)
    adjusted_high = max(adjusted_low, baseline_high_cents + adjustment_total)
    adjusted_mid = (adjusted_low + adjusted_high) // 2

    range_size = max(0, adjusted_high - adjusted_low)
    penalty_count = sum(1 for a in adjustments if a.kind == "penalty")
    walk_away_multiplier = 1.03 if penalty_count > 0 else 1.05

    # Preserve legacy baseline behavior for "clean" cars so guidance doesn't
    # oscillate across releases: no penalties + no maintenance estimate keeps
    # the target anchored at the midpoint. As concerns pile up, shift toward
    # the floor for stronger negotiation posture.
    if penalty_count == 0 and maintenance_estimate_cents <= 0:
        range_target = adjusted_mid
    else:
        if penalty_count >= 3:
            anchor_pct = 0.05
        elif penalty_count == 2:
            anchor_pct = 0.15
        elif penalty_count == 1:
            anchor_pct = 0.25
        else:
            anchor_pct = 0.33
        range_target = adjusted_low + int(range_size * anchor_pct)

    # Min discount: never offer within $500/5%/half-of-projected-maintenance
    # of asking. The maintenance term is what makes high-mileage / old-car
    # negotiation honest — buyer is about to spend that money post-purchase,
    # so seller should eat half of it on price.
    min_discount = max(
        50_000,
        int(asking_price_cents * 0.05),
        int(maintenance_estimate_cents * 0.5),
    )

    if asking_price_cents <= adjusted_low and asking_price_cents > 0:
        # Already a steal — accept near asking, hold a small buffer for
        # surprises uncovered at inspection.
        target_offer = asking_price_cents
        opening_offer = max(0, int(asking_price_cents * 0.97))
        walk_away_above = int(asking_price_cents * 1.05)
    elif asking_price_cents > adjusted_high:
        # Overpriced. Target capped at top of fair AND at the
        # min-discount floor below asking — whichever is lower. The
        # floor (driven by projected maintenance) is what makes
        # high-mileage cars actually negotiable: a $7k ask with $2.4k
        # of upcoming maintenance now targets ~$5.8k, not $6.6k.
        target_offer = min(adjusted_high, asking_price_cents - min_discount)
        target_offer = max(target_offer, adjusted_low)
        opening_offer = max(int(adjusted_low * 0.95), int(target_offer * 0.92))
        walk_away_above = int(adjusted_high * walk_away_multiplier)
    else:
        # Inside fair range. Lower-third anchor, plus the meaningful-discount
        # floor so target never collapses to ~asking.
        target_offer = min(range_target, asking_price_cents - min_discount)
        target_offer = max(target_offer, adjusted_low)
        opening_offer = max(int(adjusted_low * 0.95), int(target_offer * 0.92))
        walk_away_above = int(adjusted_high * walk_away_multiplier)

    overpay_amount = max(0, asking_price_cents - adjusted_high)

    baseline_mid = (baseline_low_cents + baseline_high_cents) / 2 if baseline_high_cents else 1
    asking_vs_baseline_pct = (asking_price_cents / baseline_mid) if baseline_mid else 1.0

    return AdjustedPricing(
        baseline_low=baseline_low_cents,
        baseline_high=baseline_high_cents,
        adjustment_total=adjustment_total,
        adjusted_low=adjusted_low,
        adjusted_high=adjusted_high,
        adjusted_mid=adjusted_mid,
        target_offer=target_offer,
        opening_offer=opening_offer,
        walk_away_above=walk_away_above,
        overpay_amount=overpay_amount,
        asking_price=asking_price_cents,
        asking_vs_baseline_pct=asking_vs_baseline_pct,
    )


# ─── Safety advice ───────────────────────────────────────────────────────────

# These are universal — every used-car buyer should know them. Even 5-star
# Carfax cars get stolen + curbstoned + odometer-rolled.
UNIVERSAL_SAFETY_TIPS = [
    "Meet in a busy public place — bank lobby, police-station parking lot, or a store parking lot with cameras. Many police stations have dedicated 'safe exchange zones'.",
    "Bring a friend — never go alone, especially carrying cash. Two pairs of eyes catch 2x the issues.",
    "Verify the VIN matches in 3 places: title, dashboard (driver's side, visible through windshield), and door-jamb sticker. If any don't match, walk.",
    "Run the VIN on the free NICB VINCheck (nicb.org/vincheck) for theft + total-loss history, and NHTSA recalls (nhtsa.gov/recalls).",
    "Get a $100–$150 pre-purchase inspection from an independent mechanic — not the seller's mechanic. This single step saves buyers ~$1,500 on average.",
    "Test drive: 30+ minutes minimum. Highway (60+ mph), city stop-and-go, parking maneuvers, hard brake (in safe spot). Listen for clunks, vibration, transmission slip.",
    "Never wire money, send crypto, or use Zelle/Venmo to a stranger. Pay by cashier's check at the buyer's bank in person, or do the title transfer at a DMV/AAA.",
    "Verify the seller is actually the owner: their ID name must match the title name. Snap photos of both. If they say 'I'm selling for a friend', it's likely a curbstoner — walk.",
    "Get a written, signed bill of sale: date, full price, VIN, both names + addresses, 'sold as-is'. Keep your copy.",
    "Check the title for liens — a lien holder's name in the box means you can't legally take ownership until they're paid off.",
]


def compute_safety_advice(
    diligence: DiligenceAnswers,
    asking_price_cents: int,
    baseline_low_cents: int,
    baseline_high_cents: int,
) -> SafetyAdvice:
    """Anti-scam + safe-transaction advice. Universal tips always shown.

    Contextual tips fire only when a relevant signal is present. We prefer
    to over-warn — the cost of one extra paragraph the user skims is much
    less than the cost of a stolen-car / curbstoner deal going through.
    """

    contextual: list[str] = []
    scam_red_flags: list[str] = []

    # Title-driven warnings
    if diligence.title_status in {"salvage", "rebuilt"}:
        contextual.append(
            "Title is salvage/rebuilt: many insurers won't write full coverage, "
            "and most banks won't finance. Verify your insurance agent will cover it BEFORE you commit."
        )
        scam_red_flags.append(
            "If the seller is hiding or evasive about title status, walk away. "
            "Title-washing across state lines is a real scam — pull the VIN history yourself."
        )
    if diligence.title_status == "lemon":
        contextual.append(
            "Lemon-law buyback: legally must be disclosed and stamped on the title. "
            "Resale value is permanently impaired by 30–50%."
        )

    # Suspicious price → curbstoner / salvage / rolled-back / stolen
    if baseline_high_cents > 0:
        ask_vs_base = asking_price_cents / ((baseline_low_cents + baseline_high_cents) / 2)
        if ask_vs_base < 0.65:
            scam_red_flags.append(
                "Asking price is more than 35% below comparable market — this is the #1 sign of a "
                "scam (stolen car, salvage hidden, odometer rollback, or curbstoner). "
                "Demand the title in seller's name + run the VIN before driving anywhere."
            )
        elif ask_vs_base < 0.80:
            scam_red_flags.append(
                "Asking is 20%+ below market — possible but uncommon for a clean car. "
                "Pre-purchase inspection is mandatory; have the mechanic confirm odometer plausibility from wear patterns."
            )

    # Seller-type advice
    if diligence.seller_type == "private":
        contextual.append(
            "Private-party sale: do the title-transfer paperwork at a DMV, AAA office, or notary — "
            "never at the seller's home. Get the title signed in front of a witness."
        )
    elif diligence.seller_type == "dealer":
        contextual.append(
            "Dealer sale: ask for the doc-fee breakdown in writing before you sit down. "
            "Most states cap doc fees; anything above $500 is negotiable. "
            "Refuse: VIN-etching add-ons, bogus 'protection packages', forced extended warranties."
        )

    # Behavior / inspection-related
    if diligence.smoking_on_start or diligence.burning_oil:
        contextual.append(
            "You flagged smoke or oil consumption — get a compression test and leak-down test "
            "during the pre-purchase inspection. Cost ~$100, finding could save $3k+."
        )
    if diligence.check_engine_history:
        contextual.append(
            "Check-engine history: bring a $25 OBD-II scanner (or use seller's mechanic) and read "
            "current + pending codes BEFORE you commit. Cleared codes often return within 100 miles."
        )

    if diligence.previous_owners is not None and diligence.previous_owners >= 4:
        contextual.append(
            "Many previous owners: each turnover usually means short tenure → poor maintenance. "
            "Demand documented service intervals, not just verbal claims."
        )

    if diligence.has_carfax is False and diligence.seller_type != "dealer":
        contextual.append(
            "No Carfax / AutoCheck: pull one yourself ($25–$45). Don't accept the seller's printout — "
            "PDF screenshots get edited."
        )

    # Universal scam patterns even when no specific signal triggered them
    if not scam_red_flags:
        scam_red_flags.append(
            "Common scams to refuse: 'shipping required, can't show in person', "
            "'send a deposit to hold it', 'pay via gift cards/wire', "
            "'I'm overseas, my brother will deliver it'. All instant walk-aways."
        )

    return SafetyAdvice(
        universal=list(UNIVERSAL_SAFETY_TIPS),
        contextual=contextual,
        scam_red_flags=scam_red_flags,
    )


# ─── Negotiation leverage ────────────────────────────────────────────────────

def compute_negotiation_script(
    asking_price_cents: int,
    target_offer_cents: int,
    opening_offer_cents: int,
    walk_away_above_cents: int,
    leverage: list[dict],
    currency_symbol: str = "$",
) -> list[dict]:
    """Turn-by-turn back-and-forth a buyer can rehearse before the call.

    Returns chat-bubble timeline: opener, expected pushback, counter,
    meet-in-the-middle, close, and a walk-away fallback. Buyer turns cite
    the top 1–2 leverage points so the script feels grounded, not generic.
    Money is rendered in dollars (not cents) for readability.
    """

    def fmt(cents: int) -> str:
        return f"{currency_symbol}{cents / 100:,.0f}"

    top_levers = leverage[:2]
    primary = top_levers[0]["label"] if top_levers else None
    secondary = top_levers[1]["label"] if len(top_levers) > 1 else None
    primary_pt = top_levers[0]["talking_point"] if top_levers else None

    leverage_phrase = ""
    if primary and secondary:
        leverage_phrase = f"the {primary.lower()} and {secondary.lower()}"
    elif primary:
        leverage_phrase = f"the {primary.lower()}"

    midpoint = (opening_offer_cents + target_offer_cents) // 2

    turns: list[dict] = []

    turns.append({
        "speaker": "buyer",
        "phase": "opening",
        "title": "Open with your evidence-backed offer",
        "script": (
            f"Thanks for showing me the car. Based on the listing and what comparable cars are selling for, "
            f"I want to be upfront — I can do {fmt(opening_offer_cents)} today. "
            + (
                f"The biggest factor for me is {leverage_phrase}: {primary_pt}"
                if primary_pt
                else "I've cross-checked recent sold listings to land on that number."
            )
        ),
    })

    turns.append({
        "speaker": "seller",
        "phase": "pushback",
        "title": "Expected pushback",
        "script": (
            f"That's a lot lower than I'm asking. I'm at {fmt(asking_price_cents)} — I've already had other interest "
            "and I think that's a fair price for the car."
        ),
    })

    turns.append({
        "speaker": "buyer",
        "phase": "counter",
        "title": "Hold your line, name the cost they'll have to absorb",
        "script": (
            "I hear you, but I'm not pulling that number out of thin air. "
            + (
                f"Specifically — {primary_pt} "
                if primary_pt
                else ""
            )
            + f"That's real money I'll spend after I drive away, so it has to come off the price. "
            f"I can stretch to {fmt(midpoint)} but that's where my budget tops out responsibly."
        ),
    })

    turns.append({
        "speaker": "seller",
        "phase": "compromise",
        "title": "Likely compromise",
        "script": (
            f"Look — I can't go all the way down there. The lowest I'd consider is somewhere around "
            f"{fmt((asking_price_cents + target_offer_cents) // 2)}."
        ),
    })

    turns.append({
        "speaker": "buyer",
        "phase": "close",
        "title": "Meet in the middle and close",
        "script": (
            f"Let's split the difference and call it {fmt(target_offer_cents)} — out the door, "
            "I bring a cashier's check and we do the title at the DMV. "
            "If we're aligned on that number, I'm ready to lock it in today."
        ),
    })

    turns.append({
        "speaker": "buyer",
        "phase": "walk_away",
        "title": "If they refuse to budge below your walk-away",
        "script": (
            f"If you can't go below {fmt(walk_away_above_cents)}, I understand — but I'd be paying more than the "
            "market supports. Take my number and reach out if it doesn't sell — I'm a serious buyer at the right price."
        ),
    })

    return turns


def top_negotiation_levers(adjustments: list[Adjustment], limit: int = 3) -> list[dict]:
    """Pick the top-N most valuable penalty items to use in negotiation.

    Penalties only — credits are reasons to *agree* to seller's price, not
    leverage to push it down. Sort by absolute cents impact descending so
    the buyer leads with the biggest dollar items in conversation.
    """

    penalties = [a for a in adjustments if a.kind == "penalty"]
    penalties.sort(key=lambda a: a.cents)  # most negative first
    return [
        {
            "label": a.label,
            "cents_impact": a.cents,
            "talking_point": a.reason,
            "category": a.category,
        }
        for a in penalties[:limit]
    ]
