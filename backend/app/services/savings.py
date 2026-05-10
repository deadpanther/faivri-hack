"""Savings & streak math — shared by POST /feedback and GET /savings/profile.

All thresholds are in cents (USD). Keeping the level ladder in one place so the
feedback response and the profile page can never disagree about what "silver"
means.

Definitions (stable contract for the frontend):
  lifetime_saved   = sum(quoted_price - feedback_final_price) for rows where
                     the user paid less than quoted and gave feedback.
  potential_saved  = sum(quoted_price - fair_price_high) for overcharge/high
                     verdicts the user hasn't given feedback on yet.
  monthly_streak   = distinct overcharge/high verdicts this calendar month
                     where the user gave feedback (i.e. "dodged" overcharges).
  level            = highest tier whose threshold is <= lifetime_saved.
  milestone_unlocked = the level key that was just crossed by this feedback
                     call, or None if no threshold was crossed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Query as QueryModel


# Level ladder — (key, label, threshold_cents). Order matters: low → high.
LEVELS: list[tuple[str, str, int]] = [
    ("bronze", "Bronze Saver", 0),
    ("silver", "Silver Saver", 100_000),      # $1,000 saved
    ("gold", "Gold Saver", 500_000),          # $5,000 saved
    ("platinum", "Platinum Saver", 2_000_000),  # $20,000 saved
]


def _level_index_for_cents(saved_cents: int) -> int:
    """Return the index in LEVELS whose threshold is the highest <= saved."""
    idx = 0
    for i, (_key, _label, threshold) in enumerate(LEVELS):
        if saved_cents >= threshold:
            idx = i
    return idx


@dataclass
class LevelInfo:
    key: str
    label: str
    threshold_cents: int


def level_for_saved(saved_cents: int) -> LevelInfo:
    idx = _level_index_for_cents(saved_cents)
    key, label, threshold = LEVELS[idx]
    return LevelInfo(key=key, label=label, threshold_cents=threshold)


def next_level_for_saved(saved_cents: int) -> LevelInfo | None:
    idx = _level_index_for_cents(saved_cents)
    if idx >= len(LEVELS) - 1:
        return None
    key, label, threshold = LEVELS[idx + 1]
    return LevelInfo(key=key, label=label, threshold_cents=threshold)


def progress_to_next(saved_cents: int) -> int:
    """0-100 integer progress toward the next tier (100 when at cap)."""
    nxt = next_level_for_saved(saved_cents)
    if nxt is None:
        return 100
    current = level_for_saved(saved_cents)
    span = nxt.threshold_cents - current.threshold_cents
    if span <= 0:
        return 100
    earned = max(0, saved_cents - current.threshold_cents)
    return min(100, int((earned / span) * 100))


def crossed_threshold(previous_saved: int, new_saved: int) -> LevelInfo | None:
    """If `new_saved` crosses into a higher tier than `previous_saved`, return
    that newly-unlocked tier. Otherwise None. Used so the feedback response can
    trigger a one-time milestone celebration in the UI."""
    if new_saved <= previous_saved:
        return None
    prev_idx = _level_index_for_cents(previous_saved)
    new_idx = _level_index_for_cents(new_saved)
    if new_idx <= prev_idx:
        return None
    key, label, threshold = LEVELS[new_idx]
    return LevelInfo(key=key, label=label, threshold_cents=threshold)


# ─── DB aggregates ────────────────────────────────────────────────────────────

async def compute_lifetime_saved(db: AsyncSession, user_id: str) -> int:
    """Sum of (quoted - paid) over rows with feedback where paid < quoted."""
    stmt = select(
        func.coalesce(
            func.sum(QueryModel.quoted_price - QueryModel.feedback_final_price),
            0,
        )
    ).where(
        QueryModel.user_id == user_id,
        QueryModel.quoted_price.isnot(None),
        QueryModel.feedback_final_price.isnot(None),
        QueryModel.quoted_price > 0,
        QueryModel.feedback_final_price < QueryModel.quoted_price,
    )
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


async def compute_potential_saved(db: AsyncSession, user_id: str) -> int:
    """Sum of (quoted - fair_high) over overcharge verdicts without feedback."""
    stmt = select(
        func.coalesce(
            func.sum(QueryModel.quoted_price - QueryModel.fair_price_high),
            0,
        )
    ).where(
        QueryModel.user_id == user_id,
        QueryModel.verdict.in_(["overcharge", "high"]),
        QueryModel.feedback_final_price.is_(None),
        QueryModel.quoted_price.isnot(None),
        QueryModel.fair_price_high.isnot(None),
        QueryModel.quoted_price > QueryModel.fair_price_high,
    )
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


async def compute_total_queries(db: AsyncSession, user_id: str) -> int:
    stmt = select(func.count(QueryModel.id)).where(QueryModel.user_id == user_id)
    return int((await db.execute(stmt)).scalar() or 0)


async def compute_overcharges_found(db: AsyncSession, user_id: str) -> int:
    stmt = select(func.count(QueryModel.id)).where(
        QueryModel.user_id == user_id,
        QueryModel.verdict.in_(["overcharge", "high"]),
    )
    return int((await db.execute(stmt)).scalar() or 0)


async def compute_monthly_dodged(db: AsyncSession, user_id: str) -> int:
    """Distinct overcharge/high queries with feedback this calendar month."""
    now = datetime.utcnow()
    month_start = datetime(year=now.year, month=now.month, day=1)
    stmt = select(func.count(QueryModel.id)).where(
        and_(
            QueryModel.user_id == user_id,
            QueryModel.verdict.in_(["overcharge", "high"]),
            QueryModel.feedback_final_price.isnot(None),
            QueryModel.created_at >= month_start,
        )
    )
    return int((await db.execute(stmt)).scalar() or 0)
