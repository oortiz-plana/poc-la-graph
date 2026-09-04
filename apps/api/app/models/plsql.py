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
    "TRIGGER_ON",
    "INDEXES",
    "SYNONYM_FOR",
    "DECLARES",
    "CONTAINS",
]

PlsqlResolution = Literal["EXACT", "INFERRED", "AMBIGUOUS", "UNRESOLVED"]


class ApiModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )


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
    """One typed dependency edge with resolution and source evidence."""

    id: str = Field(min_length=1, max_length=512)
    relationship: PlsqlRelationship
    source: PlsqlObjectReference
    target: PlsqlObjectReference
    resolution: PlsqlResolution
    evidence: PlsqlSourceCoordinate | None = None


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
