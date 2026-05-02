"""add retail value to domain_type enum

Revision ID: 0005_add_retail_domain
Revises: 0004_waitlist_entries
Create Date: 2026-04-17

Adds "retail" to the domain_type PG enum so queries about physical goods
(Amazon / Walmart / Costco / Best Buy / eBay / Facebook Marketplace) can
persist alongside the existing auto, medical, home, legal domains.

ALTER TYPE ... ADD VALUE cannot run inside a transaction, so the migration
uses autocommit_block().
"""

from typing import Sequence, Union

from alembic import op


revision: str = "0005_add_retail_domain"
down_revision: Union[str, None] = "0004_waitlist_entries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE domain_type ADD VALUE IF NOT EXISTS 'retail'")


def downgrade() -> None:
    # Removing a value from a PG enum in use requires recreating the type and
    # rewriting every column that references it. Not worth the blast radius for
    # a downgrade that should never run in prod.
    pass
