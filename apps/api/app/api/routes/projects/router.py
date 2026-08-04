"""Authenticated shared-project, upload, archive, and build routes."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Header, Request, Response, status

from app.api.dependencies import get_store
from app.auth import AuthPrincipal, require_admin, require_editor, require_viewer
from app.config.settings import Settings
from app.models import (
    BuildAccepted,
    BuildSummary,
    CreateProjectRequest,
    CreateUploadSessionRequest,
    Project,
    SnapshotFile,
    UploadSession,
)
from app.models.project import AllowedActions, UploadPart
from app.projects.repository import (
    BuildJobRow,
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


@router.get("", response_model=list[Project])
async def list_projects(
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> list[Project]:
    return [_project(row, principal) for row in await projects.list_projects()]


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
        key=idempotency_key,
    )
    return _project(row, principal)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def purge_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
    configured: Annotated[Settings, Depends(settings)],
    conversations: Annotated[ConversationStore, Depends(get_store)],
) -> Response:
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
    return _project(
        await projects.get_project(
            project_id, include_archived="admin" in principal.roles
        ),
        principal,
    )


@router.post("/{project_id}/archive", response_model=Project)
async def archive_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Project:
    return _project(await projects.archive(project_id, principal.subject), principal)


@router.post("/{project_id}/restore", response_model=Project)
async def restore_project(
    project_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_admin)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    configured: Annotated[Settings, Depends(settings)],
) -> Project:
    row = await projects.restore(
        project_id, principal.subject, configured.project_archive_retention_days
    )
    return _project(row, principal)


@router.post(
    "/{project_id}/upload-sessions",
    response_model=UploadSession,
    status_code=status.HTTP_201_CREATED,
)
async def create_upload_session(
    project_id: str,
    body: CreateUploadSessionRequest,
    idempotency_key: IdempotencyKey,
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    configured: Annotated[Settings, Depends(settings)],
) -> UploadSession:
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
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
) -> Response:
    del principal
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
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
    project_storage: Annotated[ProjectStorage, Depends(storage)],
) -> list[SnapshotFile]:
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
    del principal
    await projects.get_project(project_id, include_archived=False)
    return [_file(row) for row in await projects.list_files(project_id)]


@router.delete("/{project_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    project_id: str,
    file_id: str,
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> Response:
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
    principal: Annotated[AuthPrincipal, Depends(require_editor)],
    projects: Annotated[ProjectRepository, Depends(repository)],
) -> BuildAccepted:
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
    del principal
    return _build(await projects.get_build(project_id, build_id))


def _file(row: SnapshotFileRow) -> SnapshotFile:
    return SnapshotFile(
        id=row.id,
        filename=row.logical_filename,
        media_type=row.media_type,
        size=row.size,
        sha256=row.sha256,
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


def _project(row: ProjectRow, principal: AuthPrincipal) -> Project:
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
    is_editor = "editor" in principal.roles and row.state != "archived"
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
                create_conversation=row.state == "ready",
                edit_draft=is_editor and row.state not in {"queued", "building"},
                build=is_editor
                and row.state not in {"queued", "building"}
                and bool(draft and draft.files),
                archive=is_admin
                and row.state not in {"archived", "queued", "building"},
                restore=is_admin and row.state == "archived",
                purge=is_admin and row.state == "archived",
            ),
        }
    )
