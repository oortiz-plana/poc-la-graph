"""Add durable project-file lifecycle checkpoints.

Revision ID: 20260804_0004
Revises: 20260804_0003
Create Date: 2026-08-04
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0004"
down_revision: str | None = "20260804_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("snapshot_files") as batch:
        batch.add_column(
            sa.Column(
                "lifecycle_status",
                sa.String(24),
                nullable=False,
                server_default="uploaded",
            )
        )
        batch.add_column(sa.Column("progress_percent", sa.Integer()))
        batch.add_column(sa.Column("error_code", sa.String(64)))
        batch.add_column(sa.Column("uploaded_at", sa.DateTime(timezone=True)))

    op.execute(
        sa.text(
            """
            UPDATE snapshot_files
            SET uploaded_at = (
                SELECT project_snapshots.created_at
                FROM project_snapshots
                WHERE project_snapshots.id = snapshot_files.snapshot_id
            ), progress_percent = 0
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE snapshot_files
            SET lifecycle_status = 'ready', progress_percent = 100
            WHERE EXISTS (
                SELECT 1
                FROM projects
                JOIN snapshot_files AS active_file
                  ON active_file.snapshot_id = projects.active_snapshot_id
                WHERE projects.id = snapshot_files.project_id
                  AND active_file.logical_filename = snapshot_files.logical_filename
                  AND active_file.sha256 = snapshot_files.sha256
            )
            """
        )
    )
    with op.batch_alter_table("snapshot_files") as batch:
        batch.alter_column("lifecycle_status", server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("snapshot_files") as batch:
        batch.drop_column("uploaded_at")
        batch.drop_column("error_code")
        batch.drop_column("progress_percent")
        batch.drop_column("lifecycle_status")
