"""Authenticated project, upload, and build API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from .conversation import ApiModel

ProjectState = Literal["draft", "queued", "building", "ready", "failed", "archived"]
BuildState = Literal["queued", "building", "ready", "failed"]
ProjectRole = Literal["viewer", "contributor", "manager", "owner"]
PrincipalType = Literal["user", "group"]
FileLifecycleState = Literal[
    "uploaded",
    "queued",
    "validating",
    "converting",
    "buildingGraph",
    "indexing",
    "ready",
    "failed",
]


class AllowedActions(ApiModel):
    create_conversation: bool = Field(alias="createConversation")
    edit_draft: bool = Field(alias="editDraft")
    build: bool
    archive: bool
    restore: bool
    purge: bool
    manage_access: bool = Field(default=False, alias="manageAccess")
    view_access_activity: bool = Field(default=False, alias="viewAccessActivity")
    request_access: bool = Field(default=False, alias="requestAccess")


class AccessOrigin(ApiModel):
    membership_id: str = Field(alias="membershipId")
    principal_type: PrincipalType = Field(alias="principalType")
    principal_id: str = Field(alias="principalId")
    display_name: str = Field(alias="displayName")
    role: ProjectRole


class CurrentAccess(ApiModel):
    effective_role: ProjectRole = Field(alias="effectiveRole")
    origins: list[AccessOrigin]


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
    current_access: CurrentAccess = Field(alias="currentAccess")


class DirectoryPrincipal(ApiModel):
    id: str
    type: PrincipalType
    display_name: str = Field(alias="displayName")
    secondary_text: str | None = Field(default=None, alias="secondaryText")


class DirectoryPrincipalList(ApiModel):
    items: list[DirectoryPrincipal]
    next_cursor: str | None = Field(default=None, alias="nextCursor")


class GovernanceProject(ApiModel):
    id: str
    name: str
    state: ProjectState
    owner_count: int = Field(alias="ownerCount")
    updated_at: datetime = Field(alias="updatedAt")


class ProjectMembership(ApiModel):
    id: str
    principal_type: PrincipalType = Field(alias="principalType")
    principal_id: str = Field(alias="principalId")
    display_name: str = Field(alias="displayName")
    role: ProjectRole
    access_origin: Literal["direct", "group"] = Field(alias="accessOrigin")
    created_at: datetime = Field(alias="createdAt")


class AddMembershipItem(ApiModel):
    principal_type: PrincipalType = Field(alias="principalType")
    principal_id: str = Field(alias="principalId", min_length=1, max_length=255)
    display_name: str = Field(alias="displayName", min_length=1, max_length=255)


class AddMembershipsRequest(ApiModel):
    principals: list[AddMembershipItem] = Field(min_length=1, max_length=50)
    role: Literal["viewer", "contributor", "manager"]


class UpdateMembershipRequest(ApiModel):
    role: ProjectRole


AccessRequestState = Literal["pending", "approved", "denied", "cancelled"]


class ProjectAccessRequest(ApiModel):
    id: str
    requester_id: str = Field(alias="requesterId")
    requester_name: str = Field(alias="requesterName")
    note: str | None
    status: AccessRequestState
    decided_role: ProjectRole | None = Field(default=None, alias="decidedRole")
    created_at: datetime = Field(alias="createdAt")
    decided_at: datetime | None = Field(default=None, alias="decidedAt")


class CreateAccessRequest(ApiModel):
    note: str | None = Field(default=None, max_length=500)


class AccessRequestContext(ApiModel):
    project_id: str = Field(alias="projectId")
    project_name: str = Field(alias="projectName")
    status: Literal["available", "pending", "denied"]
    request_id: str | None = Field(default=None, alias="requestId")


class DecideAccessRequest(ApiModel):
    decision: Literal["approved", "denied"]
    role: Literal["viewer", "contributor", "manager"] | None = None


class AccessActivity(ApiModel):
    id: str
    actor_id: str = Field(alias="actorId")
    action: str
    target_name: str | None = Field(default=None, alias="targetName")
    occurred_at: datetime = Field(alias="occurredAt")


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
    status: FileLifecycleState | None = None
    progress_percent: int | None = Field(
        default=None, alias="progressPercent", ge=0, le=100
    )
    error_code: str | None = Field(default=None, alias="errorCode")
    uploaded_at: datetime | None = Field(default=None, alias="uploadedAt")


class BuildAccepted(ApiModel):
    build_id: str = Field(alias="buildId")
    status: Literal["queued"] = "queued"
