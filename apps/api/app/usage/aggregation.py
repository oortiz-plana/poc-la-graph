"""Pure aggregation of usage events into the summary admins see."""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, datetime, timedelta

from .models import (
    DailyUsage,
    ObjectUsage,
    OperationUsage,
    UsageEvent,
    UsageSummary,
    UserUsage,
)

TOP_OBJECT_LIMIT = 10


def percentile(values: Sequence[float], fraction: float) -> float:
    """Nearest-rank percentile; 0.0 for an empty sample."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(fraction * len(ordered)))
    return round(ordered[rank - 1], 1)


def _days_between(since: datetime, until: datetime) -> list[date]:
    first, last = since.date(), until.date()
    return [first + timedelta(days=offset) for offset in range((last - first).days + 1)]


def _operations(events: Sequence[UsageEvent]) -> tuple[OperationUsage, ...]:
    durations: dict[str, list[float]] = defaultdict(list)
    errors: Counter[str] = Counter()
    for event in events:
        durations[event.operation].append(event.duration_ms)
        if event.outcome != "ok":
            errors[event.operation] += 1
    rows = [
        OperationUsage(
            operation=operation,
            requests=len(samples),
            errors=errors[operation],
            p95_duration_ms=percentile(samples, 0.95),
        )
        for operation, samples in durations.items()
    ]
    return tuple(sorted(rows, key=lambda row: (-row.requests, row.operation)))


def _users(events: Sequence[UsageEvent]) -> tuple[UserUsage, ...]:
    by_subject: dict[str, list[UsageEvent]] = defaultdict(list)
    for event in events:
        by_subject[event.subject].append(event)
    rows = []
    for subject, own in by_subject.items():
        latest = max(own, key=lambda event: event.occurred_at)
        operation_counts = Counter(event.operation for event in own)
        top_operation = min(
            operation_counts, key=lambda name: (-operation_counts[name], name)
        )
        rows.append(
            UserUsage(
                subject=subject,
                # A username can change; show the one seen most recently.
                username=latest.username,
                requests=len(own),
                last_active_at=latest.occurred_at,
                top_operation=top_operation,
            )
        )
    return tuple(sorted(rows, key=lambda row: (-row.requests, row.username)))


def _top_objects(events: Iterable[UsageEvent]) -> tuple[ObjectUsage, ...]:
    counts = Counter(event.object_id for event in events if event.object_id)
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return tuple(
        ObjectUsage(object_id=object_id, requests=requests)
        for object_id, requests in ranked[:TOP_OBJECT_LIMIT]
    )


def summarize_events(
    events: Sequence[UsageEvent],
    *,
    since: datetime,
    until: datetime,
    truncated: bool = False,
) -> UsageSummary:
    """Aggregate events already filtered to one tenant and window."""
    per_day = Counter(event.occurred_at.date() for event in events)
    durations = [event.duration_ms for event in events]
    return UsageSummary(
        since=since,
        until=until,
        requests=len(events),
        distinct_users=len({event.subject for event in events}),
        errors=sum(1 for event in events if event.outcome != "ok"),
        p50_duration_ms=percentile(durations, 0.5),
        p95_duration_ms=percentile(durations, 0.95),
        operations=_operations(events),
        days=tuple(
            DailyUsage(day=day, requests=per_day[day])
            for day in _days_between(since, until)
        ),
        users=_users(events),
        top_objects=_top_objects(events),
        truncated=truncated,
    )
