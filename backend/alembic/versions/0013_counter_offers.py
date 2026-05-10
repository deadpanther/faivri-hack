"""counter_offers — durable record of vendor counter-offers per query.

Revision ID: 0013_counter_offers
Revises: 0012_stripe_columns
Create Date: 2026-04-28

Two motivations:

1. Cost. The /negotiate/counter endpoint calls an LLM on every request. If the
   user clicks "What if they say $X?" twice for the same number, we should not
   pay twice — short-window dedupe by (query_id, counter_offer_cents) returns
   the cached payload instead.

2. Persistence. Counter-offers are part of the negotiation transcript. Today
   they vanish the moment the response is returned. Storing them lets the
   frontend render a history strip ("here's what they offered, here's what
   you sent back, here's what they offered next") and gives us evidence for
   future product decisions.

The user_id column is nullable so anonymous /analyze flows can still record
counter-offers (same shared-handle model as negotiation_conversations).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0013_counter_offers"
down_revision: Union[str, None] = "0012_stripe_columns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "counter_offers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
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
        ),
        sa.Column("counter_offer_cents", sa.Integer(), nullable=False),
        sa.Column("original_target_cents", sa.Integer(), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "idx_counter_offers_query_created",
        "counter_offers",
        ["query_id", "created_at"],
    )
    op.create_index(
        "idx_counter_offers_dedupe",
        "counter_offers",
        ["query_id", "counter_offer_cents", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_counter_offers_dedupe", table_name="counter_offers")
    op.drop_index("idx_counter_offers_query_created", table_name="counter_offers")
    op.drop_table("counter_offers")
