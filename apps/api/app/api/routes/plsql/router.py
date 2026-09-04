"""PL/SQL analysis console search and object routes (Phase 1)."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies import get_app_settings
from app.auth import AuthPrincipal, require_viewer
from app.config.settings import Settings
from app.integrations.plsql import (
    AnalysisGraphClient,
    PlsqlNotConfigured,
    PlsqlObjectNotFound,
)
from app.integrations.plsql.models import (
    PlsqlDependencyRecord,
    PlsqlEvidence,
    PlsqlObjectRecord,
    PlsqlPathRecord,
)
from app.models import (
    ObjectKind,
    PlsqlDependency,
    PlsqlDependencyResult,
    PlsqlObject,
    PlsqlObjectReference,
    PlsqlObjectSearchResult,
    PlsqlPath,
    PlsqlPathResult,
    PlsqlSourceCoordinate,
)

router = APIRouter(prefix="/api/v1/plsql", tags=["plsql"])


def analysis(request: Request) -> AnalysisGraphClient:
    client = getattr(request.app.state, "plsql_analysis", None)
    if client is None:
        raise PlsqlNotConfigured("The analysis feature is not configured.")
    return cast(AnalysisGraphClient, client)


def _coordinate(evidence: PlsqlEvidence | None) -> PlsqlSourceCoordinate | None:
    if evidence is None:
        return None
    return PlsqlSourceCoordinate(
        sourceFileId=evidence.source_file_id,
        path=evidence.path,
        startLine=evidence.start_line,
        startColumn=evidence.start_column,
        startOffset=evidence.start_offset,
        endOffset=evidence.end_offset,
    )


def _schema_of(qualified_name: str) -> str:
    return qualified_name.split(".", 1)[0]


def _object(record: PlsqlObjectRecord) -> PlsqlObject:
    return PlsqlObject(
        id=record.id,
        kind=record.kind,
        name=record.name,
        schema_name=record.schema_name,
        qualifiedName=record.qualified_name,
        projectId=record.project_id,
        owner=record.owner,
        signature=record.signature,
        returnType=record.return_type,
        declaration=_coordinate(record.evidence),
    )


def _reference(
    *,
    object_id: str,
    kind: ObjectKind,
    name: str,
    qualified_name: str,
) -> PlsqlObjectReference:
    return PlsqlObjectReference(
        id=object_id,
        kind=kind,
        name=name,
        schema_name=_schema_of(qualified_name),
        qualifiedName=qualified_name,
    )


def _dependency(edge: PlsqlDependencyRecord) -> PlsqlDependency:
    return PlsqlDependency(
        id=edge.id,
        relationship=edge.relationship,
        source=_reference(
            object_id=edge.source_id,
            kind=edge.source_kind,
            name=edge.source_name,
            qualified_name=edge.source_qualified_name,
        ),
        target=_reference(
            object_id=edge.target_id,
            kind=edge.target_kind,
            name=edge.target_name,
            qualified_name=edge.target_qualified_name,
        ),
        resolution=edge.resolution,
        evidence=_coordinate(edge.evidence),
    )


def _path(record: PlsqlPathRecord) -> PlsqlPath:
    """Map an ordered path record to its public model.

    ``nodes`` lists the endpoint references in traversal order
    (``hopCount + 1`` entries); ``relationships`` carries the ordered typed
    edges with per-hop resolution and evidence.
    """
    if not record.steps:
        raise ValueError("A dependency path must contain at least one step.")
    nodes = [
        _reference(
            object_id=record.steps[0].source_id,
            kind=record.steps[0].source_kind,
            name=record.steps[0].source_name,
            qualified_name=record.steps[0].source_qualified_name,
        )
    ]
    nodes.extend(
        _reference(
            object_id=step.target_id,
            kind=step.target_kind,
            name=step.target_name,
            qualified_name=step.target_qualified_name,
        )
        for step in record.steps
    )
    return PlsqlPath(
        id=record.id,
        nodes=nodes,
        relationships=[_dependency(step) for step in record.steps],
        hopCount=record.hop_count,
    )


def _effective_limit(settings: Settings, limit: int | None) -> int:
    return min(limit or settings.plsql_max_rows, settings.plsql_max_rows)


async def _require_object(
    analysis: AnalysisGraphClient, object_id: str
) -> PlsqlObjectRecord:
    record = await analysis.get_object(object_id)
    if record is None:
        raise PlsqlObjectNotFound("The requested PL/SQL object was not found.")
    return record


@router.get("/objects", response_model=PlsqlObjectSearchResult)
async def search_objects(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    q: Annotated[str, Query(max_length=200)] = "",
    kinds: Annotated[list[ObjectKind] | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlObjectSearchResult:
    """Deterministically search analyzed PL/SQL objects (bounded)."""
    del principal
    page = await analysis.search_objects(
        query=q,
        kinds=kinds,
        limit=_effective_limit(settings, limit),
    )
    return PlsqlObjectSearchResult(
        items=[_object(record) for record in page.items],
        truncated=page.truncated,
        count=page.total,
    )


@router.get("/object", response_model=PlsqlObject)
async def get_object(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: Annotated[str, Query(alias="objectId", min_length=1, max_length=512)],
) -> PlsqlObject:
    """Return one analyzed PL/SQL object by its opaque identifier.

    Identifiers embed ``/`` characters (``plsql://...``), so the identifier
    travels as a query parameter instead of a path segment to survive
    proxies and routers without double encoding.
    """
    del principal
    record = await _require_object(analysis, object_id)
    return _object(record)


ObjectIdentifier = Annotated[str, Query(alias="objectId", min_length=1, max_length=512)]


@router.get("/callers", response_model=PlsqlDependencyResult)
async def list_callers(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlDependencyResult:
    """Return routines that call the requested routine (incoming CALLS)."""
    del principal
    await _require_object(analysis, object_id)
    page = await analysis.callers_of(
        object_id=object_id, limit=_effective_limit(settings, limit)
    )
    return PlsqlDependencyResult(
        items=[_dependency(edge) for edge in page.items],
        truncated=page.truncated,
        count=page.total,
    )


@router.get("/callees", response_model=PlsqlDependencyResult)
async def list_callees(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlDependencyResult:
    """Return routines called by the requested routine (outgoing CALLS)."""
    del principal
    await _require_object(analysis, object_id)
    page = await analysis.callees_of(
        object_id=object_id, limit=_effective_limit(settings, limit)
    )
    return PlsqlDependencyResult(
        items=[_dependency(edge) for edge in page.items],
        truncated=page.truncated,
        count=page.total,
    )


@router.get("/table-access", response_model=PlsqlDependencyResult)
async def list_table_access(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlDependencyResult:
    """Return READS/WRITES/TRIGGER_ON/VIEW_DEPENDS_ON edges of an object."""
    del principal
    await _require_object(analysis, object_id)
    page = await analysis.table_access_of(
        object_id=object_id, limit=_effective_limit(settings, limit)
    )
    return PlsqlDependencyResult(
        items=[_dependency(edge) for edge in page.items],
        truncated=page.truncated,
        count=page.total,
    )


@router.get("/paths", response_model=PlsqlPathResult)
async def find_paths(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    from_id: Annotated[str, Query(alias="from", min_length=1, max_length=512)],
    to_id: Annotated[str, Query(alias="to", min_length=1, max_length=512)],
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlPathResult:
    """Return bounded dependency paths from one object to another.

    Paths traverse typed dependency relationships (``CALLS | READS | WRITES |
    VIEW_DEPENDS_ON``) within ``plsql_max_hops``, ordered by hop count then
    lexicographic node ids, with duplicates collapsed and truncation reported
    when the row cap is hit.
    """
    del principal
    await _require_object(analysis, from_id)
    await _require_object(analysis, to_id)
    page = await analysis.find_paths(
        from_id=from_id,
        to_id=to_id,
        max_hops=settings.plsql_max_hops,
        limit=_effective_limit(settings, limit),
    )
    return PlsqlPathResult(
        items=[_path(record) for record in page.items],
        truncated=page.truncated,
        count=page.total,
    )


@router.get("/unresolved", response_model=PlsqlDependencyResult)
async def list_unresolved(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlDependencyResult:
    """Return edges whose resolution is AMBIGUOUS or UNRESOLVED.

    Uncertainty is surfaced as data: these edges are never presented as
    certain relationships by the console.
    """
    del principal
    page = await analysis.unresolved_references(limit=_effective_limit(settings, limit))
    return PlsqlDependencyResult(
        items=[_dependency(edge) for edge in page.items],
        truncated=page.truncated,
        count=page.total,
    )
