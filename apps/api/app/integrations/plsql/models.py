"""Internal analysis graph records.

These records mirror the semantic graph consumed from the `plsqlgraph`
pipeline (see docs/architecture/plsql-analysis-console.md). They are internal
to the gateway; the public camelCase boundary models live in
`app.models.plsql`.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.models.plsql import ObjectKind, PlsqlRelationship, PlsqlResolution


class PlsqlEvidence(BaseModel):
    """Source coordinate attached to a declaration or relationship."""

    model_config = ConfigDict(extra="forbid")

    source_file_id: str
    path: str
    start_line: int | None = None
    start_column: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None


class PlsqlObjectRecord(BaseModel):
    """One projected PL/SQL database object or routine."""

    model_config = ConfigDict(extra="forbid")

    id: str
    kind: ObjectKind
    name: str
    schema_name: str
    qualified_name: str
    project_id: str
    owner: str | None = None
    signature: str | None = None
    return_type: str | None = None
    evidence: PlsqlEvidence | None = None


class PlsqlSearchPage(BaseModel):
    """Deterministic, bounded page of object records."""

    model_config = ConfigDict(extra="forbid")

    items: list[PlsqlObjectRecord]
    truncated: bool
    total: int


class PlsqlDependencyRecord(BaseModel):
    """One typed dependency edge between two projected objects."""

    model_config = ConfigDict(extra="forbid")

    id: str
    relationship: PlsqlRelationship
    resolution: PlsqlResolution
    source_id: str
    source_kind: ObjectKind
    source_name: str
    source_qualified_name: str
    target_id: str
    target_kind: ObjectKind
    target_name: str
    target_qualified_name: str
    evidence: PlsqlEvidence | None = None


class PlsqlDependencyPage(BaseModel):
    """Deterministic, bounded page of dependency edges."""

    model_config = ConfigDict(extra="forbid")

    items: list[PlsqlDependencyRecord]
    truncated: bool
    total: int


class PlsqlPathRecord(BaseModel):
    """One ordered, bounded dependency path between two projected objects.

    ``steps`` holds the typed edges in traversal order; the node sequence is
    derived from them (``steps[0].source`` followed by each step's target).
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    steps: list[PlsqlDependencyRecord]
    hop_count: int


class PlsqlPathPage(BaseModel):
    """Deterministic, bounded page of dependency paths."""

    model_config = ConfigDict(extra="forbid")

    items: list[PlsqlPathRecord]
    truncated: bool
    total: int


class PlsqlFileRecord(BaseModel):
    """One project-relative source file known to the analyzed corpus."""

    model_config = ConfigDict(extra="forbid")

    file_id: str
    path: str


class PlsqlSourceHighlight(BaseModel):
    """Inclusive line range to highlight in a source response."""

    model_config = ConfigDict(extra="forbid")

    start_line: int
    end_line: int


class PlsqlSourceRecord(BaseModel):
    """Read-only file content plus an optional highlight range."""

    model_config = ConfigDict(extra="forbid")

    file: PlsqlFileRecord
    lines: list[str]
    highlight: PlsqlSourceHighlight | None = None


class PlsqlImpactItemRecord(BaseModel):
    """One transitive dependent of a changed object.

    ``distance`` is the shortest number of hops from the dependent to the
    changed object; ``paths`` holds the shortest explaining paths
    (dependent → … → changed object) with evidence on every hop.
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    dependent: PlsqlObjectRecord
    distance: int
    paths: list[PlsqlPathRecord]


class PlsqlImpactPage(BaseModel):
    """Deterministic, bounded page of impact items."""

    model_config = ConfigDict(extra="forbid")

    items: list[PlsqlImpactItemRecord]
    truncated: bool
    total: int
