"""Pure aggregation of PL/SQL console usage events."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.usage.aggregation import percentile, summarize_events
from app.usage.models import UsageEvent, outcome_for_status

NOW = datetime(2026, 11, 7, 12, tzinfo=UTC)


def _event(
    *,
    subject: str = "s1",
    username: str = "alice",
    operation: str = "search_objects",
    status_code: int = 200,
    duration_ms: float = 10.0,
    hours_ago: float = 0,
    object_id: str | None = None,
) -> UsageEvent:
    return UsageEvent(
        occurred_at=NOW - timedelta(hours=hours_ago),
        tenant_id="default",
        subject=subject,
        username=username,
        operation=operation,
        outcome=outcome_for_status(status_code),
        status_code=status_code,
        duration_ms=duration_ms,
        object_id=object_id,
    )


def test_outcome_classifies_status_codes() -> None:
    assert outcome_for_status(200) == "ok"
    assert outcome_for_status(404) == "client_error"
    assert outcome_for_status(503) == "server_error"


def test_percentile_uses_nearest_rank() -> None:
    assert percentile([], 0.95) == 0.0
    assert percentile([5.0], 0.5) == 5.0
    assert percentile([float(value) for value in range(1, 101)], 0.95) == 95.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.5) == 2.0


def test_empty_window_has_zero_filled_days() -> None:
    summary = summarize_events([], since=NOW - timedelta(days=6), until=NOW)
    assert summary.requests == 0
    assert summary.distinct_users == 0
    assert [day.requests for day in summary.days] == [0] * 7


def test_operations_are_ranked_by_requests_with_errors_counted() -> None:
    events = [
        _event(operation="get_impact", status_code=500),
        _event(operation="search_objects"),
        _event(operation="search_objects"),
    ]
    summary = summarize_events(events, since=NOW - timedelta(days=1), until=NOW)
    assert [
        (row.operation, row.requests, row.errors) for row in summary.operations
    ] == [
        ("search_objects", 2, 0),
        ("get_impact", 1, 1),
    ]
    assert summary.errors == 1


def test_users_show_latest_username_and_top_operation() -> None:
    events = [
        _event(username="alice", operation="get_impact", hours_ago=3),
        _event(username="alice", operation="get_impact", hours_ago=2),
        _event(username="alice.new", operation="search_objects", hours_ago=1),
        _event(subject="s2", username="bob"),
    ]
    summary = summarize_events(events, since=NOW - timedelta(days=1), until=NOW)
    first = summary.users[0]
    assert (first.username, first.requests, first.top_operation) == (
        "alice.new",
        3,
        "get_impact",
    )
    assert first.last_active_at == NOW - timedelta(hours=1)
    assert summary.distinct_users == 2


def test_top_objects_skip_requests_without_an_object() -> None:
    events = [
        _event(object_id="plsql://a"),
        _event(object_id="plsql://a"),
        _event(object_id="plsql://b"),
        _event(),
    ]
    summary = summarize_events(events, since=NOW - timedelta(days=1), until=NOW)
    assert [(row.object_id, row.requests) for row in summary.top_objects] == [
        ("plsql://a", 2),
        ("plsql://b", 1),
    ]
