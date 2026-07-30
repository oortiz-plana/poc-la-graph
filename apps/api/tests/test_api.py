from __future__ import annotations

import json
from typing import Any

import httpx

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
