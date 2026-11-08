"""In-memory usage recorder for tests."""

from __future__ import annotations

from datetime import datetime

from .aggregation import summarize_events
from .models import UsageEvent, UsageSummary


class InMemoryUsageRecorder:
    def __init__(self) -> None:
        self.events: list[UsageEvent] = []

    async def initialize(self) -> None:
        return None

    async def record(self, event: UsageEvent) -> None:
        self.events.append(event)

    async def summarize(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> UsageSummary:
        window = [
            event
            for event in self.events
            if event.tenant_id == tenant_id and since <= event.occurred_at <= until
        ]
        return summarize_events(window, since=since, until=until)

    async def purge_before(self, cutoff: datetime) -> int:
        kept = [event for event in self.events if event.occurred_at >= cutoff]
        removed = len(self.events) - len(kept)
        self.events = kept
        return removed

    async def close(self) -> None:
        return None
