"""extension_device_tokens — long-lived bearer tokens for the Chrome extension.

Revision ID: 0014_extension_device_tokens
Revises: 0013_counter_offers
Create Date: 2026-04-29

Adds two tables that together implement the extension's pairing flow:

- `extension_device_tokens` stores hashed long-lived bearer tokens issued
  to specific browser installs after the user pairs from a signed-in
  faivri.com session. The raw token is `fvt_<32 url-safe bytes>`; only the
  sha256 hash is persisted so a database leak doesn't grant API access.

- `extension_pair_codes` is the short-lived rendezvous table used by the
  pairing handshake. The extension creates a row with a random code,
  opens https://faivri.com/extension/link?code=<code> in a tab, the
  signed-in web app PUTs the user's clerk_user_id onto the row, and then
  the extension polls and exchanges the code for a device token.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0014_extension_device_tokens"
down_revision: Union[str, None] = "0013_counter_offers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "extension_device_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("label", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "idx_extension_tokens_user_active",
        "extension_device_tokens",
        ["user_id", "revoked_at"],
    )
    op.create_index(
        "ix_extension_tokens_token_hash",
        "extension_device_tokens",
        ["token_hash"],
        unique=True,
    )

    op.create_table(
        "extension_pair_codes",
        sa.Column("code", sa.String(length=64), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("device_token_hash", sa.String(length=128), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("paired_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "idx_extension_pair_codes_expires",
        "extension_pair_codes",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_extension_pair_codes_expires", table_name="extension_pair_codes")
    op.drop_table("extension_pair_codes")
    op.drop_index("ix_extension_tokens_token_hash", table_name="extension_device_tokens")
    op.drop_index("idx_extension_tokens_user_active", table_name="extension_device_tokens")
    op.drop_table("extension_device_tokens")
