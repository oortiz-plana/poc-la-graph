from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from app.agent.workflow import KnowledgeWorkflow
from app.api.dependencies import get_workflow
from app.auth import AuthPrincipal
from app.auth.dependencies import current_principal
from app.config.settings import Settings
from app.main import create_app


def parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    parsed: list[tuple[str, dict[str, Any]]] = []
    event = ""
    data = ""
    for line in body.splitlines() + [""]:
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data += line[6:]
        elif not line and event:
            parsed.append((event, json.loads(data)))
            event, data = "", ""
    return parsed


async def test_health_readiness_and_conversation_crud(
    api_client: httpx.AsyncClient,
) -> None:
    health = await api_client.get("/health")
    ready = await api_client.get("/ready")
    created = await api_client.post("/api/v1/conversations")
    assert health.json() == {"status": "ok"}
    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert ready.json()["components"]["knowledgeGraph"]["status"] == "synthetic"
    assert ready.json()["components"]["graphifyMcp"]["status"] == "mock"
    assert ready.json()["components"]["llm"]["status"] == "mock"
    assert created.status_code == 201
    assert created.headers["x-request-id"]
    conversation_id = created.json()["id"]
    assert (
        await api_client.get(f"/api/v1/conversations/{conversation_id}")
    ).status_code == 200
    assert (
        await api_client.delete(f"/api/v1/conversations/{conversation_id}")
    ).status_code == 204
    assert (
        await api_client.get(f"/api/v1/conversations/{conversation_id}")
    ).status_code == 404


async def test_project_is_server_controlled(api_client: httpx.AsyncClient) -> None:
    response = await api_client.post(
        "/api/v1/conversations", json={"projectId": "attacker-project"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"
    assert "attacker-project" not in response.text


async def test_message_sse_order_citations_and_persistence(
    api_client: httpx.AsyncClient,
) -> None:
    created = await api_client.post("/api/v1/conversations")
    conversation_id = created.json()["id"]
    response = await api_client.post(
        f"/api/v1/conversations/{conversation_id}/messages",
        json={"message": "What is Graphify?"},
        headers={"X-Request-ID": "correlation-test"},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names == [
        "message.started",
        "tool.started",
        "tool.completed",
        "answer.delta",
        "citation.available",
        "message.completed",
    ]
    assert all(payload["requestId"] == "correlation-test" for _, payload in events)
    completed = events[-1][1]["result"]
    assert completed["citations"][0]["id"] == "c1"
    stored = (await api_client.get(f"/api/v1/conversations/{conversation_id}")).json()
    assert [message["role"] for message in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][-1]["result"]["confidence"] == "high"


async def test_invalid_input_and_unknown_conversation(
    api_client: httpx.AsyncClient,
) -> None:
    missing = await api_client.post(
        "/api/v1/conversations/does-not-exist/messages",
        json={"message": "question"},
    )
    assert missing.status_code == 404
    created = (await api_client.post("/api/v1/conversations")).json()
    invalid = await api_client.post(
        f"/api/v1/conversations/{created['id']}/messages",
        json={"message": ""},
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_request"


async def test_conversation_list_name_and_archive_lifecycle(
    api_client: httpx.AsyncClient,
) -> None:
    older = (await api_client.post("/api/v1/conversations")).json()
    newer = (await api_client.post("/api/v1/conversations")).json()
    assert older["name"] == "New conversation"
    assert older["archivedAt"] is None
    assert older["updatedAt"]

    await api_client.post(
        f"/api/v1/conversations/{older['id']}/messages",
        json={"message": "  What   is Graphify? Additional context."},
    )
    active = (
        await api_client.get(
            f"/api/v1/projects/{older['projectId']}/conversations?state=active"
        )
    ).json()
    assert active["items"][0]["id"] == older["id"]
    assert active["items"][0]["name"] == "What is Graphify?"
    assert active["nextCursor"] is None

    renamed = await api_client.patch(
        f"/api/v1/conversations/{newer['id']}", json={"name": "  Research  "}
    )
    assert renamed.json()["name"] == "Research"
    assert (
        await api_client.delete(f"/api/v1/conversations/{older['id']}")
    ).status_code == 204
    assert (
        await api_client.get(f"/api/v1/conversations/{older['id']}")
    ).status_code == 404
    archived = (
        await api_client.get(
            f"/api/v1/projects/{older['projectId']}/conversations?state=archived"
        )
    ).json()
    assert archived["items"][0]["id"] == older["id"]
    restored = await api_client.post(f"/api/v1/conversations/{older['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["archivedAt"] is None
    await api_client.delete(f"/api/v1/conversations/{older['id']}")
    assert (
        await api_client.delete(f"/api/v1/conversations/{older['id']}/purge")
    ).status_code == 204


async def test_real_mode_without_an_active_graph_is_not_ready() -> None:
    app = create_app(
        Settings(
            llm_adapter="mock",
            graphify_adapter="mock",
            graphify_runtime_mode="real",
            knowledge_ingest_on_startup=False,
        )
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json()["ready"] is False
    assert response.json()["components"]["knowledgeGraph"]["status"] == "unavailable"
    assert response.json()["components"]["graphifyMcp"]["status"] == "mock"
    assert response.json()["components"]["llm"]["status"] == "mock"


async def test_synthetic_users_have_independent_private_histories(
    tmp_path: Path, workflow: KnowledgeWorkflow
) -> None:
    app = create_app(
        Settings(
            llm_adapter="mock",
            graphify_adapter="mock",
            graphify_runtime_mode="synthetic",
            graphify_project_id="sample-project",
            conversation_database_url=(
                f"sqlite+aiosqlite:///{tmp_path / 'private-users.db'}"
            ),
            project_storage_root=str(tmp_path / "projects"),
        )
    )
    principal = {"value": AuthPrincipal("alice", "Alice", frozenset({"viewer"}))}
    app.dependency_overrides[current_principal] = lambda: principal["value"]
    app.dependency_overrides[get_workflow] = lambda: workflow

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            alice = (await client.post("/api/v1/conversations")).json()
            await client.post(
                f"/api/v1/conversations/{alice['id']}/messages",
                json={"message": "Alice private question"},
            )

            principal["value"] = AuthPrincipal("bob", "Bob", frozenset({"viewer"}))
            assert (
                await client.get(f"/api/v1/conversations/{alice['id']}")
            ).status_code == 404
            bob_list = await client.get("/api/v1/projects/sample-project/conversations")
            assert bob_list.json()["items"] == []
            bob = (await client.post("/api/v1/conversations")).json()

            principal["value"] = AuthPrincipal("alice", "Alice", frozenset({"viewer"}))
            alice_list = await client.get(
                "/api/v1/projects/sample-project/conversations"
            )
            assert [item["id"] for item in alice_list.json()["items"]] == [alice["id"]]
            assert bob["id"] not in alice_list.text
