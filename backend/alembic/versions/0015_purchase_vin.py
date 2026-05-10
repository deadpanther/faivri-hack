"""purchase_analyses — add vin column for VIN-based used-car lookups

Revision ID: 0015_purchase_vin
Revises: 0014_extension_device_tokens
Create Date: 2026-04-29

The Used Cars feature lets a buyer search by VIN (or upload a listing
screenshot we OCR into a VIN). We persist VIN at the top level so the
history view and Carfax-style integrations can range-scan on it without
unpacking JSONB. Diligence answers and adjustment audit live inside the
existing `payload` JSONB — those are denormalized read-mostly state.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0015_purchase_vin"
down_revision: Union[str, None] = "0014_extension_device_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "purchase_analyses",
        sa.Column("vin", sa.String(length=17), nullable=True),
    )
    op.create_index(
        "idx_purchase_analyses_vin",
        "purchase_analyses",
        ["vin"],
    )


def downgrade() -> None:
    op.drop_index("idx_purchase_analyses_vin", table_name="purchase_analyses")
    op.drop_column("purchase_analyses", "vin")
