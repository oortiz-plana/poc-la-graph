"""SQLAlchemy usage recorder sharing the conversation database."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import DateTime, Float, Index, Integer, String, delete, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .aggregation import summarize_events
from .models import UsageEvent, UsageOutcome, UsageSummary

# Upper bound on events one summary reads, so a busy window cannot exhaust
# memory; the summary reports ``truncated`` when it is reached.
MAX_SUMMARY_EVENTS = 100_000


class UsageBase(DeclarativeBase):
    pass


class UsageEventRow(UsageBase):
    __tablename__ = "plsql_usage_events"
    __table_args__ = (
        Index("ix_plsql_usage_events_tenant_time", "tenant_id", "occurred_at"),
        Index("ix_plsql_usage_events_tenant_operation", "tenant_id", "operation"),
        Index("ix_plsql_usage_events_tenant_subject", "tenant_id", "subject"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tenant_id: Mapped[str] = mapped_column(String(128))
    subject: Mapped[str] = mapped_column(String(255))
    username: Mapped[str] = mapped_column(String(255))
    operation: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(16))
    status_code: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[float] = mapped_column(Float)
    object_id: Mapped[str | None] = mapped_column(String(512), nullable=True)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _to_event(row: UsageEventRow) -> UsageEvent:
    outcome: UsageOutcome
    if row.outcome == "server_error":
        outcome = "server_error"
    elif row.outcome == "client_error":
        outcome = "client_error"
    else:
        outcome = "ok"
    return UsageEvent(
        occurred_at=_aware(row.occurred_at),
        tenant_id=row.tenant_id,
        subject=row.subject,
        username=row.username,
        operation=row.operation,
        outcome=outcome,
        status_code=row.status_code,
        duration_ms=row.duration_ms,
        object_id=row.object_id,
    )


class SQLAlchemyUsageRecorder:
    def __init__(self, database_url: str) -> None:
        self._engine: AsyncEngine = create_async_engine(
            database_url, pool_pre_ping=True
        )
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)

    async def initialize(self) -> None:
        async with self._engine.begin() as connection:
            await connection.run_sync(UsageBase.metadata.create_all)

    async def record(self, event: UsageEvent) -> None:
        async with self._sessions.begin() as session:
            session.add(
                UsageEventRow(
                    id=str(uuid4()),
                    occurred_at=event.occurred_at,
                    tenant_id=event.tenant_id,
                    subject=event.subject[:255],
                    username=event.username[:255],
                    operation=event.operation[:64],
                    outcome=event.outcome,
                    status_code=event.status_code,
                    duration_ms=event.duration_ms,
                    object_id=event.object_id[:512] if event.object_id else None,
                )
            )

    async def summarize(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> UsageSummary:
        statement = (
            select(UsageEventRow)
            .where(
                UsageEventRow.tenant_id == tenant_id,
                UsageEventRow.occurred_at >= since,
                UsageEventRow.occurred_at <= until,
            )
            .order_by(UsageEventRow.occurred_at.desc())
            .limit(MAX_SUMMARY_EVENTS + 1)
        )
        async with self._sessions() as session:
            rows = list((await session.scalars(statement)).all())
        truncated = len(rows) > MAX_SUMMARY_EVENTS
        events = [_to_event(row) for row in rows[:MAX_SUMMARY_EVENTS]]
        return summarize_events(events, since=since, until=until, truncated=truncated)

    async def purge_before(self, cutoff: datetime) -> int:
        async with self._sessions.begin() as session:
            result = await session.execute(
                delete(UsageEventRow).where(UsageEventRow.occurred_at < cutoff)
            )
        return cast(CursorResult[Any], result).rowcount or 0

    async def close(self) -> None:
        await self._engine.dispose()
