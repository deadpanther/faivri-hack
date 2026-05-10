"""student discount columns on profiles

Revision ID: 0010_student_discount
Revises: 0009_boost_and_dlq
Create Date: 2026-04-24

Adds `profiles.student_discount_until` and `profiles.student_email_hash`
so the .edu OTP verification flow can flip a profile into Scholar pricing
without touching the `plan` column. Plan ladder is also being trimmed from
four tiers (scout/signal/vector/command) to three (scout/signal/command)
in application code; this migration only adds the new Scholar fields.
Existing rows on the legacy `vector` plan are quietly remapped to `signal`
so nobody loses access mid-cycle.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "0010_student_discount"
down_revision: Union[str, None] = "0009_boost_and_dlq"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("student_discount_until", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "profiles",
        sa.Column("student_email_hash", sa.String(), nullable=True),
    )
    op.create_index(
        "idx_profiles_student_email_hash",
        "profiles",
        ["student_email_hash"],
    )
    # Legacy tier rename — Vector was the old middle tier. Merge it into
    # Signal (which now carries Vector's quota) so anyone on it keeps working.
    op.execute("UPDATE profiles SET plan = 'signal' WHERE plan = 'vector'")


def downgrade() -> None:
    op.drop_index("idx_profiles_student_email_hash", table_name="profiles")
    op.drop_column("profiles", "student_email_hash")
    op.drop_column("profiles", "student_discount_until")
