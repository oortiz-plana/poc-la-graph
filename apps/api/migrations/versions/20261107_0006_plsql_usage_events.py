"""Add PL/SQL console usage events (ADR 0018).

Revision ID: 20261107_0006
Revises: 20260804_0005
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261107_0006"
down_revision: str | None = "20260804_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "plsql_usage_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("duration_ms", sa.Float(), nullable=False),
        sa.Column("object_id", sa.String(512), nullable=True),
    )
    op.create_index(
        "ix_plsql_usage_events_tenant_time",
        "plsql_usage_events",
        ["tenant_id", "occurred_at"],
    )
    op.create_index(
        "ix_plsql_usage_events_tenant_operation",
        "plsql_usage_events",
        ["tenant_id", "operation"],
    )
    op.create_index(
        "ix_plsql_usage_events_tenant_subject",
        "plsql_usage_events",
        ["tenant_id", "subject"],
    )


def downgrade() -> None:
    op.drop_index("ix_plsql_usage_events_tenant_subject", "plsql_usage_events")
    op.drop_index("ix_plsql_usage_events_tenant_operation", "plsql_usage_events")
    op.drop_index("ix_plsql_usage_events_tenant_time", "plsql_usage_events")
    op.drop_table("plsql_usage_events")
