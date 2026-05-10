"""boost credits column + webhook failure DLQ

Revision ID: 0009_boost_and_dlq
Revises: 0008_billing_webhook
Create Date: 2026-04-23

Adds `profiles.boost_credits` — one-time purchases that let a user continue
analyzing past their monthly plan cap without upgrading the subscription.
Webhook credits this column on `order_created` for the Boost Pack variant.

Also adds `webhook_failures` — a dead-letter table where subscription
webhook handlers park payloads that crashed during processing. Today a
mid-commit exception returned 500 and the event vanished on the next
Lemon Squeezy retry window. The DLQ preserves the raw payload so an
operator can replay or investigate.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0009_boost_and_dlq"
down_revision: Union[str, None] = "0008_billing_webhook"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column(
            "boost_credits",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_table(
        "webhook_failures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("event_id", sa.String(), nullable=True),
        sa.Column("event_name", sa.String(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "idx_webhook_failures_unresolved",
        "webhook_failures",
        ["provider", "resolved_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_webhook_failures_unresolved", table_name="webhook_failures")
    op.drop_table("webhook_failures")
    op.drop_column("profiles", "boost_credits")
