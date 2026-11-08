"""Domain models for PL/SQL console usage analytics (ADR 0018)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

UsageOutcome = Literal["ok", "client_error", "server_error"]


def outcome_for_status(status_code: int) -> UsageOutcome:
    """Classify an HTTP status into the outcome stored with each event."""
    if status_code >= 500:
        return "server_error"
    if status_code >= 400:
        return "client_error"
    return "ok"


@dataclass(frozen=True)
class UsageEvent:
    """One console request by one authenticated person."""

    occurred_at: datetime
    tenant_id: str
    subject: str
    username: str
    operation: str
    outcome: UsageOutcome
    status_code: int
    duration_ms: float
    object_id: str | None = None


@dataclass(frozen=True)
class OperationUsage:
    operation: str
    requests: int
    errors: int
    p95_duration_ms: float


@dataclass(frozen=True)
class DailyUsage:
    day: date
    requests: int


@dataclass(frozen=True)
class UserUsage:
    subject: str
    username: str
    requests: int
    last_active_at: datetime
    top_operation: str


@dataclass(frozen=True)
class ObjectUsage:
    object_id: str
    requests: int


@dataclass(frozen=True)
class UsageSummary:
    since: datetime
    until: datetime
    requests: int
    distinct_users: int
    errors: int
    p50_duration_ms: float
    p95_duration_ms: float
    operations: tuple[OperationUsage, ...]
    days: tuple[DailyUsage, ...]
    users: tuple[UserUsage, ...]
    top_objects: tuple[ObjectUsage, ...]
    # True when the window held more events than one summary reads.
    truncated: bool = False
