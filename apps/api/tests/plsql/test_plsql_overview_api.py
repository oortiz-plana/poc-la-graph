"""PL/SQL overview endpoint API tests (headline metrics for the Overview tab)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-overview.db'}",
        project_storage_root=str(tmp_path / "projects-overview"),
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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-overview-disabled.db'}",
        project_storage_root=str(tmp_path / "projects-overview-disabled"),
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


async def test_overview_returns_headline_counts_for_a_routine(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/overview", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["object"]["qualifiedName"] == "HR.PKG_EMPLOYEE.CALCULATE_BONUS"
    assert payload["directDependents"] == 1
    assert payload["indirectDependents"] == 1
    assert payload["callers"] == 1
    assert payload["callees"] == 0
    assert payload["tablesAccessed"] == 1
    assert [caller["qualifiedName"] for caller in payload["topCallers"]] == [
        "HR.PKG_PAYROLL.CALCULATE_MORA"
    ]


async def test_overview_aggregates_package_members(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "PKG_EMPLOYEE")
    response = await plsql_client.get(
        "/api/v1/plsql/overview", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["directDependents"] == 2
    assert payload["indirectDependents"] == 1
    assert payload["callers"] == 2
    assert payload["callees"] == 0
    assert payload["tablesAccessed"] == 2
    assert [caller["qualifiedName"] for caller in payload["topCallers"]] == [
        "HR.ARCHIVE_EMPLOYEE",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
    ]


async def test_overview_counts_table_dependents_across_relationship_types(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/overview", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["directDependents"] == 5
    assert payload["indirectDependents"] == 2
    assert payload["callers"] == 0
    assert payload["callees"] == 0
    assert payload["topCallers"] == []


async def test_overview_bounds_top_callers_without_changing_counts(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "PKG_EMPLOYEE")
    response = await plsql_client.get(
        "/api/v1/plsql/overview", params={"objectId": object_id, "top": 1}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["callers"] == 2
    assert [caller["qualifiedName"] for caller in payload["topCallers"]] == [
        "HR.ARCHIVE_EMPLOYEE"
    ]


async def test_overview_unknown_object_returns_problem(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/overview",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "analysis_not_found"


async def test_overview_disabled_adapter_returns_not_configured(
    disabled_client: httpx.AsyncClient,
) -> None:
    response = await disabled_client.get(
        "/api/v1/plsql/overview",
        params={"objectId": "plsql://sample/HR/TABLE/EMPLOYEES"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "analysis_not_configured"
