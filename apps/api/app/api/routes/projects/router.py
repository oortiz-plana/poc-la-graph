"""Authenticated shared-project, upload, archive, and build routes."""

from __future__ import annotations

from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Request, Response, status

from app.api.dependencies import get_store
from app.api.errors import InvalidRequest
from app.auth import AuthPrincipal, require_admin, require_editor, require_viewer
from app.auth.dependencies import AuthorizationError
from app.config.settings import Settings
from app.models import (
    AccessActivity,
    AccessRequestContext,
    AddMembershipsRequest,
    BuildAccepted,
    BuildSummary,
    CreateAccessRequest,
    CreateProjectRequest,
    CreateUploadSessionRequest,
    DecideAccessRequest,
    DirectoryPrincipalList,
    GovernanceProject,
    Project,
    ProjectAccessRequest,
    ProjectMembership,
    SnapshotFile,
    UpdateMembershipRequest,
    UploadSession,
)
from app.models.project import (
    AccessOrigin,
    AllowedActions,
    CurrentAccess,
    DirectoryPrincipal,
    UploadPart,
)
from app.projects.repository import (
    AccessDecision,
    AccessRequestRow,
    BuildJobRow,
    ProjectConflict,
    ProjectMembershipRow,
    ProjectNotFound,
    ProjectRepository,
    ProjectRow,
    SnapshotFileRow,
    aware,
)
from app.projects.storage import (
    ProjectStorage,
    UploadValidationError,
    validate_filename,
)
from app.store import ConversationStore

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=255)
]


def repository(request: Request) -> ProjectRepository:
    return cast(ProjectRepository, request.app.state.projects)


def storage(request: Request) -> ProjectStorage:
    return cast(ProjectStorage, request.app.state.project_storage)


def settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


