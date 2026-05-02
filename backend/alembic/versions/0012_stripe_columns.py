"""stripe_customer_id + stripe_subscription_id on profiles

Revision ID: 0012_stripe_columns
Revises: 0011_profile_sessions
Create Date: 2026-04-27

Stripe replaces Lemon Squeezy for payments. The old
`lemonsqueezy_subscription_id` column is left in place (no production data
to lose) — it'll be dropped in a follow-up migration once we're sure the
column is unused.

Both new columns are nullable + indexed. A user who only buys a one-time
Boost has a customer_id but no subscription_id; a user who cancels has
the subscription_id cleared back to NULL.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0012_stripe_columns"
down_revision: Union[str, None] = "0011_profile_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("stripe_customer_id", sa.String(), nullable=True),
    )
    op.add_column(
        "profiles",
        sa.Column("stripe_subscription_id", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_profiles_stripe_customer_id",
        "profiles",
        ["stripe_customer_id"],
    )
    op.create_index(
        "ix_profiles_stripe_subscription_id",
        "profiles",
        ["stripe_subscription_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_profiles_stripe_subscription_id", table_name="profiles")
    op.drop_index("ix_profiles_stripe_customer_id", table_name="profiles")
    op.drop_column("profiles", "stripe_subscription_id")
    op.drop_column("profiles", "stripe_customer_id")
