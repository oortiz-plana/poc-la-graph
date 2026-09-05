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
    PlsqlImpactItemRecord,
    PlsqlObjectRecord,
    PlsqlPathRecord,
    PlsqlSourceRecord,
)
from app.models import (
    ObjectKind,
    PlsqlDependency,
    PlsqlDependencyCategory,
    PlsqlDependencyResult,
    PlsqlDependencySummary,
    PlsqlHealth,
    PlsqlHealthCategory,
    ImpactDirection,
    ImpactRelationship,
    PlsqlImpactItem,
    PlsqlImpactResult,
    PlsqlImpactSummary,
    PlsqlObject,
    PlsqlObjectReference,
    PlsqlOverview,
    PlsqlObjectSearchResult,
    PlsqlPath,
    PlsqlPathResult,
    PlsqlSourceContent,
    PlsqlSourceCoordinate,
    PlsqlSourceFile,
    PlsqlSourceHighlight,
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


def _source(record: PlsqlSourceRecord) -> PlsqlSourceContent:
    highlight = (
        PlsqlSourceHighlight(
            startLine=record.highlight.start_line,
            endLine=record.highlight.end_line,
        )
        if record.highlight is not None
        else None
    )
    return PlsqlSourceContent(
        file=PlsqlSourceFile(fileId=record.file.file_id, path=record.file.path),
        lines=record.lines,
        highlight=highlight,
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
    """Deterministically search analyzed PL/SQL objects (bounded).

    Synonyms are aliases rather than analyzable objects and are excluded from
    search results.
    """
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


@router.get("/health", response_model=PlsqlHealth)
async def get_health(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: Annotated[
        str | None, Query(alias="objectId", min_length=1, max_length=512)
    ] = None,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlHealth:
    """Return analysis-quality diagnostics grouped by category.

    ``objectId`` scopes the report to one object; without it the report
    covers the whole repository.
    """
    del principal
    if object_id is not None:
        await _require_object(analysis, object_id)
    record = await analysis.health(
        object_id=object_id, limit=_effective_limit(settings, limit)
    )

    return PlsqlHealth(
        total=record.total,
        unresolved=PlsqlHealthCategory(
            count=record.unresolved.count,
            items=[_dependency(edge) for edge in record.unresolved.items],
        ),
        ambiguous=PlsqlHealthCategory(
            count=record.ambiguous.count,
            items=[_dependency(edge) for edge in record.ambiguous.items],
        ),
        dynamic_sql=PlsqlHealthCategory(
            count=record.dynamic_sql.count,
            items=[_dependency(edge) for edge in record.dynamic_sql.items],
        ),
        parse_errors=PlsqlHealthCategory(
            count=record.parse_errors.count,
            items=[_dependency(edge) for edge in record.parse_errors.items],
        ),
        unsupported=PlsqlHealthCategory(
            count=record.unsupported.count,
            items=[_dependency(edge) for edge in record.unsupported.items],
        ),
        truncated=record.truncated,
    )


@router.get("/dependencies", response_model=PlsqlDependencySummary)
async def get_dependencies(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    category: Annotated[PlsqlDependencyCategory, Query()] = "callers",
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
) -> PlsqlDependencySummary:
    """Return per-category dependency counts plus the selected category page."""
    del principal
    await _require_object(analysis, object_id)
    page = await analysis.dependencies_of(
        object_id=object_id,
        category=category,
        limit=_effective_limit(settings, limit),
    )
    return PlsqlDependencySummary(
        counts=page.counts,
        items=[_dependency(edge) for edge in page.items],
        truncated=page.truncated,
        total=page.total,
    )


@router.get("/overview", response_model=PlsqlOverview)
async def get_overview(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    top: Annotated[int | None, Query(ge=1, le=20)] = None,
) -> PlsqlOverview:
    """Return headline metrics for one object's Overview tab.

    Counts cover direct and indirect dependents (over typed dependency
    relationships within ``plsql_max_hops``), callers, callees, and distinct
    tables/views accessed; ``top`` bounds the returned direct-caller list
    without changing the counts.
    """
    del principal
    record = await _require_object(analysis, object_id)
    page = await analysis.overview_of(
        object_id=object_id,
        max_hops=settings.plsql_max_hops,
        limit=min(top or 5, settings.plsql_max_rows),
    )
    return PlsqlOverview(
        object=_reference(
            object_id=record.id,
            kind=record.kind,
            name=record.name,
            qualified_name=record.qualified_name,
        ),
        direct_dependents=page.direct_dependents,
        indirect_dependents=page.indirect_dependents,
        callers=page.callers,
        callees=page.callees,
        tables_accessed=page.tables_accessed,
        top_callers=[
            _reference(
                object_id=caller.id,
                kind=caller.kind,
                name=caller.name,
                qualified_name=caller.qualified_name,
            )
            for caller in page.top_callers
        ],
    )


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


@router.get("/relationships/evidence", response_model=PlsqlDependency)
async def get_relationship_evidence(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    relationship_id: Annotated[
        str, Query(alias="relationshipId", min_length=1, max_length=512)
    ],
) -> PlsqlDependency:
    """Return one typed relationship with its source evidence coordinates.

    Identifiers embed ``/`` characters (``edge://...``), so the identifier
    travels as a query parameter instead of a path segment.
    """
    del principal
    edge = await analysis.relationship_evidence(relationship_id)
    if edge is None:
        raise PlsqlObjectNotFound("The requested relationship was not found.")
    return _dependency(edge)


@router.get("/source", response_model=PlsqlSourceContent)
async def get_object_source(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
) -> PlsqlSourceContent:
    """Return read-only source text for an analyzed object.

    The response highlights the object's declaration line. Content is served
    strictly under the configured ``plsql_source_root`` with traversal guards
    and the configured byte cap.
    """
    del principal
    await _require_object(analysis, object_id)
    record = await analysis.object_source(object_id=object_id)
    if record is None:
        raise PlsqlObjectNotFound("The requested PL/SQL object has no source evidence.")
    return _source(record)


@router.get("/files", response_model=PlsqlSourceContent)
async def get_file_source(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    file_id: Annotated[str, Query(alias="fileId", min_length=1, max_length=512)],
    start_line: Annotated[int | None, Query(alias="startLine", ge=1)] = None,
    end_line: Annotated[int | None, Query(alias="endLine", ge=1)] = None,
) -> PlsqlSourceContent:
    """Return read-only source text for one file of the analyzed corpus.

    ``startLine``/``endLine`` are optional request ranges echoed as the
    highlight for the viewer. Unknown file ids and traversal attempts are
    rejected as ``analysis_not_found``; oversized files are capped by
    ``plsql_max_source_bytes``.
    """
    del principal
    record = await analysis.file_source(
        file_id=file_id,
        start_line=start_line,
        end_line=end_line,
    )
    if record is None:
        raise PlsqlObjectNotFound("The requested source file was not found.")
    return _source(record)


def _impact_item(record: PlsqlImpactItemRecord) -> PlsqlImpactItem:
    dependent = record.dependent
    return PlsqlImpactItem(
        id=record.id,
        dependent=_reference(
            object_id=dependent.id,
            kind=dependent.kind,
            name=dependent.name,
            qualified_name=dependent.qualified_name,
        ),
        distance=record.distance,
        paths=[_path(path_record) for path_record in record.paths],
    )


@router.get("/impact", response_model=PlsqlImpactResult)
async def get_impact(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    limit: Annotated[int | None, Query(ge=1, le=200)] = None,
    direction: Annotated[ImpactDirection, Query()] = "upstream",
    depth: Annotated[int | None, Query(ge=1)] = None,
    relationship: Annotated[ImpactRelationship | None, Query()] = None,
    direct_only: Annotated[bool, Query(alias="directOnly")] = False,
    writes_only: Annotated[bool, Query(alias="writesOnly")] = False,
) -> PlsqlImpactResult:
    """Return bounded transitive impact with filters and a blast-radius summary.

    ``direction`` selects dependents (upstream) or dependencies (downstream);
    ``relationship``/``writesOnly`` restrict the traversed edge types;
    ``directOnly`` caps the walk at one hop and ``depth`` bounds hops within
    ``plsql_max_hops``. The summary reports direct and indirect affected
    objects, distinct packages, and tables modified on the traversed paths.
    """
    del principal
    record = await _require_object(analysis, object_id)
    relationships: frozenset[str] | None
    if writes_only:
        relationships = frozenset({"WRITES"})
    elif relationship is not None:
        relationships = frozenset({relationship})
    else:
        relationships = None
    max_hops = (
        1
        if direct_only
        else min(depth or settings.plsql_max_hops, settings.plsql_max_hops)
    )
    page = await analysis.impact_of(
        object_id=object_id,
        max_hops=max_hops,
        limit=_effective_limit(settings, limit),
        direction=direction,
        relationships=relationships,
    )
    return PlsqlImpactResult(
        object=_reference(
            object_id=record.id,
            kind=record.kind,
            name=record.name,
            qualified_name=record.qualified_name,
        ),
        items=[_impact_item(item) for item in page.items],
        truncated=page.truncated,
        count=page.total,
        summary=PlsqlImpactSummary(
            direct=page.summary.direct,
            indirect=page.summary.indirect,
            packages=page.summary.packages,
            tables_modified=page.summary.tables_modified,
        ),
    )