@router.get("/governance/projects", response_model=list[GovernanceProject])
async def governance_projects(
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[GovernanceProject]:
    return [
        GovernanceProject(
            id=row.id,
            name=row.name,
            state=cast(Any, row.state),
            ownerCount=sum(
                membership.role == "owner" for membership in row.memberships
            ),
            updatedAt=aware(row.updated_at) or row.updated_at,
        )
        for row in await projects.list_tenant_projects(principal.tenant_id)
    ]


@router.get("", response_model=list[Project])
async def list_projects(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[Project]:
    rows = await projects.list_projects(
        tenant_id=principal.tenant_id,
        subject=principal.subject,
        group_ids=principal.group_ids,
    )
    return [
        _project(
            row,
            principal,
            await projects.access_decision(
                row.id,
                tenant_id=principal.tenant_id,
                subject=principal.subject,
                group_ids=principal.group_ids,
            ),
        )
        for row in rows
    ]


@router.post("", response_model=Project, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: CreateProjectRequest,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Project:
    row = await projects.create_project(
        name=body.name,
        description=body.description.strip() if body.description else None,
        subject=principal.subject,
        username=principal.username,
        tenant_id=principal.tenant_id,
        key=idempotency_key,
    )
    return _project(
        row,
        principal,
        await projects.access_decision(
            row.id,
            tenant_id=principal.tenant_id,
            subject=principal.subject,
        ),
    )


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
    configured: Annotated[Settings, Depends(settings)],
    conversations: Annotated[ConversationStore, Depends(get_store)],
) -> Response:
    await _tenant_project(projects, project_id, principal.tenant_id)
    await projects.purge_expired(
        project_id, principal.subject, configured.project_archive_retention_days
    )
    await conversations.delete_project(project_id)
    await project_storage.purge_project(project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}", response_model=Project)
async def get_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Project:
    decision = await _authorize(projects, project_id, principal)
    return _project(
        await projects.get_project(project_id, include_archived=False),
        principal,
        decision,
    )


@router.get("/{project_id}/access-context", response_model=AccessRequestContext)
async def access_request_context(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> AccessRequestContext:
    row = await _tenant_project(projects, project_id, principal.tenant_id)
    if row.state == "archived":
        raise ProjectNotFound(project_id)
    requests = await projects.list_access_requests(
        project_id, principal.tenant_id, principal.subject
    )
    latest = requests[0].status if requests else "available"
    status_value = (
        "pending"
        if latest == "pending"
        else "denied"
        if latest == "denied"
        else "available"
    )
    return AccessRequestContext(
        projectId=row.id,
        projectName=row.name,
        status=cast(Any, status_value),
        requestId=requests[0].id if requests and latest == "pending" else None,
    )


@router.post("/{project_id}/archive", response_model=Project)
async def archive_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Project:
    if "admin" in principal.roles:
        await _tenant_project(projects, project_id, principal.tenant_id)
        decision = AccessDecision("viewer", ())
    else:
        decision = await _authorize(projects, project_id, principal, "owner")
    return _project(
        await projects.archive(project_id, principal.subject), principal, decision
    )


@router.post("/{project_id}/restore", response_model=Project)
async def restore_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    configured: Annotated[Settings, Depends(settings)],
) -> Project:
    if "admin" not in principal.roles:
        decision = await _authorize(projects, project_id, principal, "owner")
    else:
        await _tenant_project(projects, project_id, principal.tenant_id)
        decision = AccessDecision("viewer", ())
    row = await projects.restore(
        project_id, principal.subject, configured.project_archive_retention_days
    )
    return _project(row, principal, decision)


@router.post(
    "/{project_id}/upload-sessions",
    response_model=UploadSession,
    status_code=status.HTTP_201_CREATED,
)
async def create_upload_session(
    project_id: str,
    body: CreateUploadSessionRequest,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    configured: Annotated[Settings, Depends(settings)],
) -> UploadSession:
    await _authorize(projects, project_id, principal, "contributor")
    names = [validate_filename(item.filename) for item in body.files]
    if len(names) != len(set(names)):
        raise UploadValidationError("Filenames in an upload session must be unique")
    if len(body.files) > configured.knowledge_max_document_count:
        raise UploadValidationError(
            "The upload exceeds the configured file-count limit"
        )
    if any(
        item.size > configured.knowledge_max_document_size_bytes for item in body.files
    ):
        raise UploadValidationError("A file exceeds the configured size limit")
    if (
        sum(item.size for item in body.files)
        > configured.knowledge_max_total_source_bytes
    ):
        raise UploadValidationError(
            "The upload exceeds the configured aggregate-size limit"
        )
    row = await projects.create_upload_session(
        project_id, body.files, subject=principal.subject, key=idempotency_key
    )
    return UploadSession(
        id=row.id,
        expires_at=aware(row.expires_at) or row.expires_at,
        parts=[
            UploadPart(
                id=part.id,
                filename=part.logical_filename,
                upload_url=(
                    f"/api/backend/api/v1/projects/{project_id}/upload-sessions/"
                    f"{row.id}/parts/{part.id}"
                ),
            )
            for part in row.parts
        ],
    )


@router.put(
    "/{project_id}/upload-sessions/{session_id}/parts/{part_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def upload_part(
    project_id: str,
    session_id: str,
    part_id: str,
    request: Request,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
) -> Response:
    await _authorize(projects, project_id, principal, "contributor")
    part = await projects.get_part(project_id, session_id, part_id)
    await project_storage.receive_part(projects, part, request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{project_id}/upload-sessions/{session_id}/finalize",
    response_model=list[SnapshotFile],
)
async def finalize_upload(
    project_id: str,
    session_id: str,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
) -> list[SnapshotFile]:
    await _authorize(projects, project_id, principal, "contributor")
    blobs = await project_storage.validate_and_store(projects, project_id, session_id)
    rows = await projects.finalize_upload(
        project_id, session_id, blobs, subject=principal.subject, key=idempotency_key
    )
    return [_file(row) for row in rows]


@router.get("/{project_id}/files", response_model=list[SnapshotFile])
async def list_files(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[SnapshotFile]:
    await _authorize(projects, project_id, principal)
    await projects.get_project(project_id, include_archived=False)
    return [_file(row) for row in await projects.list_files(project_id)]


@router.delete("/{project_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: str,
    file_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Response:
    await _authorize(projects, project_id, principal, "contributor")
    await projects.delete_file(project_id, file_id, principal.subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{project_id}/builds",
    response_model=BuildAccepted,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_build(
    project_id: str,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> BuildAccepted:
    await _authorize(projects, project_id, principal, "contributor")
    row = await projects.submit_build(
        project_id, subject=principal.subject, key=idempotency_key
    )
    return BuildAccepted(build_id=row.id)


@router.get("/{project_id}/builds/{build_id}", response_model=BuildSummary)
async def get_build(
    project_id: str,
    build_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> BuildSummary:
    await _authorize(projects, project_id, principal)
    return _build(await projects.get_build(project_id, build_id))


@router.get("/{project_id}/members", response_model=list[ProjectMembership])
async def list_members(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[ProjectMembership]:
    await _govern_access(projects, project_id, principal, view_only=True)
    return [
        _membership(row)
        for row in await projects.list_memberships(project_id, principal.tenant_id)
    ]


@router.post("/{project_id}/members", response_model=list[ProjectMembership])
async def add_members(
    project_id: str,
    body: AddMembershipsRequest,
    request: Request,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[ProjectMembership]:
    del idempotency_key
    await _govern_access(projects, project_id, principal)
    if request.app.state.settings.auth_enabled:
        allowed = {("user", principal.subject)} | {
            ("group", group_id) for group_id in principal.group_ids
        }
        if request.app.state.directory.configured:
            resolved = []
            for item in body.principals:
                resolved.extend(
                    await request.app.state.directory.search(
                        item.display_name, principal.tenant_id, 50
                    )
                )
            allowed.update((item.type, item.id) for item in resolved)
        if any(
            (item.principal_type, item.principal_id) not in allowed
            for item in body.principals
        ):
            raise InvalidRequest("A directory principal could not be resolved")
    rows = await projects.add_memberships(
        project_id,
        principal.tenant_id,
        [
            (item.principal_type, item.principal_id, item.display_name)
            for item in body.principals
        ],
        body.role,
        principal.subject,
    )
    return [_membership(row) for row in rows]


@router.patch("/{project_id}/members/{membership_id}", response_model=ProjectMembership)
async def change_member_role(
    project_id: str,
    membership_id: str,
    body: UpdateMembershipRequest,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> ProjectMembership:
    decision = await _govern_access(projects, project_id, principal)
    if body.role == "owner" and decision.effective_role != "owner":
        raise AuthorizationError("Only owners can appoint owners")
    return _membership(
        await projects.update_membership(
            project_id, membership_id, principal.tenant_id, body.role, principal.subject
        )
    )


@router.delete("/{project_id}/members/{membership_id}", status_code=204)
async def remove_member(
    project_id: str,
    membership_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Response:
    decision = await _govern_access(projects, project_id, principal)
    rows = await projects.list_memberships(project_id, principal.tenant_id)
    target = next((row for row in rows if row.id == membership_id), None)
    if target and target.role == "owner" and decision.effective_role != "owner":
        raise AuthorizationError("Only owners can remove owners")
    await projects.remove_membership(
        project_id, membership_id, principal.tenant_id, principal.subject
    )
    return Response(status_code=204)


@router.post("/{project_id}/access-requests", response_model=ProjectAccessRequest)
async def request_access(
    project_id: str,
    body: CreateAccessRequest,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> ProjectAccessRequest:
    del idempotency_key
    try:
        await _authorize(projects, project_id, principal)
    except ProjectNotFound:
        pass
    else:
        raise ProjectConflict("Project members cannot request access")
    return _access_request(
        await projects.create_access_request(
            project_id,
            principal.tenant_id,
            principal.subject,
            principal.username,
            body.note.strip() if body.note else None,
        )
    )


@router.get("/{project_id}/access-requests", response_model=list[ProjectAccessRequest])
async def list_access_requests(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[ProjectAccessRequest]:
    try:
        await _govern_access(projects, project_id, principal)
        requester = None
    except (ProjectNotFound, AuthorizationError):
        await _tenant_project(projects, project_id, principal.tenant_id)
        requester = principal.subject
    return [
        _access_request(row)
        for row in await projects.list_access_requests(
            project_id, principal.tenant_id, requester
        )
    ]


@router.patch(
    "/{project_id}/access-requests/{access_request_id}",
    response_model=ProjectAccessRequest,
)
async def decide_access_request(
    project_id: str,
    access_request_id: str,
    body: DecideAccessRequest,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> ProjectAccessRequest:
    del idempotency_key
    await _govern_access(projects, project_id, principal)
    if body.decision == "approved" and body.role is None:
        raise InvalidRequest("An approved request requires a role")
    return _access_request(
        await projects.decide_access_request(
            project_id,
            access_request_id,
            principal.tenant_id,
            body.decision,
            body.role,
            principal.subject,
        )
    )


@router.delete(
    "/{project_id}/access-requests/{access_request_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def cancel_access_request(
    project_id: str,
    access_request_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Response:
    await projects.cancel_access_request(
        project_id,
        access_request_id,
        principal.tenant_id,
        principal.subject,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/access-activity", response_model=list[AccessActivity])
async def access_activity(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[AccessActivity]:
    await _govern_access(projects, project_id, principal)
    return [
        AccessActivity(
            id=row.id,
            actorId=row.actor_subject,
            action=row.action,
            targetName=row.details.get("targetName"),
            occurredAt=aware(row.occurred_at) or row.occurred_at,
        )
        for row in await projects.access_activity(project_id, principal.tenant_id)
    ]


@router.get("/{project_id}/directory", response_model=DirectoryPrincipalList)
async def search_directory(
    project_id: str,
    request: Request,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    query: str = "",
) -> DirectoryPrincipalList:
    await _govern_access(projects, project_id, principal)
    configured = await request.app.state.directory.search(
        query.strip(), principal.tenant_id
    )
    candidates = [
        DirectoryPrincipal(
            id=item.id,
            type=item.type,
            displayName=item.display_name,
            secondaryText=item.secondary_text,
        )
        for item in configured
    ]
    if not candidates:
        candidates = [
            DirectoryPrincipal(
                id=principal.subject,
                type="user",
                displayName=principal.username,
                secondaryText="Current user",
            )
        ]
        candidates.extend(
            DirectoryPrincipal(
                id=group_id,
                type="group",
                displayName=group_id,
                secondaryText="Directory group",
            )
            for group_id in sorted(principal.group_ids)
        )
    folded = query.casefold().strip()
    return DirectoryPrincipalList(
        items=[
            item
            for item in candidates
            if not folded or folded in item.display_name.casefold()
        ],
        nextCursor=None,
    )


async def _authorize(
    projects: ProjectRepository,
    project_id: str,
    principal: AuthPrincipal,
    minimum: str = "viewer",
) -> AccessDecision:
    return await projects.access_decision(
        project_id,
        tenant_id=principal.tenant_id,
        subject=principal.subject,
        group_ids=principal.group_ids,
        minimum=minimum,
    )


async def _govern_access(
    projects: ProjectRepository,
    project_id: str,
    principal: AuthPrincipal,
    *,
    view_only: bool = False,
) -> AccessDecision:
    if "admin" in principal.roles:
        await _tenant_project(projects, project_id, principal.tenant_id)
        return AccessDecision("owner", ())
    return await _authorize(
        projects, project_id, principal, "viewer" if view_only else "manager"
    )


async def _tenant_project(
    projects: ProjectRepository, project_id: str, tenant_id: str
) -> ProjectRow:
    row = await projects.get_project(project_id, include_archived=True)
    if row.tenant_id != tenant_id:
        from app.projects import ProjectNotFound

        raise ProjectNotFound(project_id)
    return row


def _file(row: SnapshotFileRow) -> SnapshotFile:
    return SnapshotFile(
        id=row.id,
        filename=row.logical_filename,
        media_type=row.media_type,
        size=row.size,
        sha256=row.sha256,
        status=cast(Any, row.lifecycle_status),
        progress_percent=row.progress_percent,
        error_code=row.error_code,
        uploaded_at=aware(row.uploaded_at),
    )


def _build(row: BuildJobRow) -> BuildSummary:
    return BuildSummary.model_validate(
        {
            "id": row.id,
            "status": row.status,
            "errorCode": row.error_code,
            "createdAt": aware(row.created_at),
            "startedAt": aware(row.started_at),
            "completedAt": aware(row.completed_at),
        }
    )


def _membership(row: ProjectMembershipRow) -> ProjectMembership:
    return ProjectMembership(
        id=row.id,
        principalType=cast(Any, row.principal_type),
        principalId=row.principal_id,
        displayName=row.display_name,
        role=cast(Any, row.role),
        accessOrigin="group" if row.principal_type == "group" else "direct",
        createdAt=aware(row.created_at) or row.created_at,
    )


def _access_request(row: AccessRequestRow) -> ProjectAccessRequest:
    return ProjectAccessRequest(
        id=row.id,
        requesterId=row.requester_id,
        requesterName=row.requester_name,
        note=row.note,
        status=cast(Any, row.status),
        decidedRole=cast(Any, row.decided_role),
        createdAt=aware(row.created_at) or row.created_at,
        decidedAt=aware(row.decided_at),
    )


def _project(
    row: ProjectRow, principal: AuthPrincipal, access: AccessDecision
) -> Project:
    builds = sorted(
        row.builds,
        key=lambda item: aware(item.created_at) or item.created_at,
        reverse=True,
    )
    current = next(
        (item for item in builds if item.status in {"queued", "building"}), None
    )
    last = next((item for item in builds if item.status in {"ready", "failed"}), None)
    draft = next(
        (snapshot for snapshot in row.snapshots if snapshot.status == "editable"), None
    )
    rank = {"viewer": 1, "contributor": 2, "manager": 3, "owner": 4}
    is_editor = (
        rank[access.effective_role] >= rank["contributor"] and row.state != "archived"
    )
    is_manager = rank[access.effective_role] >= rank["manager"]
    is_owner = access.effective_role == "owner"
    is_admin = "admin" in principal.roles
    return Project.model_validate(
        {
            "id": row.id,
            "name": row.name,
            "description": row.description,
            "state": row.state,
            "creator": row.creator_name,
            "createdAt": aware(row.created_at),
            "updatedAt": aware(row.updated_at),
            "archivedAt": aware(row.archived_at),
            "activeGraphVersion": row.active_graph_version,
            "draftFileCount": len(draft.files) if draft else 0,
            "activeDocumentCount": row.active_document_count,
            "currentBuild": _build(current) if current else None,
            "lastBuild": _build(last) if last else None,
            "allowedActions": AllowedActions(
                createConversation=row.state == "ready",
                editDraft=is_editor and row.state not in {"queued", "building"},
                build=is_editor
                and row.state not in {"queued", "building"}
                and bool(draft and draft.files),
                archive=is_owner
                and row.state not in {"archived", "queued", "building"},
                restore=(is_owner or is_admin) and row.state == "archived",
                purge=is_admin and row.state == "archived",
                manageAccess=is_manager,
                viewAccessActivity=is_manager,
                requestAccess=False,
            ),
            "currentAccess": CurrentAccess(
                effectiveRole=cast(Any, access.effective_role),
                origins=[
                    AccessOrigin(
                        membershipId=origin.id,
                        principalType=cast(Any, origin.principal_type),
                        principalId=origin.principal_id,
                        displayName=origin.display_name,
                        role=cast(Any, origin.role),
                    )
                    for origin in access.origins
                ],
            ),
        }
    )
