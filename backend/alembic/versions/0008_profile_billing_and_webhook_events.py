"""profile billing columns + webhook idempotency table

Revision ID: 0008_billing_webhook
Revises: 0007_listing_watches
Create Date: 2026-04-18

Adds the three billing columns the `Profile` ORM model has been declaring
since the Lemon Squeezy integration shipped — they were never actually
migrated, so a fresh `alembic upgrade head` would crash on the first
/analyze call (`quota.check_and_consume` reads `profile.plan`).

Also introduces `webhook_events` so subscription webhook handlers can
dedupe by event id — a retry after a 5xx must not apply the same plan
transition twice. The row is written inside the same transaction as the
profile mutation so either both land or neither does.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0008_billing_webhook"
down_revision: Union[str, None] = "0007_listing_watches"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column(
            "plan",
            sa.String(),
            nullable=False,
            server_default=sa.text("'scout'"),
        ),
    )
    op.add_column(
        "profiles",
        sa.Column("usage_reset_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "profiles",
        sa.Column(
            "lemonsqueezy_subscription_id", sa.String(), nullable=True
        ),
    )
    op.create_index(
        "idx_profiles_lemonsqueezy_subscription",
        "profiles",
        ["lemonsqueezy_subscription_id"],
    )

    op.create_table(
        "webhook_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("event_name", sa.String(), nullable=True),
        sa.Column("payload", postgresql.JSONB(), nullable=True),
        sa.Column(
            "received_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("provider", "event_id", name="uq_webhook_events_provider_event"),
    )
    op.create_index(
        "idx_webhook_events_received",
        "webhook_events",
        ["provider", "received_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_webhook_events_received", table_name="webhook_events")
    op.drop_table("webhook_events")
    op.drop_index(
        "idx_profiles_lemonsqueezy_subscription", table_name="profiles"
    )
    op.drop_column("profiles", "lemonsqueezy_subscription_id")
    op.drop_column("profiles", "usage_reset_at")
    op.drop_column("profiles", "plan")
