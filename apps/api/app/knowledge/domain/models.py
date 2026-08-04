"""Durable models for source discovery and graph build state."""

from __future__ import annotations

import builtins
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SHA256_PATTERN = r"^[a-f0-9]{64}$"
SAFE_RELATIVE_PATH = r"^[A-Za-z0-9._/-]+$"
SAFE_CONTEXT_ID = r"^[A-Za-z0-9][A-Za-z0-9@._:+/-]*$"
SAFE_SCOPE_ID = r"^[A-Za-z0-9][A-Za-z0-9._-]*$"


class DomainModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )


class KnowledgeDocument(DomainModel):
    relative_path: str = Field(alias="relativePath", pattern=SAFE_RELATIVE_PATH)
    content: str
    raw_bytes: builtins.bytes = Field(alias="rawBytes", exclude=True)
    sha256: str = Field(pattern=SHA256_PATTERN)
    bytes: int = Field(gt=0)
    modified_at: datetime = Field(alias="modifiedAt")
    media_type: str = Field(alias="mediaType", min_length=1)
    profile: str = Field(min_length=1)
    converter: dict[str, Any] = Field(default_factory=dict)

    @field_validator("relative_path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        return _safe_relative_path(value)


class KnowledgeSnapshot(DomainModel):
    source_version: str = Field(alias="sourceVersion", pattern=SHA256_PATTERN)
    documents: tuple[KnowledgeDocument, ...]
    total_bytes: int = Field(alias="totalBytes", ge=0)


class IngestionCommand(DomainModel):
    """Future request context; these fields are metadata, not authorization."""

    requested_by: str | None = Field(
        default=None,
        alias="requestedBy",
        min_length=1,
        max_length=256,
        pattern=SAFE_CONTEXT_ID,
    )
    tenant_id: str | None = Field(
        default=None,
        alias="tenantId",
        min_length=1,
        max_length=128,
        pattern=SAFE_SCOPE_ID,
    )
    project_id: str | None = Field(
        default=None,
        alias="projectId",
        min_length=1,
        max_length=128,
        pattern=SAFE_SCOPE_ID,
    )
    permissions: tuple[str, ...] = Field(default=(), max_length=100)
    source_type: Literal["filesystem", "upload", "object_storage"] | None = Field(
        default=None, alias="sourceType"
    )

    @field_validator("permissions")
    @classmethod
    def safe_permissions(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(set(values)) != len(values):
            raise ValueError("Permissions must not contain duplicates")
        for value in values:
            if not value or len(value) > 256:
                raise ValueError("Permission values must contain 1 to 256 characters")
            if not all(
                character.isalnum() or character in "@._:+/-" for character in value
            ):
                raise ValueError("Permission contains unsupported characters")
        return values


class KnowledgeChangeSet(DomainModel):
    """Deterministic source-relative classifications for one ingestion."""

    added: tuple[str, ...] = Field(default=(), max_length=10_000)
    changed: tuple[str, ...] = Field(default=(), max_length=10_000)
    unchanged: tuple[str, ...] = Field(default=(), max_length=10_000)
    removed: tuple[str, ...] = Field(default=(), max_length=10_000)

    @field_validator("added", "changed", "unchanged", "removed")
    @classmethod
    def safe_sorted_paths(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(_safe_relative_path(value) for value in values)
        if normalized != tuple(sorted(set(normalized))):
            raise ValueError("Change-set paths must be unique and sorted")
        return normalized

    @model_validator(mode="after")
    def disjoint_classifications(self) -> KnowledgeChangeSet:
        groups = (self.added, self.changed, self.unchanged, self.removed)
        if sum(len(group) for group in groups) != len(set().union(*map(set, groups))):
            raise ValueError("A path cannot appear in multiple change classifications")
        return self


class GraphifyFormat(DomainModel):
    artifact_type: Literal["graph.json"] = Field(
        default="graph.json", alias="artifactType"
    )
    producer_version: str = Field(alias="producerVersion", min_length=1)
    format_version: str | None = Field(default=None, alias="formatVersion")


class ArtifactDescriptor(DomainModel):
    relative_path: str = Field(alias="relativePath", pattern=SAFE_RELATIVE_PATH)
    sha256: str = Field(pattern=SHA256_PATTERN)
    bytes: int = Field(gt=0)

    @field_validator("relative_path")
    @classmethod
    def safe_relative_path(cls, value: str) -> str:
        return _safe_relative_path(value)


class BuildCounts(DomainModel):
    nodes: int = Field(ge=0)
    edges: int = Field(ge=0)
    sources: int = Field(default=0, ge=0)


class GraphBuildManifest(DomainModel):
    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    project_id: str = Field(alias="projectId", min_length=1, max_length=128)
    graph_version: str = Field(alias="graphVersion", min_length=1, max_length=128)
    source_version: str = Field(alias="sourceVersion", min_length=1, max_length=256)
    status: Literal["validated"] = "validated"
    created_at: datetime = Field(alias="createdAt")
    graphify_format: GraphifyFormat = Field(alias="graphifyFormat")
    artifact: ArtifactDescriptor
    counts: BuildCounts
    warnings: tuple[str, ...] = Field(default=(), max_length=100)


class ActivePointer(DomainModel):
    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    project_id: str = Field(alias="projectId", min_length=1, max_length=128)
    graph_version: str = Field(alias="graphVersion", min_length=1, max_length=128)
    previous_graph_version: str | None = Field(
        default=None, alias="previousGraphVersion", min_length=1, max_length=128
    )
    generation: int = Field(ge=1)
    activated_at: datetime = Field(alias="activatedAt")
    activated_by: str = Field(alias="activatedBy", min_length=1, max_length=256)
    reason: str | None = Field(default=None, max_length=1000)


class BuildFailure(DomainModel):
    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    project_id: str = Field(alias="projectId", min_length=1, max_length=128)
    source_version: str | None = Field(
        default=None, alias="sourceVersion", max_length=256
    )
    category: Literal[
        "source_invalid",
        "limit_exceeded",
        "build_failed",
        "validation_failed",
        "activation_failed",
        "rollback_failed",
        "internal_error",
    ]
    message: str = Field(min_length=1, max_length=1000)
    failed_at: datetime = Field(alias="failedAt")
    retryable: bool = False

    @field_validator("message")
    @classmethod
    def one_line_message(cls, value: str) -> str:
        return " ".join(value.split())


def _safe_relative_path(value: str) -> str:
    if value.startswith("/") or ".." in value.split("/"):
        raise ValueError("Path must be relative and cannot contain parent traversal")
    return value
