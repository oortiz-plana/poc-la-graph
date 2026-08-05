"""Add tenant-scoped project access and sharing.

Revision ID: 20260804_0005
Revises: 20260804_0004
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0005"
down_revision: str | None = "20260804_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.String(128), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.execute(
        sa.text(
            "INSERT INTO tenants (id, name, status, created_at) "
            "VALUES ('default', 'default', 'active', CURRENT_TIMESTAMP)"
        )
    )
    op.add_column(
        "projects",
        sa.Column(
            "tenant_id", sa.String(128), nullable=False, server_default="default"
        ),
    )
    op.create_index("ix_projects_tenant_id", "projects", ["tenant_id"])
    op.create_table(
        "project_memberships",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("principal_type", sa.String(16), nullable=False),
        sa.Column("principal_id", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("created_by", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("project_id", "principal_type", "principal_id"),
    )
    op.create_index(
        "ix_project_memberships_tenant_id", "project_memberships", ["tenant_id"]
    )
    op.create_index(
        "ix_project_memberships_project_id", "project_memberships", ["project_id"]
    )
    op.create_index(
        "ix_project_memberships_principal",
        "project_memberships",
        ["principal_type", "principal_id"],
    )
    op.execute(
        sa.text(
            "INSERT INTO project_memberships "
            "(id, tenant_id, project_id, principal_type, principal_id, "
            "display_name, role, created_by, created_at, updated_at) "
            "SELECT id, "
            "tenant_id, id, 'user', creator_subject, creator_name, 'owner', "
            "creator_subject, created_at, updated_at FROM projects"
        )
    )
    op.create_table(
        "project_access_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requester_id", sa.String(255), nullable=False),
        sa.Column("requester_name", sa.String(255), nullable=False),
        sa.Column("note", sa.String(500)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reviewed_by", sa.String(255)),
        sa.Column("decided_role", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_project_access_requests_tenant_id", "project_access_requests", ["tenant_id"]
    )
    op.create_index(
        "ix_project_access_requests_project_id",
        "project_access_requests",
        ["project_id"],
    )
    op.create_index(
        "ix_access_requests_project_status",
        "project_access_requests",
        ["project_id", "status"],
    )


def downgrade() -> None:
    op.drop_table("project_access_requests")
    op.drop_table("project_memberships")
    op.drop_index("ix_projects_tenant_id", table_name="projects")
    op.drop_column("projects", "tenant_id")
    op.drop_table("tenants")
