"""Database-agnostic UUID helpers.

SQLite can't bind uuid.UUID parameters — it needs strings.
Postgres with PG_UUID columns needs uuid.UUID objects.

All routers should use these helpers instead of raw str() or UUID() calls.
"""

import uuid as _uuid
from app.config import settings as _s


def _effective_is_sqlite() -> bool:
    return (_s.insforge_database_url or _s.database_url).startswith("sqlite")


def new_uuid():
    """Create a new UUID appropriate for the active DB.

    - SQLite: str(UUID)
    - Postgres: uuid.UUID
    """
    u = _uuid.uuid4()
    return str(u) if _effective_is_sqlite() else u


def to_db_uuid(value):
    """Coerce a string/UUID to the type the active DB expects.

    - SQLite: str
    - Postgres: uuid.UUID
    """
    if value is None:
        return None
    if _effective_is_sqlite():
        return str(value)
    if isinstance(value, _uuid.UUID):
        return value
    return _uuid.UUID(str(value))
