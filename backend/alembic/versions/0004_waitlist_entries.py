"""waitlist_entries table

Revision ID: 0004_waitlist_entries
Revises: 0003_community_canonical_service
Create Date: 2026-04-16

Landing page waitlist signups. Email is the natural unique key.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0004_waitlist_entries"
down_revision: Union[str, None] = "0003_community_canonical_service"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "waitlist_entries",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("email", name="uq_waitlist_entries_email"),
    )
    op.create_index(
        "ix_waitlist_entries_email", "waitlist_entries", ["email"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_waitlist_entries_email", table_name="waitlist_entries")
    op.drop_table("waitlist_entries")
