"""HydraDB — add negotiation_sessions table

Revision ID: 0017_hydradb_negotiation_sessions
Revises: 0016_share_tokens
Create Date: 2026-05-02

The HydraDB memory layer (app/services/hydradb.py) needs a single home for
the *negotiation header* — walk-away ceiling, target offer, seller-tone
classification, and the running price-point timeline. Existing tables
(`queries`, `negotiation_conversations`, `counter_offers`) cover the raw
events; this table is the durable summary that Photon and the Memory
dashboard read from.

One row per `query_id`. JSONB `price_points` holds an append-only timeline
of every counter from either side, so the chart on /memory can render the
fluctuation curve without joining four tables at read time.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0017_hydradb_negotiation_sessions"
down_revision: Union[str, None] = "0016_share_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "negotiation_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
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
            nullable=False,
            unique=True,
        ),
        sa.Column("walk_away_cents", sa.Integer(), nullable=True),
        sa.Column("target_offer_cents", sa.Integer(), nullable=True),
        sa.Column("seller_tone", sa.String(length=32), nullable=True),
        sa.Column(
            "price_points",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_negotiation_sessions_user_recent",
        "negotiation_sessions",
        ["user_id", "last_seen_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_negotiation_sessions_user_recent",
        table_name="negotiation_sessions",
    )
    op.drop_table("negotiation_sessions")
