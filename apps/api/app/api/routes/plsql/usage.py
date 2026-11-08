"""Admin-only PL/SQL console usage summary (ADR 0018)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BeforeValidator

from app.api.dependencies import get_app_settings
from app.auth import AuthPrincipal, require_admin
from app.config.settings import Settings
from app.integrations.plsql import AnalysisGraphClient, PlsqlNotConfigured
from app.models import (
    PlsqlObjectReference,
    PlsqlUsageDay,
    PlsqlUsageObject,
    PlsqlUsageOperation,
    PlsqlUsageSummary,
    PlsqlUsageUser,
    UsageWindowDays,
)
from app.usage import UsageRecorder, UsageSummary
from app.usage.models import ObjectUsage

usage_router = APIRouter(prefix="/api/v1/plsql", tags=["plsql"])


def usage_recorder(
    request: Request,
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> UsageRecorder:
    if not settings.plsql_usage_enabled:
        raise PlsqlNotConfigured("Console usage analytics is not enabled.")
    return cast(UsageRecorder, request.app.state.usage)


async def _resolve_object(
    analysis: AnalysisGraphClient | None, usage: ObjectUsage
) -> PlsqlUsageObject:
    record = await analysis.get_object(usage.object_id) if analysis else None
    reference = (
        PlsqlObjectReference(
            id=record.id,
            kind=record.kind,
            name=record.name,
            schema_name=record.schema_name,
            qualified_name=record.qualified_name,
        )
        if record
        else None
    )
    return PlsqlUsageObject(
        object_id=usage.object_id, object=reference, requests=usage.requests
    )


async def _to_response(
    summary: UsageSummary, days: UsageWindowDays, analysis: AnalysisGraphClient | None
) -> PlsqlUsageSummary:
    return PlsqlUsageSummary(
        days_in_window=days,
        since=summary.since.isoformat(),
        until=summary.until.isoformat(),
        requests=summary.requests,
        distinct_users=summary.distinct_users,
        errors=summary.errors,
        p50_duration_ms=summary.p50_duration_ms,
        p95_duration_ms=summary.p95_duration_ms,
        operations=[
            PlsqlUsageOperation(
                operation=row.operation,
                requests=row.requests,
                errors=row.errors,
                p95_duration_ms=row.p95_duration_ms,
            )
            for row in summary.operations
        ],
        daily=[
            PlsqlUsageDay(day=row.day.isoformat(), requests=row.requests)
            for row in summary.days
        ],
        users=[
            PlsqlUsageUser(
                username=row.username,
                requests=row.requests,
                last_active_at=row.last_active_at.isoformat(),
                top_operation=row.top_operation,
            )
            for row in summary.users
        ],
        top_objects=[
            await _resolve_object(analysis, row) for row in summary.top_objects
        ],
        truncated=summary.truncated,
    )


@usage_router.get("/usage", response_model=PlsqlUsageSummary)
async def get_plsql_usage(
    request: Request,
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    recorder: Annotated[UsageRecorder, Depends(usage_recorder)],
    # Query strings arrive as text; coerce before matching the int literal.
    days: Annotated[UsageWindowDays, BeforeValidator(int), Query()] = 7,
) -> PlsqlUsageSummary:
    """Summarize console usage for the admin's tenant over the last ``days``."""
    until = datetime.now(UTC)
    since = (until - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    summary = await recorder.summarize(principal.tenant_id, since=since, until=until)
    analysis = cast(
        AnalysisGraphClient | None, getattr(request.app.state, "plsql_analysis", None)
    )
    return await _to_response(summary, days, analysis)
