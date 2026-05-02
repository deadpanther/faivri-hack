"""initial schema — profiles, queries, pricing_knowledge, community_prices, vehicles

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-04-16

Hand-authored against the models in `app/models/db.py` at the time this
replaced `Base.metadata.create_all`. Subsequent schema changes should be added
as new revisions on top; never edit this file.

Operators deploying on top of an existing create_all database should run
`alembic stamp 0001_initial_schema` once, then `alembic upgrade head` thereafter.
Fresh databases run `alembic upgrade head` directly.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Enum names must match the ones declared in app/models/db.py, otherwise
# SQLAlchemy will try to create duplicates at model-bind time.
DOMAIN_VALUES = ("auto", "medical", "home", "legal")
VERDICT_VALUES = ("fair", "high", "overcharge")
CURRENCY_VALUES = ("INR", "USD")
COUNTRY_VALUES = ("IN", "US")


def _create_enums(bind) -> None:
    postgresql.ENUM(*DOMAIN_VALUES, name="domain_type").create(bind, checkfirst=True)
    postgresql.ENUM(*VERDICT_VALUES, name="verdict_type").create(bind, checkfirst=True)
    postgresql.ENUM(*CURRENCY_VALUES, name="currency_type").create(bind, checkfirst=True)
    postgresql.ENUM(*COUNTRY_VALUES, name="country_type").create(bind, checkfirst=True)


def _drop_enums(bind) -> None:
    for name in ("country_type", "currency_type", "verdict_type", "domain_type"):
        postgresql.ENUM(name=name).drop(bind, checkfirst=True)


def upgrade() -> None:
    bind = op.get_bind()
    _create_enums(bind)

    domain_type = postgresql.ENUM(*DOMAIN_VALUES, name="domain_type", create_type=False)
    verdict_type = postgresql.ENUM(*VERDICT_VALUES, name="verdict_type", create_type=False)
    currency_type = postgresql.ENUM(*CURRENCY_VALUES, name="currency_type", create_type=False)
    country_type = postgresql.ENUM(*COUNTRY_VALUES, name="country_type", create_type=False)

    op.create_table(
        "profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("clerk_user_id", sa.String(), nullable=False, unique=True),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("country", country_type, nullable=True),
        sa.Column("queries_this_month", sa.Integer(), server_default="0"),
        sa.Column("total_saved", sa.Integer(), server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("ix_profiles_clerk_user_id", "profiles", ["clerk_user_id"], unique=True)

    op.create_table(
        "queries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profiles.id"), nullable=True),
        sa.Column("domain", domain_type, nullable=False),
        sa.Column("input_text", sa.Text(), nullable=False),
        sa.Column("location_city", sa.String(), nullable=False),
        sa.Column("location_country", country_type, nullable=False),
        sa.Column("currency", currency_type, nullable=False),
        sa.Column("quoted_price", sa.Integer(), nullable=True),
        sa.Column("fair_price_low", sa.Integer(), nullable=True),
        sa.Column("fair_price_high", sa.Integer(), nullable=True),
        sa.Column("verdict", verdict_type, nullable=True),
        sa.Column("overcharge_multiplier", sa.Numeric(5, 2), nullable=True),
        sa.Column("confidence_score", sa.Integer(), nullable=True),
        sa.Column("data_points_count", sa.Integer(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("red_flags", postgresql.JSONB(), nullable=True),
        sa.Column("questions_to_ask", postgresql.JSONB(), nullable=True),
        sa.Column("negotiation_script", postgresql.JSONB(), nullable=True),
        sa.Column("sources_used", postgresql.JSONB(), nullable=True),
        sa.Column("llm_model_used", sa.String(), nullable=True),
        sa.Column("cost_cents", sa.Integer(), nullable=True),
        sa.Column("feedback_final_price", sa.Integer(), nullable=True),
        sa.Column("s2_token", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("idx_queries_user_history", "queries", ["user_id", "created_at"])
    op.create_index("ix_queries_s2_token", "queries", ["s2_token"])

    op.create_table(
        "pricing_knowledge",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("domain", domain_type, nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("item_name", sa.String(), nullable=False),
        sa.Column("item_description", sa.Text(), nullable=True),
        sa.Column("price_low", sa.Integer(), nullable=False),
        sa.Column("price_high", sa.Integer(), nullable=False),
        sa.Column("currency", currency_type, nullable=False),
        sa.Column("city", sa.String(), nullable=True),
        sa.Column("country", country_type, nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("confidence", sa.Integer(), server_default="80"),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index(
        "idx_pricing_lookup",
        "pricing_knowledge",
        ["domain", "country", "city", "category"],
    )

    op.create_table(
        "community_prices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profiles.id"), nullable=True),
        # DATA-P1-01: unique so duplicate feedback submits upsert in place.
        sa.Column(
            "query_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("queries.id"),
            nullable=True,
            unique=True,
        ),
        sa.Column("domain", domain_type, nullable=False),
        sa.Column("service_type", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price_paid", sa.Integer(), nullable=False),
        sa.Column("currency", currency_type, nullable=False),
        sa.Column("city", sa.String(), nullable=False),
        sa.Column("country", country_type, nullable=False),
        sa.Column("vendor_name", sa.String(), nullable=True),
        sa.Column("s2_token", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("idx_community_lookup", "community_prices", ["domain", "city", "country"])
    op.create_index("ix_community_prices_query_id", "community_prices", ["query_id"])
    op.create_index("ix_community_prices_s2_token", "community_prices", ["s2_token"])

    op.create_table(
        "vehicles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profiles.id"), nullable=False),
        sa.Column("make", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("mileage_km", sa.Integer(), nullable=True),
        sa.Column("nickname", sa.String(), nullable=True),
        sa.Column("country", country_type, nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()")),
    )
    op.create_index("idx_vehicles_user", "vehicles", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_vehicles_user", table_name="vehicles")
    op.drop_table("vehicles")

    op.drop_index("ix_community_prices_s2_token", table_name="community_prices")
    op.drop_index("ix_community_prices_query_id", table_name="community_prices")
    op.drop_index("idx_community_lookup", table_name="community_prices")
    op.drop_table("community_prices")

    op.drop_index("idx_pricing_lookup", table_name="pricing_knowledge")
    op.drop_table("pricing_knowledge")

    op.drop_index("ix_queries_s2_token", table_name="queries")
    op.drop_index("idx_queries_user_history", table_name="queries")
    op.drop_table("queries")

    op.drop_index("ix_profiles_clerk_user_id", table_name="profiles")
    op.drop_table("profiles")

    _drop_enums(op.get_bind())
