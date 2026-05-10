"""profile_sessions table for the 2-device session cap

Revision ID: 0011_profile_sessions
Revises: 0010_student_discount
Create Date: 2026-04-24

Tracks one row per Clerk session id, so the auth layer can enforce a
MAX_ACTIVE_SESSIONS cap without bothering Clerk for a session list on
every request. `last_seen_at` is touched on every authenticated request
and drives the oldest-first revoke rule when a 3rd device logs in.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0011_profile_sessions"
down_revision: Union[str, None] = "0010_student_discount"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profile_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id"),
            nullable=False,
        ),
        sa.Column("clerk_session_id", sa.String(), nullable=False, unique=True),
        sa.Column("user_agent", sa.String(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "idx_profile_sessions_user_active",
        "profile_sessions",
        ["user_id", "revoked_at", "last_seen_at"],
    )
    op.create_index(
        "ix_profile_sessions_clerk_session_id",
        "profile_sessions",
        ["clerk_session_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_profile_sessions_clerk_session_id", table_name="profile_sessions")
    op.drop_index("idx_profile_sessions_user_active", table_name="profile_sessions")
    op.drop_table("profile_sessions")
