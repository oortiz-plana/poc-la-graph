from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from app.config.settings import Settings
from app.integrations.graphify import GraphifyConfigurationError, GraphifyError
from app.knowledge.service import IngestionConflict
from app.main import create_app


class FakeKnowledgeService:
    def __init__(self, *, graph_status: str = "ready") -> None:
        self.status = graph_status
        self.raise_conflict = False
        self.forces: list[bool] = []

    async def start(self, *, force: bool = False) -> str:
        self.forces.append(force)
        if self.raise_conflict:
            raise IngestionConflict("already running")
        return "ingestion-1"

    def current(self) -> dict[str, Any]:
        return {
            "ingestionId": "ingestion-1",
            "status": "running",
            "startedAt": "2026-07-28T00:00:00+00:00",
            "completedAt": None,
            "errorCode": None,
        }

    def graph_status(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "activeGraphVersion": "v1" if self.status == "ready" else None,
            "graphifyVersion": "test",
            "generatedAt": (
                "2026-07-28T00:00:00+00:00" if self.status == "ready" else None
            ),
            "documentCount": 2 if self.status == "ready" else 0,
        }


async def client(
    *,
    admin_enabled: bool = True,
    service: FakeKnowledgeService | None = None,
    graphify_adapter: str = "mock",
) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(
        Settings(
            llm_adapter="mock",
            graphify_adapter=graphify_adapter,
            knowledge_admin_endpoints_enabled=admin_enabled,
            knowledge_ingest_on_startup=False,
        )
    )
    async with app.router.lifespan_context(app):
        app.state.knowledge = service or FakeKnowledgeService()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as value:
            yield value


async def test_admin_routes_status_force_and_conflict() -> None:
    service = FakeKnowledgeService()
    async for api in client(service=service):
        accepted = await api.post("/api/v1/knowledge/ingestions", json={"force": True})
        assert accepted.status_code == 202
        assert accepted.json() == {
            "ingestionId": "ingestion-1",
            "status": "accepted",
        }
        assert service.forces == [True]
        current = await api.get("/api/v1/knowledge/ingestions/current")
        graph = await api.get("/api/v1/knowledge/graph")
        assert current.json()["status"] == "running"
        assert graph.json()["activeGraphVersion"] == "v1"

        service.raise_conflict = True
        conflict = await api.post("/api/v1/knowledge/ingestions", json={})
        assert conflict.status_code == 409
        assert conflict.json()["detail"] == "already running"


@pytest.mark.parametrize(
    "path", ["/api/v1/knowledge/graph", "/api/v1/knowledge/ingestions/current"]
)
async def test_admin_routes_are_absent_when_disabled(path: str) -> None:
    async for api in client(admin_enabled=False):
        assert (await api.get(path)).status_code == 404


@pytest.mark.parametrize(
    ("graph_status", "expected_code", "ready"),
    [
        ("ready", 200, True),
        ("building", 503, False),
        ("unavailable", 503, False),
    ],
)
async def test_readiness_reflects_knowledge_graph(
    graph_status: str, expected_code: int, ready: bool
) -> None:
    async for api in client(
        service=FakeKnowledgeService(graph_status=graph_status),
        graphify_adapter="mock",
    ):
        response = await api.get("/ready")
        assert response.status_code == expected_code
        assert response.json()["ready"] is ready
        assert response.json()["components"]["knowledgeGraph"]["status"] == graph_status


@pytest.mark.parametrize(
    ("failure", "component_status"),
    [
        (GraphifyError("unavailable", "safe"), "unavailable"),
        (GraphifyConfigurationError("safe"), "incompatible"),
    ],
)
async def test_readiness_probes_mcp_without_exposing_errors(
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
    component_status: str,
) -> None:
    class FailingProbe:
        async def check_compatibility(self) -> None:
            raise failure

    monkeypatch.setattr(
        "app.api.router.build_graph_client",
        lambda settings, graph_version=None: FailingProbe(),
    )
    async for api in client(
        service=FakeKnowledgeService(graph_status="ready"),
        graphify_adapter="mcp",
    ):
        response = await api.get("/ready")
        assert response.status_code == 503
        assert (
            response.json()["components"]["graphifyMcp"]["status"] == component_status
        )
        assert "safe" not in response.text
