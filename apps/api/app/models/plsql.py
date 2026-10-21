"""Public PL/SQL analysis console contract models (camelCase at the boundary)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ObjectKind = Literal[
    "Table",
    "View",
    "Package",
    "Sequence",
    "Trigger",
    "Index",
    "Synonym",
    "Type",
    "Procedure",
    "Function",
    "AnonymousBlock",
]

PlsqlRelationship = Literal[
    "CALLS",
    "READS",
    "WRITES",
    "VIEW_DEPENDS_ON",
    "FOREIGN_KEY",
    "TRIGGER_ON",
    "TRIGGERS",
    "INDEXES",
    "SYNONYM_FOR",
    "DECLARES",
    "CONTAINS",
]

PlsqlResolution = Literal["EXACT", "INFERRED", "AMBIGUOUS", "UNRESOLVED"]

PlsqlDependencyCategory = Literal["callers", "callees", "reads", "writes", "other"]

ImpactDirection = Literal["upstream", "downstream"]

# Blast-radius card narrowing the impact item list (the summary stays whole).
ImpactScope = Literal["all", "direct", "indirect", "packages", "tablesModified"]

# How a list is ordered: by object name, or by package (then name) so that a
# view grouped by package pages through the packages alphabetically.
ListOrder = Literal["name", "package"]

PlsqlHealthCategoryName = Literal[
    "unresolved", "ambiguous", "dynamicSql", "parseErrors", "unsupported"
]

ImpactRelationship = Literal[
    "CALLS", "READS", "WRITES", "VIEW_DEPENDS_ON", "FOREIGN_KEY", "TRIGGERS"
]


class ApiModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )


class PlsqlDependencySummary(ApiModel):
    """Unified dependencies view: per-category counts plus one category page."""

    counts: dict[PlsqlDependencyCategory, int]
    items: list[PlsqlDependency]
    truncated: bool
    total: int = Field(ge=0)


class PlsqlHealthCategory(ApiModel):
    """One diagnostic category with its count and evidence rows."""

    count: int = Field(ge=0)
    items: list[PlsqlDependency]


class PlsqlHealth(ApiModel):
    """Analysis-quality diagnostics grouped by category.

    ``dynamicSql``/``parseErrors``/``unsupported`` are placeholders that stay
    empty until the pipeline projects those diagnostics into the graph.
    """

    total: int = Field(ge=0)
    unresolved: PlsqlHealthCategory
    ambiguous: PlsqlHealthCategory
    dynamic_sql: PlsqlHealthCategory = Field(alias="dynamicSql")
    parse_errors: PlsqlHealthCategory = Field(alias="parseErrors")
    unsupported: PlsqlHealthCategory
    truncated: bool


class PlsqlOverview(ApiModel):
    """Headline metrics for the Overview tab of one analyzed object."""

    object: PlsqlObjectReference
    direct_dependents: int = Field(alias="directDependents", ge=0)
    indirect_dependents: int = Field(alias="indirectDependents", ge=0)
    callers: int = Field(ge=0)
    callees: int = Field(ge=0)
    tables_accessed: int = Field(alias="tablesAccessed", ge=0)
    top_callers: list[PlsqlObjectReference] = Field(alias="topCallers")


class PlsqlSourceCoordinate(ApiModel):
    source_file_id: str | None = Field(default=None, alias="sourceFileId")
    path: str | None = None
    start_line: int | None = Field(default=None, alias="startLine")
    start_column: int | None = Field(default=None, alias="startColumn")
    start_offset: int | None = Field(default=None, alias="startOffset")
    end_offset: int | None = Field(default=None, alias="endOffset")


class PlsqlObject(ApiModel):
    """Object summary/detail returned by search and object endpoints."""

    id: str = Field(min_length=1, max_length=512)
    kind: ObjectKind
    name: str = Field(min_length=1, max_length=256)
    schema_name: str = Field(alias="schema", min_length=1, max_length=128)
    qualified_name: str = Field(alias="qualifiedName", min_length=1, max_length=512)
    project_id: str = Field(alias="projectId", min_length=1, max_length=128)
    owner: str | None = Field(default=None, max_length=256)
    signature: str | None = Field(default=None, max_length=1024)
    return_type: str | None = Field(alias="returnType", default=None, max_length=128)
    declaration: PlsqlSourceCoordinate | None = None


class PlsqlObjectSearchResult(ApiModel):
    items: list[PlsqlObject]
    truncated: bool
    count: int = Field(ge=0)


class PlsqlObjectReference(ApiModel):
    """Lightweight endpoint reference used by typed dependency edges."""

    id: str = Field(min_length=1, max_length=512)
    kind: ObjectKind
    name: str = Field(min_length=1, max_length=256)
    schema_name: str = Field(alias="schema", min_length=1, max_length=128)
    qualified_name: str = Field(alias="qualifiedName", min_length=1, max_length=512)


class PlsqlDependency(ApiModel):
    """One typed dependency edge with resolution and source evidence.

    ``evidenceKind``/``derived``/``events``/``viaTable`` are populated only
    for derived edges (e.g. ``TRIGGERS``, a trigger-mediated invocation); a
    literal ``CALLS``/``READS``/``WRITES`` edge leaves them ``null``.

    One dependency stands for an object pair however many times it is
    referenced: ``occurrences`` lists every distinct source location (ordered
    by file and line), ``occurrenceCount`` how many, and ``evidence`` is the
    first of them.
    """

    id: str = Field(min_length=1, max_length=512)
    relationship: PlsqlRelationship
    source: PlsqlObjectReference
    target: PlsqlObjectReference
    resolution: PlsqlResolution
    evidence: PlsqlSourceCoordinate | None = None
    evidence_kind: str | None = Field(default=None, alias="evidenceKind")
    derived: bool | None = None
    events: str | None = None
    via_table: PlsqlObjectReference | None = Field(default=None, alias="viaTable")
    occurrences: list[PlsqlSourceCoordinate] = Field(default_factory=list)
    occurrence_count: int = Field(default=1, ge=1, alias="occurrenceCount")


class PlsqlDependencyResult(ApiModel):
    items: list[PlsqlDependency]
    truncated: bool
    count: int = Field(ge=0)


class PlsqlPath(ApiModel):
    """One ordered dependency path between two objects.

    ``nodes`` lists the endpoint references in traversal order (length
    ``hopCount + 1``); ``relationships`` holds the ordered typed edges with
    resolution and source evidence per hop.
    """

    id: str = Field(min_length=1, max_length=512)
    nodes: list[PlsqlObjectReference]
    relationships: list[PlsqlDependency]
    hop_count: int = Field(alias="hopCount", ge=1)


class PlsqlPathResult(ApiModel):
    """Deterministic, bounded envelope of dependency paths."""

    items: list[PlsqlPath]
    truncated: bool
    count: int = Field(ge=0)
    next_cursor: str | None = Field(alias="nextCursor")


class PlsqlSourceFile(ApiModel):
    """Project-relative source file identity returned with content."""

    file_id: str = Field(alias="fileId", min_length=1, max_length=512)
    path: str = Field(min_length=1, max_length=512)


class PlsqlSourceHighlight(ApiModel):
    """Inclusive line range a client should highlight in the viewer."""

    start_line: int = Field(alias="startLine", ge=1)
    end_line: int = Field(alias="endLine", ge=1)


class PlsqlSourceContent(ApiModel):
    """Read-only file content with an optional highlight range.

    ``lines`` holds the whole file split at line breaks; the viewer renders
    line numbers itself. Raw text is served only through this endpoint,
    scoped strictly under the configured source root.
    """

    file: PlsqlSourceFile
    lines: list[str]
    highlight: PlsqlSourceHighlight | None = None


class PlsqlImpactItem(ApiModel):
    """One transitive dependent of a changed object.

    ``distance`` is the shortest number of hops from the dependent to the
    changed object; ``paths`` holds the shortest explaining paths
    (dependent → … → changed object) with per-hop evidence. No severity is
    attached: scope is explained by the paths alone.
    """

    id: str = Field(min_length=1, max_length=512)
    dependent: PlsqlObjectReference
    distance: int = Field(ge=1)
    paths: list[PlsqlPath]


class PlsqlImpactSummary(ApiModel):
    """Blast-radius summary for an impact scope."""

    direct: int = Field(ge=0)
    indirect: int = Field(ge=0)
    packages: int = Field(ge=0)
    tables_modified: int = Field(alias="tablesModified", ge=0)


class PlsqlImpactSummaryResult(ApiModel):
    """Blast-radius counts of one impact traversal, independent of paging."""

    object: PlsqlObjectReference
    summary: PlsqlImpactSummary


class PlsqlImpactResult(ApiModel):
    """Deterministic, bounded impact report for one changed object.

    ``object`` identifies the analyzed object; ``items`` are its transitive
    dependents in alphabetical order of their object name (the distance is a
    column, not the order).
    """

    object: PlsqlObjectReference
    items: list[PlsqlImpactItem]
    truncated: bool
    count: int = Field(ge=0)
    next_cursor: str | None = Field(alias="nextCursor")
