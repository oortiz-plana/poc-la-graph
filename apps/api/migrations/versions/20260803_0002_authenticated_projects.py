"""Add authenticated multi-project workspace state.

Revision ID: 20260803_0002
Revises: 20260729_0001
Create Date: 2026-08-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260803_0002"
down_revision: str | None = "20260729_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Legacy bearer-capability conversations are intentionally invalidated.
    op.execute(sa.text("DELETE FROM conversation_messages"))
    op.execute(sa.text("DELETE FROM conversations"))
    op.add_column("conversations", sa.Column("graph_version", sa.String(128)))

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(1000)),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("creator_subject", sa.String(255), nullable=False),
        sa.Column("creator_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True)),
        sa.Column("active_snapshot_id", sa.String(36)),
        sa.Column("active_graph_version", sa.String(128)),
        sa.Column(
            "active_document_count", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_projects_state", "projects", ["state"])
    op.create_table(
        "project_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sealed_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_project_snapshots_project_id", "project_snapshots", ["project_id"]
    )
    op.create_table(
        "content_blobs",
        sa.Column("project_id", sa.String(36), primary_key=True),
        sa.Column("sha256", sa.String(64), primary_key=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "snapshot_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "snapshot_id",
            sa.String(36),
            sa.ForeignKey("project_snapshots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("logical_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(255), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.UniqueConstraint("snapshot_id", "logical_filename"),
    )
    op.create_index("ix_snapshot_files_snapshot_id", "snapshot_files", ["snapshot_id"])
    op.create_table(
        "upload_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "snapshot_id",
            sa.String(36),
            sa.ForeignKey("project_snapshots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("created_by", sa.String(255), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_upload_sessions_project_id", "upload_sessions", ["project_id"])
    op.create_index("ix_upload_sessions_expires_at", "upload_sessions", ["expires_at"])
    op.create_table(
        "upload_parts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("upload_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("logical_filename", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(255), nullable=False),
        sa.Column("expected_size", sa.Integer(), nullable=False),
        sa.Column("expected_sha256", sa.String(64), nullable=False),
        sa.Column("temp_path", sa.Text()),
        sa.Column("received_size", sa.Integer()),
        sa.Column("state", sa.String(16), nullable=False),
    )
    op.create_index("ix_upload_parts_session_id", "upload_parts", ["session_id"])
    op.create_table(
        "build_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "snapshot_id",
            sa.String(36),
            sa.ForeignKey("project_snapshots.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("requested_by", sa.String(255), nullable=False),
        sa.Column("expected_generation", sa.Integer(), nullable=False),
        sa.Column("graph_version", sa.String(128)),
        sa.Column("error_code", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("worker_id", sa.String(128)),
    )
    op.create_index("ix_build_jobs_project_id", "build_jobs", ["project_id"])
    op.create_index(
        "ix_build_jobs_status_created", "build_jobs", ["status", "created_at"]
    )
    op.create_table(
        "idempotency_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("actor_subject", sa.String(255), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("resource_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("actor_subject", "operation", "key"),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("actor_subject", sa.String(255), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
    )
    op.create_index("ix_audit_events_project_id", "audit_events", ["project_id"])


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("idempotency_records")
    op.drop_table("build_jobs")
    op.drop_table("upload_parts")
    op.drop_table("upload_sessions")
    op.drop_table("snapshot_files")
    op.drop_table("content_blobs")
    op.drop_table("project_snapshots")
    op.drop_table("projects")
    op.drop_column("conversations", "graph_version")
