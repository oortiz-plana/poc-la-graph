from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator

import httpx
import pytest

from app.config.settings import Settings
from app.main import create_app
from app.projects.storage import UploadValidationError, validate_filename
from app.projects.worker import KnowledgeWorker


@pytest.fixture
async def project_client(
    tmp_path: object,
) -> AsyncIterator[tuple[httpx.AsyncClient, Settings]]:
    from pathlib import Path

    root = Path(str(tmp_path))
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        conversation_database_url=f"sqlite+aiosqlite:///{root / 'workspace.db'}",
        project_storage_root=str(root / "projects"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client, settings


async def test_upload_build_and_project_scoped_conversation(
    project_client: tuple[httpx.AsyncClient, Settings],
) -> None:
    client, settings = project_client
    created = await client.post(
        "/api/v1/projects",
        headers={"Idempotency-Key": "create-1"},
        json={"name": "  Legal corpus  ", "description": "Synthetic test"},
    )
    assert created.status_code == 201
    project = created.json()
    assert project["name"] == "Legal corpus"
    project_id = project["id"]

    repeated = await client.post(
        "/api/v1/projects",
        headers={"Idempotency-Key": "create-1"},
        json={"name": "Ignored replay"},
    )
    assert repeated.json()["id"] == project_id

    raw = b"# Article 1\nA synthetic grounded rule.\n"
    digest = hashlib.sha256(raw).hexdigest()
    session_response = await client.post(
        f"/api/v1/projects/{project_id}/upload-sessions",
        headers={"Idempotency-Key": "upload-1"},
        json={
            "files": [
                {
                    "filename": "law.md",
                    "mediaType": "text/markdown",
                    "size": len(raw),
                    "sha256": digest,
                }
            ]
        },
    )
    assert session_response.status_code == 201
    session = session_response.json()
    upload_path = session["parts"][0]["uploadUrl"].removeprefix("/api/backend")
    uploaded = await client.put(upload_path, content=raw)
    assert uploaded.status_code == 204
    finalized = await client.post(
        f"/api/v1/projects/{project_id}/upload-sessions/{session['id']}/finalize",
        headers={"Idempotency-Key": "finalize-1"},
    )
    assert finalized.status_code == 200
    assert finalized.json()[0]["sha256"] == digest
    assert finalized.json()[0]["status"] == "uploaded"
    assert finalized.json()[0]["progressPercent"] == 0
    assert finalized.json()[0]["uploadedAt"]

    queued = await client.post(
        f"/api/v1/projects/{project_id}/builds",
        headers={"Idempotency-Key": "build-1"},
    )
    assert queued.status_code == 202
    queued_files = (await client.get(f"/api/v1/projects/{project_id}/files")).json()
    assert queued_files[0]["status"] == "queued"
    assert queued_files[0]["progressPercent"] == 5
    worker = KnowledgeWorker(settings)
    await worker.repository.initialize()
    try:
        build = await worker.repository.claim_build("test-worker")
        assert build is not None
        await worker._process(build)
    finally:
        await worker.repository.close()

    build_status = await client.get(
        f"/api/v1/projects/{project_id}/builds/{queued.json()['buildId']}"
    )
    assert build_status.json()["status"] == "ready"
    ready = (await client.get(f"/api/v1/projects/{project_id}")).json()
    assert ready["state"] == "ready"
    assert ready["activeDocumentCount"] == 1
    ready_files = (await client.get(f"/api/v1/projects/{project_id}/files")).json()
    assert ready_files[0]["status"] == "ready"
    assert ready_files[0]["progressPercent"] == 100
    conversation = await client.post(
        "/api/v1/conversations", json={"projectId": project_id}
    )
    assert conversation.status_code == 201
    assert conversation.json()["projectId"] == project_id


@pytest.mark.parametrize(
    "error_code",
    [
        "graphify_provider_authentication_failed",
        "graphify_provider_quota_or_rate_limit",
        "graphify_provider_timeout",
    ],
)
def test_worker_preserves_actionable_build_error_codes(error_code: str) -> None:
    assert KnowledgeWorker._error_code(RuntimeError(error_code)) == error_code


@pytest.mark.parametrize(
    "filename",
    [
        "Ley 100 de 1993.pdf",
        "Resolución (versión final).PDF",
        "evidence_v2-final.docx",
    ],
)
def test_accepts_safe_human_readable_upload_filenames(filename: str) -> None:
    assert validate_filename(filename) == filename


@pytest.mark.parametrize(
    "filename",
    ["../secret.md", "folder/source.pdf", "folder\\source.pdf", "bad\x00.pdf"],
)
def test_rejects_unsafe_upload_paths(filename: str) -> None:
    with pytest.raises(UploadValidationError):
        validate_filename(filename)


async def test_rejects_unsafe_upload_filename(
    project_client: tuple[httpx.AsyncClient, Settings],
) -> None:
    client, _ = project_client
    project = (
        await client.post(
            "/api/v1/projects",
            headers={"Idempotency-Key": "create-unsafe"},
            json={"name": "Unsafe"},
        )
    ).json()
    response = await client.post(
        f"/api/v1/projects/{project['id']}/upload-sessions",
        headers={"Idempotency-Key": "upload-unsafe"},
        json={
            "files": [
                {
                    "filename": "../secret.md",
                    "mediaType": "text/markdown",
                    "size": 1,
                    "sha256": "0" * 64,
                }
            ]
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == "upload_invalid"


async def test_project_membership_roles_and_last_owner_protection(
    project_client: tuple[httpx.AsyncClient, Settings],
) -> None:
    client, _ = project_client
    project = (
        await client.post(
            "/api/v1/projects",
            headers={"Idempotency-Key": "access-project"},
            json={"name": "Private project"},
        )
    ).json()
    project_id = project["id"]
    assert project["currentAccess"]["effectiveRole"] == "owner"
    assert project["allowedActions"]["manageAccess"] is True

    members = (
        await client.post(
            f"/api/v1/projects/{project_id}/members",
            headers={"Idempotency-Key": "add-manager"},
            json={
                "principals": [
                    {
                        "principalType": "user",
                        "principalId": "manager-subject",
                        "displayName": "Project Manager",
                    }
                ],
                "role": "manager",
            },
        )
    ).json()
    manager = next(item for item in members if item["principalId"] == "manager-subject")
    promoted = await client.patch(
        f"/api/v1/projects/{project_id}/members/{manager['id']}",
        json={"role": "owner"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "owner"

    removed = await client.delete(
        f"/api/v1/projects/{project_id}/members/{manager['id']}"
    )
    assert removed.status_code == 204
    owner = next(item for item in members if item["principalId"] == "development-user")
    final_owner = await client.delete(
        f"/api/v1/projects/{project_id}/members/{owner['id']}"
    )
    assert final_owner.status_code == 409

    activity = await client.get(f"/api/v1/projects/{project_id}/access-activity")
    assert activity.status_code == 200
    assert {item["action"] for item in activity.json()} >= {
        "access.membership_added",
        "access.role_changed",
        "access.membership_removed",
    }
