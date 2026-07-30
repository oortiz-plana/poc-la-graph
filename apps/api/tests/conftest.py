from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from app.agent.models import Citation, GraphEvidence, GraphNode
from app.agent.workflow import KnowledgeWorkflow
from app.api.dependencies import get_workflow
from app.config.settings import Settings
from app.integrations.llm.models import AnswerDraft, ModelResult, TokenUsage
from app.main import create_app


@pytest.fixture(autouse=True)
async def reset_sse_shutdown_state() -> AsyncIterator[None]:
    """Stop sse-starlette's server-lifetime watcher before each test loop closes."""
    from sse_starlette.sse import AppStatus, _thread_state

    AppStatus.should_exit = False
    AppStatus.enable_automatic_graceful_drain = True
    if hasattr(_thread_state, "shutdown_state"):
        del _thread_state.shutdown_state

    yield

    state = getattr(_thread_state, "shutdown_state", None)
    AppStatus.should_exit = True
    AppStatus.enable_automatic_graceful_drain = True
    if state is not None and state.watcher_started:
        await asyncio.sleep(0.6)
        assert not state.watcher_started
    if hasattr(_thread_state, "shutdown_state"):
        del _thread_state.shutdown_state


class FakeGraph:
    def __init__(self, search_result: Any | None = None) -> None:
        self.search_result = (
            search_result
            if search_result is not None
            else {
                "nodes": [
                    {
                        "id": "n1",
                        "label": "Graphify",
                        "type": "product",
                        "source": "synthetic.md",
                        "excerpt": "Graphify stores connected knowledge.",
                        "provenance": "explicit",
                    }
                ],
                "edges": [],
                "paths": [],
                "citations": [
                    {
                        "id": "c1",
                        "title": "Graphify",
                        "source": "synthetic.md",
                        "nodeId": "n1",
                        "provenance": "explicit",
                        "excerpt": "Graphify stores connected knowledge.",
                    }
                ],
                "graphVersion": "test-v1",
            }
        )
        self.searches: list[str] = []
        self.neighbor_calls: list[tuple[str, int]] = []

    async def search(self, query: str) -> Any:
        self.searches.append(query)
        return self.search_result

    async def get_neighbors(self, node_id: str, depth: int = 1) -> Any:
        self.neighbor_calls.append((node_id, depth))
        return {"nodes": [], "edges": [], "paths": []}


class FakeModel:
    def __init__(
        self,
        *,
        answer: str = "Graphify stores connected knowledge.",
        confidence: str = "high",
        citation_ids: list[str] | None = None,
        error: Exception | None = None,
    ) -> None:
        self.answer = answer
        self.confidence = confidence
        self.citation_ids = ["c1"] if citation_ids is None else citation_ids
        self.error = error
        self.requests: list[Any] = []

    async def generate(self, request: Any) -> ModelResult:
        self.requests.append(request)
        if self.error:
            raise self.error
        return ModelResult(
            output=AnswerDraft(
                answer=self.answer,
                confidence=self.confidence,
                citation_ids=self.citation_ids,
            ),
            model="fake",
            usage=TokenUsage(),
        )


@pytest.fixture
def graph() -> FakeGraph:
    return FakeGraph()


@pytest.fixture
def model() -> FakeModel:
    return FakeModel()


@pytest.fixture
def workflow(graph: FakeGraph, model: FakeModel) -> KnowledgeWorkflow:
    return KnowledgeWorkflow(graph, model)


@pytest.fixture
async def api_client(workflow: KnowledgeWorkflow) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        graphify_project_id="sample-project",
    )
    app = create_app(settings)
    app.dependency_overrides[get_workflow] = lambda: workflow
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            yield client


def completed_evidence() -> tuple[GraphEvidence, list[Citation]]:
    node = GraphNode(
        id="n1",
        label="Graphify",
        source="synthetic.md",
        excerpt="Graphify stores connected knowledge.",
        provenance="explicit",
    )
    citation = Citation(
        id="c1",
        title="Graphify",
        source="synthetic.md",
        nodeId="n1",
        provenance="explicit",
    )
    return GraphEvidence(nodes=[node]), [citation]
