"""share_tokens — public capability tokens for shareable verdicts

Revision ID: 0016_share_tokens
Revises: 0015_purchase_vin
Create Date: 2026-04-30

Mints a row per "share this verdict" click; readers hit `/api/v1/share/{token}`
to pull a sanitized payload. Either `query_id` OR `purchase_id` is populated,
never both — both columns are nullable + indexed so the public read path can
range-scan on whichever one the writer set.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0016_share_tokens"
down_revision: Union[str, None] = "0015_purchase_vin"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "share_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("query_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("purchase_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["purchase_id"], ["purchase_analyses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["profiles.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "uq_share_tokens_token", "share_tokens", ["token"], unique=True,
    )
    op.create_index("idx_share_tokens_query", "share_tokens", ["query_id"])
    op.create_index("idx_share_tokens_purchase", "share_tokens", ["purchase_id"])
    op.create_index(
        "idx_share_tokens_owner", "share_tokens", ["owner_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_share_tokens_owner", table_name="share_tokens")
    op.drop_index("idx_share_tokens_purchase", table_name="share_tokens")
    op.drop_index("idx_share_tokens_query", table_name="share_tokens")
    op.drop_index("uq_share_tokens_token", table_name="share_tokens")
    op.drop_table("share_tokens")
