"""community_prices canonical service fingerprint (LIVE-P1-10)

Revision ID: 0003_community_canonical_service
Revises: 0002_purchase_analyses
Create Date: 2026-04-16

Adds `canonical_service` + `service_fingerprint` columns so community rows can
be clustered by normalized service key instead of raw user phrasing. Existing
rows keep `NULL` for both columns; the community loader falls back to the
legacy token-overlap matcher when fingerprint is null, so no backfill is
required to deploy.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0003_community_canonical_service"
down_revision: Union[str, None] = "0002_purchase_analyses"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "community_prices",
        sa.Column("canonical_service", sa.String(), nullable=True),
    )
    op.add_column(
        "community_prices",
        sa.Column("service_fingerprint", sa.String(), nullable=True),
    )
    op.create_index(
        "idx_community_prices_service_fingerprint",
        "community_prices",
        ["service_fingerprint"],
    )


def downgrade() -> None:
    op.drop_index(
        "idx_community_prices_service_fingerprint",
        table_name="community_prices",
    )
    op.drop_column("community_prices", "service_fingerprint")
    op.drop_column("community_prices", "canonical_service")
