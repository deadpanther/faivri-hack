"""Alembic wiring smoke — the files load, env.py imports, and the head revision
covers every table declared on `Base.metadata`.

This catches the "I added a model but forgot the migration" class of bug before
it hits deploy. Running the actual `upgrade head` against a real Postgres is
out of scope for unit tests (no DB in CI here); we settle for checking that
the revision's upgrade() mentions each table name at least once.
"""

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.db import Base


BACKEND_DIR = Path(__file__).resolve().parent.parent
ALEMBIC_INI = BACKEND_DIR / "alembic.ini"
VERSIONS_DIR = BACKEND_DIR / "alembic" / "versions"


def test_alembic_ini_exists():
    assert ALEMBIC_INI.exists(), "alembic.ini must live at backend/alembic.ini"


def test_script_directory_loads():
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, f"expected single linear head, got {heads}"


def test_initial_revision_covers_all_model_tables():
    """Every table on Base.metadata must appear in the initial migration."""
    # Collect the migration source (fall through to any later revisions too).
    source = "\n".join(
        p.read_text() for p in sorted(VERSIONS_DIR.glob("*.py"))
    )
    declared_tables = {
        t for t in Base.metadata.tables.keys() if not t.startswith("sqlite_")
    }
    missing = [t for t in declared_tables if f'"{t}"' not in source]
    assert not missing, f"migration missing create_table for: {missing}"


def test_create_all_is_no_longer_invoked_in_lifespan():
    """Regression guard — DATA-P0-01 removed create_all; don't let it creep back.

    Checks for an actual call form (`.create_all(`) rather than the bare word
    so the explanatory comment in main.py doesn't trip the guard.
    """
    main_source = (BACKEND_DIR / "app" / "main.py").read_text()
    assert ".create_all(" not in main_source, (
        "app/main.py must not call Base.metadata.create_all — schema is Alembic-managed"
    )
