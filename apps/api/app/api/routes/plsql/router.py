"""PL/SQL analysis console search and object routes (Phase 1)."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from typing import Annotated, cast

from fastapi import APIRouter, Depends, Query, Request

from app.api.dependencies import get_app_settings
from app.api.errors import InvalidRequest
from app.auth import AuthPrincipal, require_viewer
from app.config.settings import Settings
from app.integrations.plsql import (
    AnalysisGraphClient,
    PlsqlNotConfigured,
    PlsqlObjectNotFound,
)
from app.integrations.plsql.catalog import TABLE_ACCESS_BY_CATEGORY
from app.integrations.plsql.models import (
    PlsqlDependencyRecord,
    PlsqlEvidence,
    PlsqlImpactItemRecord,
    PlsqlObjectRecord,
    PlsqlPathRecord,
    PlsqlSourceRecord,
)
from app.models import (
    ImpactDirection,
    ImpactRelationship,
    ImpactScope,
    ObjectKind,
    PlsqlDependency,
    PlsqlDependencyCategory,
    PlsqlDependencyResult,
    PlsqlDependencySummary,
    PlsqlHealth,
    PlsqlHealthCategory,
    PlsqlImpactItem,
    PlsqlImpactResult,
    PlsqlImpactSummary,
    PlsqlImpactSummaryResult,
    PlsqlObject,
    PlsqlObjectReference,
    PlsqlObjectSearchResult,
    PlsqlOverview,
    PlsqlPath,
    PlsqlPathResult,
    PlsqlSourceContent,
    PlsqlSourceCoordinate,
    PlsqlSourceFile,
    PlsqlSourceHighlight,
)
from app.models.plsql import ListOrder, PlsqlHealthCategoryName, PlsqlRelationship

router = APIRouter(prefix="/api/v1/plsql", tags=["plsql"])

DEFAULT_PAGE_SIZE = 25


def analysis(request: Request) -> AnalysisGraphClient:
    client = getattr(request.app.state, "plsql_analysis", None)
    if client is None:
        raise PlsqlNotConfigured("The analysis feature is not configured.")
    return cast(AnalysisGraphClient, client)


def _coordinate(evidence: PlsqlEvidence | None) -> PlsqlSourceCoordinate | None:
    if evidence is None:
        return None
    return PlsqlSourceCoordinate(
        source_file_id=evidence.source_file_id,
        path=evidence.path,
        start_line=evidence.start_line,
        start_column=evidence.start_column,
        start_offset=evidence.start_offset,
        end_offset=evidence.end_offset,
    )


def _source(record: PlsqlSourceRecord) -> PlsqlSourceContent:
    highlight = (
        PlsqlSourceHighlight(
            start_line=record.highlight.start_line,
            end_line=record.highlight.end_line,
        )
        if record.highlight is not None
        else None
    )
    return PlsqlSourceContent(
        file=PlsqlSourceFile(file_id=record.file.file_id, path=record.file.path),
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
        qualified_name=record.qualified_name,
        project_id=record.project_id,
        owner=record.owner,
        signature=record.signature,
        return_type=record.return_type,
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
        qualified_name=qualified_name,
    )


def _dependency(edge: PlsqlDependencyRecord) -> PlsqlDependency:
    via_table = (
        _reference(
            object_id=edge.via_table_id,
            kind=edge.via_table_kind,
            name=edge.via_table_name,
            qualified_name=edge.via_table_qualified_name,
        )
        if edge.via_table_id is not None
        and edge.via_table_kind is not None
        and edge.via_table_name is not None
        and edge.via_table_qualified_name is not None
        else None
    )
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
        occurrences=[
            coordinate
            for evidence in edge.occurrences
            if (coordinate := _coordinate(evidence)) is not None
        ],
        occurrence_count=edge.occurrence_count,
        evidence_kind=edge.evidence_kind,
        derived=edge.derived,
        events=edge.events,
        via_table=via_table,
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
        hop_count=record.hop_count,
    )


def _effective_limit(settings: Settings, limit: int | None) -> int:
    return min(limit or settings.plsql_max_rows, settings.plsql_max_rows)


def _effective_page_limit(settings: Settings, limit: int | None) -> int:
    return min(limit or DEFAULT_PAGE_SIZE, settings.plsql_max_rows)


def _pagination_scope(kind: str, **values: object) -> str:
    payload = json.dumps(
        {"kind": kind, **values}, sort_keys=True, separators=(",", ":")
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def _encode_page_cursor(scope: str, offset: int) -> str:
    payload = json.dumps(
        {"v": 1, "scope": scope, "offset": offset}, separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_page_cursor(cursor: str | None, scope: str) -> int:
    if cursor is None:
        return 0
    try:
        padding = "=" * (-len(cursor) % 4)
        value = json.loads(
            base64.b64decode(cursor + padding, altchars=b"-_", validate=True)
        )
        if (
            not isinstance(value, dict)
            or type(value.get("v")) is not int
            or value.get("v") != 1
            or value.get("scope") != scope
            or not isinstance(value.get("offset"), int)
            or isinstance(value.get("offset"), bool)
            or value["offset"] < 0
        ):
            raise ValueError
        return cast(int, value["offset"])
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
        raise InvalidRequest("Invalid pagination cursor") from exc


def _page_start(cursor: str | None, offset: int, scope: str) -> int:
    """First row of a page, addressed by the previous page's cursor or by offset."""
    if cursor is not None and offset:
        raise InvalidRequest("Use either cursor or offset, not both")
    return offset if cursor is None else _decode_page_cursor(cursor, scope)


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
    offset: Annotated[int, Query(ge=0)] = 0,
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
        offset=offset,
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
    category: Annotated[PlsqlHealthCategoryName | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PlsqlHealth:
    """Return analysis-quality diagnostics grouped by category.

    ``objectId`` scopes the report to one object; without it the report
    covers the whole repository. Every category reports its exact ``count``.
    Without ``category`` each lists its first page; with one, only that
    category lists items, starting at ``offset`` (page navigation).
    """
    del principal
    if offset and category is None:
        raise InvalidRequest("offset needs a category")
    if object_id is not None:
        await _require_object(analysis, object_id)
    record = await analysis.health(
        object_id=object_id,
        limit=_effective_limit(settings, limit),
        category=category,
        offset=offset,
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
    offset: Annotated[int, Query(ge=0)] = 0,
    relationship: Annotated[PlsqlRelationship | None, Query()] = None,
    order: Annotated[ListOrder, Query()] = "name",
) -> PlsqlDependencySummary:
    """Return per-category dependency counts plus the selected category page.

    ``offset`` skips that many rows of the selected category, so a client can
    read any page of it (page navigation) without walking the ones before.
    ``relationship`` narrows that page and its ``total`` to one edge type of
    ``reads``/``writes``/``other`` (e.g. only ``TRIGGER_ON``); ``counts`` keep
    describing whole categories. ``order`` is the object name or, for a view
    grouped by package, the package first.
    """
    del principal
    if relationship is not None and relationship not in TABLE_ACCESS_BY_CATEGORY.get(
        category, frozenset()
    ):
        raise InvalidRequest(
            f"Relationship {relationship} does not belong to category {category}"
        )
    await _require_object(analysis, object_id)
    page = await analysis.dependencies_of(
        object_id=object_id,
        category=category,
        limit=_effective_limit(settings, limit),
        offset=offset,
        relationship=relationship,
        order=order,
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
    """Return table-access edges, including structural FOREIGN_KEY dependencies."""
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
    limit: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE_SIZE,
    cursor: Annotated[str | None, Query(min_length=1, max_length=1024)] = None,
    page_offset: Annotated[int, Query(alias="offset", ge=0)] = 0,
) -> PlsqlPathResult:
    """Return bounded dependency paths from one object to another.

    Paths traverse typed dependency relationships (``CALLS | READS | WRITES |
    VIEW_DEPENDS_ON | TRIGGERS | FOREIGN_KEY``) within ``plsql_max_hops``,
    ordered by hop count then lexicographic node ids, with duplicates collapsed
    and truncation reported when the row cap is hit. A page is addressed either
    by the previous page's ``cursor`` or directly by ``offset``, never both.
    """
    del principal
    await _require_object(analysis, from_id)
    await _require_object(analysis, to_id)
    scope = _pagination_scope(
        "paths", from_id=from_id, to_id=to_id, max_hops=settings.plsql_max_hops
    )
    offset = _page_start(cursor, page_offset, scope)
    page = await analysis.find_paths(
        from_id=from_id,
        to_id=to_id,
        max_hops=settings.plsql_max_hops,
        limit=_effective_page_limit(settings, limit),
        offset=offset,
    )
    next_cursor = (
        _encode_page_cursor(scope, offset + len(page.items)) if page.truncated else None
    )
    return PlsqlPathResult(
        items=[_path(record) for record in page.items],
        truncated=page.truncated,
        count=page.total,
        next_cursor=next_cursor,
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


def _impact_traversal(
    settings: Settings,
    *,
    depth: int | None,
    relationship: ImpactRelationship | None,
    direct_only: bool,
    writes_only: bool,
) -> tuple[int, frozenset[str] | None]:
    """Translate the shared impact filters into (max hops, relationship types)."""
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
    return max_hops, relationships


@router.get("/impact/summary", response_model=PlsqlImpactSummaryResult)
async def get_impact_summary(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    direction: Annotated[ImpactDirection, Query()] = "upstream",
    depth: Annotated[int | None, Query(ge=1)] = None,
    relationship: Annotated[ImpactRelationship | None, Query()] = None,
    direct_only: Annotated[bool, Query(alias="directOnly")] = False,
    writes_only: Annotated[bool, Query(alias="writesOnly")] = False,
) -> PlsqlImpactSummaryResult:
    """Return the blast-radius counts of an impact traversal.

    Takes the same traversal filters as ``/impact`` but no paging: it reports
    direct and indirect affected objects, distinct packages, and tables
    modified on the traversed paths for the whole traversal, so the totals
    never depend on loading (or failing to load) any page of rows.
    """
    del principal
    record = await _require_object(analysis, object_id)
    max_hops, relationships = _impact_traversal(
        settings,
        depth=depth,
        relationship=relationship,
        direct_only=direct_only,
        writes_only=writes_only,
    )
    summary = await analysis.impact_summary_of(
        object_id=object_id,
        max_hops=max_hops,
        direction=direction,
        relationships=relationships,
    )
    return PlsqlImpactSummaryResult(
        object=_reference(
            object_id=record.id,
            kind=record.kind,
            name=record.name,
            qualified_name=record.qualified_name,
        ),
        summary=PlsqlImpactSummary(
            direct=summary.direct,
            indirect=summary.indirect,
            packages=summary.packages,
            tables_modified=summary.tables_modified,
        ),
    )


@router.get("/impact", response_model=PlsqlImpactResult)
async def get_impact(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    analysis: Annotated[AnalysisGraphClient, Depends(analysis)],
    object_id: ObjectIdentifier,
    limit: Annotated[int, Query(ge=1, le=200)] = DEFAULT_PAGE_SIZE,
    direction: Annotated[ImpactDirection, Query()] = "upstream",
    depth: Annotated[int | None, Query(ge=1)] = None,
    relationship: Annotated[ImpactRelationship | None, Query()] = None,
    direct_only: Annotated[bool, Query(alias="directOnly")] = False,
    writes_only: Annotated[bool, Query(alias="writesOnly")] = False,
    impact_scope: Annotated[ImpactScope, Query(alias="scope")] = "all",
    cursor: Annotated[str | None, Query(min_length=1, max_length=1024)] = None,
    page_offset: Annotated[int, Query(alias="offset", ge=0)] = 0,
    order: Annotated[ListOrder, Query()] = "name",
) -> PlsqlImpactResult:
    """Return one page of transitive impact with filters.

    ``direction`` selects dependents (upstream) or dependencies (downstream);
    ``relationship``/``writesOnly`` restrict the traversed edge types;
    ``directOnly`` caps the walk at one hop and ``depth`` bounds hops within
    ``plsql_max_hops``. ``scope`` narrows ``items``/``count`` to one summary
    card before paging. The blast-radius totals are a separate service,
    ``/impact/summary``. A page is addressed either by the ``cursor`` of the
    previous one (load more) or directly by ``offset`` (page navigation), never
    both.
    """
    del principal
    record = await _require_object(analysis, object_id)
    max_hops, relationships = _impact_traversal(
        settings,
        depth=depth,
        relationship=relationship,
        direct_only=direct_only,
        writes_only=writes_only,
    )
    scope = _pagination_scope(
        "impact",
        object_id=object_id,
        max_hops=max_hops,
        direction=direction,
        relationships=sorted(relationships) if relationships is not None else None,
        item_scope=impact_scope,
        order=order,
    )
    offset = _page_start(cursor, page_offset, scope)
    page = await analysis.impact_of(
        object_id=object_id,
        max_hops=max_hops,
        limit=_effective_page_limit(settings, limit),
        direction=direction,
        relationships=relationships,
        offset=offset,
        scope=impact_scope,
        order=order,
    )
    next_cursor = (
        _encode_page_cursor(scope, offset + len(page.items)) if page.truncated else None
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
        next_cursor=next_cursor,
    )
