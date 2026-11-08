"""HTTP middleware that records one usage event per PL/SQL console request."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import cast

from fastapi import Request, Response

from .models import UsageEvent, outcome_for_status
from .protocol import UsageRecorder

PLSQL_PATH_PREFIX = "/api/v1/plsql/"
# Reading the usage summary is not itself console usage.
EXCLUDED_OPERATIONS = frozenset({"get_plsql_usage"})


def build_usage_event(
    request: Request, *, status_code: int, duration_ms: float, occurred_at: datetime
) -> UsageEvent | None:
    """Describe a finished request, or ``None`` when it should not be recorded.

    Only authenticated requests that matched a console route are recorded; the
    principal is set on ``request.state`` by the role dependency.
    """
    if not request.url.path.startswith(PLSQL_PATH_PREFIX):
        return None
    route = request.scope.get("route")
    operation = getattr(route, "name", None)
    if not isinstance(operation, str) or operation in EXCLUDED_OPERATIONS:
        return None
    principal = getattr(request.state, "principal", None)
    if principal is None:
        return None
    return UsageEvent(
        occurred_at=occurred_at,
        tenant_id=principal.tenant_id,
        subject=principal.subject,
        username=principal.username,
        operation=operation,
        outcome=outcome_for_status(status_code),
        status_code=status_code,
        duration_ms=round(duration_ms, 1),
        object_id=request.query_params.get("objectId") or None,
    )


async def record_plsql_usage(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        event = build_usage_event(
            request,
            status_code=status_code,
            duration_ms=(time.perf_counter() - started) * 1000,
            occurred_at=datetime.now(UTC),
        )
        if event is not None:
            await _record(request, event)


async def _record(request: Request, event: UsageEvent) -> None:
    recorder = cast(UsageRecorder, request.app.state.usage)
    try:
        await recorder.record(event)
    except Exception as error:  # noqa: BLE001 - recording must never fail the request
        logger = cast(logging.Logger, request.app.state.logger)
        logger.warning(
            "plsql_usage_record_failed",
            extra={
                "error_type": type(error).__name__,
                "component": "plsql_usage",
                "operation": event.operation,
            },
        )
