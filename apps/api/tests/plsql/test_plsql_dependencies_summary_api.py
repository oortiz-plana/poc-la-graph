"""PL/SQL unified dependencies endpoint API tests (category chips + lists)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-deps-summary.db'}",
        project_storage_root=str(tmp_path / "projects-deps-summary"),
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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-deps-summary-disabled.db'}",
        project_storage_root=str(tmp_path / "projects-deps-summary-disabled"),
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


async def test_dependencies_defaults_to_callers_with_full_counts(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"] == {
        "callers": 1,
        "callees": 0,
        "reads": 1,
        "writes": 0,
        "other": 0,
    }
    assert payload["total"] == 1
    assert payload["truncated"] is False
    edge = payload["items"][0]
    assert edge["relationship"] == "CALLS"
    assert edge["source"]["qualifiedName"] == "HR.PKG_PAYROLL.CALCULATE_MORA"


async def test_dependencies_reads_category_returns_table_edges(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": object_id, "category": "reads"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    edge = payload["items"][0]
    assert edge["relationship"] == "READS"
    assert edge["target"]["qualifiedName"] == "HR.EMPLOYEES"


async def test_dependencies_writes_category_for_routine(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "RUN_PAYROLL")
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": object_id, "category": "writes"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"] == {
        "callers": 0,
        "callees": 1,
        "reads": 0,
        "writes": 1,
        "other": 0,
    }
    assert payload["total"] == 1
    assert payload["items"][0]["target"]["qualifiedName"] == "HR.DEPARTMENTS"


async def test_dependencies_other_category_collects_view_and_trigger_edges(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEE_DETAILS")
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": object_id, "category": "other"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["counts"]["other"] == 2
    assert payload["total"] == 2
    assert {edge["relationship"] for edge in payload["items"]} == {
        "VIEW_DEPENDS_ON"
    }


async def test_dependencies_rejects_unknown_category(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": object_id, "category": "nonsense"},
    )
    assert response.status_code == 422


async def test_dependencies_unknown_object_returns_problem(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "analysis_not_found"


async def test_dependencies_disabled_adapter_returns_not_configured(
    disabled_client: httpx.AsyncClient,
) -> None:
    response = await disabled_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": "plsql://sample/HR/TABLE/EMPLOYEES"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "analysis_not_configured"
