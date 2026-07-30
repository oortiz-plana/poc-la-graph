from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

from app.agent.events import LifecycleEvent
from app.agent.models import Answer, ConversationTurn, GraphEvidence
from app.agent.workflow import KnowledgeWorkflow
from app.api.dependencies import get_workflow
from app.config.settings import Settings
from app.integrations.llm.mock import DeterministicModel
from app.integrations.llm.models import FollowUpResolutionOutput
from app.main import create_app


def _settings(database: Path) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        graphify_project_id="sample-project",
        conversation_database_url=f"sqlite+aiosqlite:///{database}",
        conversation_cleanup_interval_seconds=3600,
    )


def _parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    event_name = ""
    data = ""
    for line in body.splitlines() + [""]:
        if line.startswith("event: "):
            event_name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            data += line.removeprefix("data: ")
        elif not line and event_name:
            events.append((event_name, json.loads(data)))
            event_name, data = "", ""
    return events


class RecordingWorkflow:
    def __init__(self) -> None:
        self.histories: list[list[ConversationTurn]] = []

    async def stream(
        self,
        question: str,
        request_id: str,
        conversation_id: str,
        history: list[ConversationTurn] | None = None,
    ) -> AsyncIterator[LifecycleEvent]:
        self.histories.append(list(history or []))
        answer = Answer(
            request_id=request_id,
            conversation_id=conversation_id,
            answer=f"Answer to: {question}",
            confidence="high",
            graph_evidence=GraphEvidence(),
        )
        yield LifecycleEvent(
            type="message.started",
            request_id=request_id,
            conversation_id=conversation_id,
            message_id=f"message-{len(self.histories)}",
        )
        yield LifecycleEvent(
            type="answer.delta",
            request_id=request_id,
            conversation_id=conversation_id,
            delta=answer.answer,
        )
        yield LifecycleEvent(
            type="message.completed",
            request_id=request_id,
            conversation_id=conversation_id,
            result=answer,
        )


class CountingGraph:
    def __init__(self) -> None:
        self.searches: list[str] = []

    async def search(self, query: str) -> dict[str, Any]:
        self.searches.append(query)
        return {"nodes": [], "edges": [], "citations": []}

    async def get_neighbors(self, node_id: str, depth: int = 1) -> dict[str, Any]:
        del node_id, depth
        return {"nodes": [], "edges": []}


async def test_api_passes_only_completed_prior_exchanges_to_workflow(
    tmp_path: Path,
) -> None:
    workflow = RecordingWorkflow()
    app = create_app(_settings(tmp_path / "history.db"))
    app.dependency_overrides[get_workflow] = lambda: workflow

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            conversation = (await client.post("/api/v1/conversations")).json()
            endpoint = f"/api/v1/conversations/{conversation['id']}/messages"
            first = await client.post(endpoint, json={"message": "First question"})
            second = await client.post(endpoint, json={"message": "Follow up"})

    assert first.status_code == second.status_code == 200
    assert workflow.histories[0] == []
    assert [(turn.role, turn.content) for turn in workflow.histories[1]] == [
        ("user", "First question"),
        ("assistant", "Answer to: First question"),
    ]


async def test_api_streams_clarification_without_graphify(
    tmp_path: Path,
) -> None:
    graph = CountingGraph()
    workflow = KnowledgeWorkflow(
        graph,
        DeterministicModel(
            follow_up=FollowUpResolutionOutput(
                kind="clarification",
                clarification_question="¿A cuál ley te refieres?",
            )
        ),
    )
    app = create_app(_settings(tmp_path / "clarification.db"))
    app.dependency_overrides[get_workflow] = lambda: workflow

    async with app.router.lifespan_context(app):
        conversation = await app.state.store.create("sample-project")
        await app.state.store.add_user_message(
            conversation.id, "Compara la Ley 100 y la Ley 797."
        )
        await app.state.store.add_assistant_message(
            conversation.id,
            "Ambas leyes modifican el sistema pensional.",
            "completed",
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            response = await client.post(
                f"/api/v1/conversations/{conversation.id}/messages",
                json={"message": "¿Y qué cambió?"},
            )

    events = _parse_sse(response.text)
    assert response.status_code == 200
    assert [name for name, _ in events] == [
        "message.started",
        "answer.delta",
        "message.completed",
    ]
    assert events[-1][1]["result"]["responseType"] == "clarification"
    assert events[-1][1]["result"]["answer"] == "¿A cuál ley te refieres?"
    assert graph.searches == []


async def test_api_returns_409_while_conversation_lease_is_owned(
    tmp_path: Path,
) -> None:
    workflow = RecordingWorkflow()
    app = create_app(_settings(tmp_path / "lease.db"))
    app.dependency_overrides[get_workflow] = lambda: workflow

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            conversation = (await client.post("/api/v1/conversations")).json()
            await app.state.store.acquire_request(conversation["id"], "owner")
            response = await client.post(
                f"/api/v1/conversations/{conversation['id']}/messages",
                json={"message": "Concurrent request"},
                headers={"X-Request-ID": "contender"},
            )
            stored = (
                await client.get(f"/api/v1/conversations/{conversation['id']}")
            ).json()

    assert response.status_code == 409
    assert response.json() == {
        "requestId": "contender",
        "code": "conversation_busy",
        "message": "This conversation is already processing another request.",
    }
    assert stored["messages"] == []
    assert workflow.histories == []
