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


def test_file_lifecycle_migration_backfills_active_and_draft_files(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    monkeypatch.delenv("CONVERSATION_DATABASE_URL", raising=False)
    database = tmp_path / "file-lifecycle.db"
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{database}")
    command.upgrade(config, "20260804_0003")

    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO projects "
                "(id, name, state, creator_subject, creator_name, created_at, "
                "updated_at, active_snapshot_id, active_graph_version, "
                "active_document_count, generation) VALUES "
                "('project', 'Trial', 'ready', 'subject', 'Editor', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active', 'v1', 1, 1)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO project_snapshots (id, project_id, status, created_at) "
                "VALUES ('active', 'project', 'active', CURRENT_TIMESTAMP), "
                "('draft', 'project', 'editable', CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(
            sa.text(
                "INSERT INTO snapshot_files "
                "(id, snapshot_id, project_id, logical_filename, media_type, "
                "size, sha256) VALUES "
                "('active-file', 'active', 'project', 'trial.md', "
                "'text/markdown', 10, :digest), "
                "('draft-file', 'draft', 'project', 'trial.md', "
                "'text/markdown', 10, :digest)"
            ),
            {"digest": "a" * 64},
        )
    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text(
                "SELECT lifecycle_status, progress_percent, uploaded_at "
                "FROM snapshot_files ORDER BY id"
            )
        ).all()
    engine.dispose()

    assert [(row[0], row[1]) for row in rows] == [
        ("ready", 100),
        ("ready", 100),
    ]
    assert all(row[2] is not None for row in rows)


def test_project_access_migration_makes_creator_the_private_owner(
    tmp_path: Path, monkeypatch: MonkeyPatch
) -> None:
    monkeypatch.delenv("CONVERSATION_DATABASE_URL", raising=False)
    database = tmp_path / "project-access.db"
    config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{database}")
    command.upgrade(config, "20260804_0004")
    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO projects "
                "(id, name, state, creator_subject, creator_name, created_at, "
                "updated_at, active_document_count, generation) VALUES "
                "('private-project', 'Private', 'draft', 'owner-subject', "
                "'Owner Name', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0)"
            )
        )
    engine.dispose()

    command.upgrade(config, "head")
    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.connect() as connection:
        project = connection.execute(
            sa.text("SELECT tenant_id FROM projects WHERE id = 'private-project'")
        ).one()
        membership = connection.execute(
            sa.text(
                "SELECT principal_type, principal_id, role FROM project_memberships "
                "WHERE project_id = 'private-project'"
            )
        ).one()
    engine.dispose()

    assert project[0] == "default"
    assert tuple(membership) == ("user", "owner-subject", "owner")
