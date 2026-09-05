"""PL/SQL analysis health endpoint API tests (diagnostics by category)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.config.settings import Settings
from app.main import create_app


@pytest.fixture
async def plsql_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter="synthetic",
        plsql_project_id="sample",
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-health.db'}",
        project_storage_root=str(tmp_path / "projects-health"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


@pytest.fixture
async def disabled_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-health-disabled.db'}",
        project_storage_root=str(tmp_path / "projects-health-disabled"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


async def _object_id(client: httpx.AsyncClient, name: str) -> str:
    response = await client.get("/api/v1/plsql/objects", params={"q": name})
    assert response.status_code == 200
    matches = [item for item in response.json()["items"] if item["name"] == name]
    assert len(matches) == 1
    return matches[0]["id"]


async def test_health_reports_global_diagnostics_by_category(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get("/api/v1/plsql/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["unresolved"]["count"] == 1
    assert payload["unresolved"]["items"][0]["target"]["qualifiedName"] == (
        "HR.PKG_LEGACY.RUN_UNKNOWN"
    )
    assert payload["ambiguous"]["count"] == 1
    assert payload["ambiguous"]["items"][0]["source"]["qualifiedName"] == (
        "HR.ARCHIVE_EMPLOYEE"
    )
    assert payload["dynamicSql"]["count"] == 0
    assert payload["dynamicSql"]["items"] == []
    assert payload["parseErrors"]["count"] == 0
    assert payload["unsupported"]["count"] == 0
    assert payload["truncated"] is False


async def test_health_scopes_diagnostics_to_a_routine(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_MORA")
    response = await plsql_client.get(
        "/api/v1/plsql/health", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["unresolved"]["count"] == 1
    assert payload["ambiguous"]["count"] == 0


async def test_health_scopes_diagnostics_to_ambiguous_sources(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "ARCHIVE_EMPLOYEE")
    response = await plsql_client.get(
        "/api/v1/plsql/health", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["ambiguous"]["count"] == 1


async def test_health_unknown_object_returns_problem(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/health",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "analysis_not_found"


async def test_health_disabled_adapter_returns_not_configured(
    disabled_client: httpx.AsyncClient,
) -> None:
    response = await disabled_client.get("/api/v1/plsql/health")
    assert response.status_code == 503
    assert response.json()["code"] == "analysis_not_configured"
