"""Authenticated project, upload, and build API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from .conversation import ApiModel

ProjectState = Literal["draft", "queued", "building", "ready", "failed", "archived"]
BuildState = Literal["queued", "building", "ready", "failed"]


class AllowedActions(ApiModel):
    create_conversation: bool = Field(alias="createConversation")
    edit_draft: bool = Field(alias="editDraft")
    build: bool
    archive: bool
    restore: bool
    purge: bool


class BuildSummary(ApiModel):
    id: str
    status: BuildState
    error_code: str | None = Field(default=None, alias="errorCode")
    created_at: datetime = Field(alias="createdAt")
    started_at: datetime | None = Field(default=None, alias="startedAt")
    completed_at: datetime | None = Field(default=None, alias="completedAt")


class Project(ApiModel):
    id: str
    name: str
    description: str | None
    state: ProjectState
    creator: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    archived_at: datetime | None = Field(default=None, alias="archivedAt")
    active_graph_version: str | None = Field(default=None, alias="activeGraphVersion")
    draft_file_count: int = Field(alias="draftFileCount")
    active_document_count: int = Field(alias="activeDocumentCount")
    current_build: BuildSummary | None = Field(default=None, alias="currentBuild")
    last_build: BuildSummary | None = Field(default=None, alias="lastBuild")
    allowed_actions: AllowedActions = Field(alias="allowedActions")


class CreateProjectRequest(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def trimmed_name(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Project name cannot be blank")
        return trimmed


class UploadFileDeclaration(ApiModel):
    filename: str = Field(min_length=1, max_length=255)
    media_type: str = Field(alias="mediaType", min_length=1, max_length=255)
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class CreateUploadSessionRequest(ApiModel):
    files: list[UploadFileDeclaration] = Field(min_length=1, max_length=100)


class UploadPart(ApiModel):
    id: str
    filename: str
    upload_url: str = Field(alias="uploadUrl")


class UploadSession(ApiModel):
    id: str
    expires_at: datetime = Field(alias="expiresAt")
    parts: list[UploadPart]


class SnapshotFile(ApiModel):
    id: str
    filename: str
    media_type: str = Field(alias="mediaType")
    size: int
    sha256: str


class BuildAccepted(ApiModel):
    build_id: str = Field(alias="buildId")
    status: Literal["queued"] = "queued"
