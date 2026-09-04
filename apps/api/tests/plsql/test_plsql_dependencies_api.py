"""PL/SQL analysis console Phase 2 API tests (typed dependencies, synthetic)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql.db'}",
        project_storage_root=str(tmp_path / "projects"),
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
    db_path = tmp_path / "plsql-disabled.db"
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        conversation_database_url=f"sqlite+aiosqlite:///{db_path}",
        project_storage_root=str(tmp_path / "projects-disabled"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


async def _object_id(client: httpx.AsyncClient, query: str) -> str:
    response = await client.get("/api/v1/plsql/objects", params={"q": query})
    assert response.status_code == 200
    matches = [item for item in response.json()["items"] if item["name"] == query]
    assert len(matches) == 1
    return matches[0]["id"]


async def test_callers_return_incoming_calls_with_evidence(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/callers", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["truncated"] is False
    assert payload["count"] == 1
    edge = payload["items"][0]
    assert edge["relationship"] == "CALLS"
    assert edge["resolution"] == "INFERRED"
    assert edge["source"]["qualifiedName"] == "HR.PKG_PAYROLL.CALCULATE_MORA"
    assert edge["target"]["qualifiedName"] == "HR.PKG_EMPLOYEE.CALCULATE_BONUS"
    assert edge["evidence"]["path"] == "hr/pkg_payroll.pkb"
    assert edge["evidence"]["startLine"] == 11


async def test_callees_include_unresolved_placeholders(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_MORA")
    response = await plsql_client.get(
        "/api/v1/plsql/callees", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 3
    targets = {edge["target"]["name"]: edge["resolution"] for edge in payload["items"]}
    assert targets["CALCULATE_BONUS"] == "INFERRED"
    assert targets["COUNT_EMPLOYEES"] == "EXACT"
    assert targets["RUN_UNKNOWN"] == "UNRESOLVED"


async def test_table_access_for_package_expands_members(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "PKG_PAYROLL")
    response = await plsql_client.get(
        "/api/v1/plsql/table-access", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    pairs = {
        (edge["relationship"], edge["target"]["qualifiedName"])
        for edge in payload["items"]
    }
    assert pairs == {
        ("READS", "HR.EMPLOYEES"),
        ("WRITES", "HR.DEPARTMENTS"),
    }
    sources = {edge["source"]["qualifiedName"] for edge in payload["items"]}
    assert sources == {
        "HR.PKG_PAYROLL.CALCULATE_MORA",
        "HR.PKG_PAYROLL.RUN_PAYROLL",
    }


async def test_table_access_for_table_lists_actors_and_triggers(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/table-access", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 6
    by_source = {
        edge["source"]["qualifiedName"]: edge["relationship"]
        for edge in payload["items"]
    }
    assert by_source["HR.TRG_EMPLOYEES_AUDIT"] == "TRIGGER_ON"
    assert by_source["HR.EMPLOYEE_DETAILS"] == "VIEW_DEPENDS_ON"
    assert by_source["HR.PKG_EMPLOYEE.CREATE_EMPLOYEE"] == "WRITES"
    assert set(by_source.values()) == {
        "READS",
        "WRITES",
        "TRIGGER_ON",
        "VIEW_DEPENDS_ON",
    }


async def test_dependency_limit_truncates(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/table-access",
        params={"objectId": object_id, "limit": 2},
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 2
    assert payload["truncated"] is True
    assert payload["count"] == 6


async def test_unknown_object_is_404(
    plsql_client: httpx.AsyncClient,
) -> None:
    for endpoint in ("callers", "callees", "table-access"):
        response = await plsql_client.get(
            f"/api/v1/plsql/{endpoint}",
            params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
        )
        assert response.status_code == 404
        assert response.json()["code"] == "analysis_not_found"


async def test_disabled_adapter_returns_503(
    disabled_client: httpx.AsyncClient,
) -> None:
    for endpoint in ("callers", "callees", "table-access"):
        response = await disabled_client.get(
            f"/api/v1/plsql/{endpoint}",
            params={"objectId": "plsql://sample/HR/PACKAGE/PKG_PAYROLL"},
        )
        assert response.status_code == 503
        assert response.json()["code"] == "analysis_not_configured"


async def test_readiness_reports_synthetic_analysis(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get("/ready")
    assert response.status_code == 200
    assert response.json()["components"]["analysis"]["status"] == "synthetic"


async def test_readiness_reports_disabled_analysis(
    disabled_client: httpx.AsyncClient,
) -> None:
    response = await disabled_client.get("/ready")
    assert response.status_code == 200
    assert response.json()["components"]["analysis"]["status"] == "disabled"
