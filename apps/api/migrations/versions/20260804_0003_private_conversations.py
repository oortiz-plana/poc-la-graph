"""Add private named conversations with archive retention.

Revision ID: 20260804_0003
Revises: 20260803_0002
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0003"
down_revision: str | None = "20260803_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing rows have no trustworthy owner and must never be reassigned.
    op.execute(sa.text("DELETE FROM conversation_messages"))
    op.execute(sa.text("DELETE FROM conversations"))
    with op.batch_alter_table("conversations") as batch:
        batch.add_column(
            sa.Column("created_by", sa.String(255), nullable=False, server_default="")
        )
        batch.add_column(sa.Column("name", sa.String(120)))
        batch.add_column(sa.Column("archived_at", sa.DateTime(timezone=True)))
        batch.alter_column("created_by", server_default=None)
    op.create_index("ix_conversations_created_by", "conversations", ["created_by"])
    op.create_index("ix_conversations_archived_at", "conversations", ["archived_at"])
    op.create_index(
        "ix_conversations_owner_project_archive_updated_id",
        "conversations",
        ["created_by", "project_id", "archived_at", "updated_at", "id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_conversations_owner_project_archive_updated_id",
        table_name="conversations",
    )
    op.drop_index("ix_conversations_archived_at", table_name="conversations")
    op.drop_index("ix_conversations_created_by", table_name="conversations")
    with op.batch_alter_table("conversations") as batch:
        batch.drop_column("archived_at")
        batch.drop_column("name")
        batch.drop_column("created_by")
