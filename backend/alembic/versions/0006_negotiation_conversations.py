"""add negotiation_conversations table

Revision ID: 0006_negotiation_conversations
Revises: 0005_add_retail_domain
Create Date: 2026-04-17

Persistence for the conversational negotiation coach. Each row is a single
chat session keyed by (query_id, session_id). The extension generates
session_id client-side so a user can negotiate with multiple sellers on the
same verdict in parallel. Messages are stored as a JSONB array of
{role, content, at} turns — append-only on the server side.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0006_negotiation_conversations"
down_revision: Union[str, None] = "0005_add_retail_domain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "negotiation_conversations",
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
            nullable=False,
        ),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column(
            "messages",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("last_suggested_price", sa.Integer(), nullable=True),
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
        "idx_negotiation_conversations_query",
        "negotiation_conversations",
        ["query_id", "session_id"],
        unique=True,
    )
    op.create_index(
        "idx_negotiation_conversations_user",
        "negotiation_conversations",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_negotiation_conversations_user",
        table_name="negotiation_conversations",
    )
    op.drop_index(
        "idx_negotiation_conversations_query",
        table_name="negotiation_conversations",
    )
    op.drop_table("negotiation_conversations")
