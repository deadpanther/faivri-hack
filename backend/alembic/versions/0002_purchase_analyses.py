"""purchase_analyses — durable persistence for used-car purchase analysis results

Revision ID: 0002_purchase_analyses
Revises: 0001_initial_schema
Create Date: 2026-04-16

FE-P1-02: the purchase flow previously encoded the full analysis payload into
the URL query string on client-side navigation. One refresh, share link, or
back-button and the result evaporated. We now persist to Postgres and hand the
frontend a UUID.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0002_purchase_analyses"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    country_type = postgresql.ENUM(
        "IN", "US", name="country_type", create_type=False
    )

    op.create_table(
        "purchase_analyses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id"),
            nullable=True,
        ),
        sa.Column("make", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("mileage_km", sa.Integer(), nullable=False),
        sa.Column("asking_price", sa.Integer(), nullable=False),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("country", country_type, nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index(
        "idx_purchase_analyses_user",
        "purchase_analyses",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_purchase_analyses_user", table_name="purchase_analyses")
    op.drop_table("purchase_analyses")
