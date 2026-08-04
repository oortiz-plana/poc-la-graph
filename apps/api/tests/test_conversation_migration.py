from __future__ import annotations

from pathlib import Path

import sqlalchemy as sa
from _pytest.monkeypatch import MonkeyPatch
from alembic import command
from alembic.config import Config


def test_private_conversation_migration_invalidates_legacy_rows(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    monkeypatch.delenv("CONVERSATION_DATABASE_URL", raising=False)
    database = tmp_path / "migration.db"
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{database}")
    command.upgrade(config, "20260803_0002")

    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO conversations "
                "(id, project_id, created_at, updated_at) "
                "VALUES ('legacy', 'project', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
    command.upgrade(config, "head")

    inspector = sa.inspect(engine)
    columns = {
        column["name"]: column for column in inspector.get_columns("conversations")
    }
    indexes = {index["name"] for index in inspector.get_indexes("conversations")}
    with engine.connect() as connection:
        count = connection.scalar(sa.text("SELECT COUNT(*) FROM conversations"))
    engine.dispose()

    assert count == 0
    assert columns["created_by"]["nullable"] is False
    assert columns["updated_at"]["nullable"] is False
    assert {"name", "archived_at"}.issubset(columns)
    assert "ix_conversations_updated_at" in indexes
    assert "ix_conversations_owner_project_archive_updated_id" in indexes
