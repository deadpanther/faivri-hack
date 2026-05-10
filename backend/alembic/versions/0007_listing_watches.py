"""add listing_watches table

Revision ID: 0007_listing_watches
Revises: 0006_negotiation_conversations
Create Date: 2026-04-18

Persistence for Extension Pro's Stale-Listing Alerts. Each row is a single
listing the user has asked to watch. A background worker (out of scope for
the initial ship) scrapes the listing periodically via Firecrawl, compares
against `last_known_price_cents`, and fires a notification when the price
drops or the listing crosses the domain median age.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0007_listing_watches"
down_revision: Union[str, None] = "0006_negotiation_conversations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "listing_watches",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id"),
            nullable=True,
        ),
        sa.Column(
            "query_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("queries.id"),
            nullable=True,
        ),
        sa.Column("listing_url", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=True),
        sa.Column("fair_high_cents", sa.Integer(), nullable=True),
        sa.Column("last_known_price_cents", sa.Integer(), nullable=True),
        sa.Column("initial_risk_score", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.String(),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("next_check_at", sa.DateTime(), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=True,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_listing_watches_user",
        "listing_watches",
        ["user_id", "created_at"],
    )
    op.create_index(
        "idx_listing_watches_next_check",
        "listing_watches",
        ["status", "next_check_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_listing_watches_next_check",
        table_name="listing_watches",
    )
    op.drop_index(
        "idx_listing_watches_user",
        table_name="listing_watches",
    )
    op.drop_table("listing_watches")
