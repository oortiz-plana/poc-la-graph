"""Persistence port for console usage events."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from .models import UsageEvent, UsageSummary


class UsageRecorder(Protocol):
    async def initialize(self) -> None: ...

    async def record(self, event: UsageEvent) -> None: ...

    async def summarize(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> UsageSummary: ...

    async def purge_before(self, cutoff: datetime) -> int:
        """Delete events older than ``cutoff``; return how many were removed."""
        ...

    async def close(self) -> None: ...
