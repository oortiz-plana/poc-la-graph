"""PL/SQL analysis console Phase 5 API tests (bounded impact reports)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-impact.db'}",
        project_storage_root=str(tmp_path / "projects-impact"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


@pytest.fixture
async def one_hop_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter="synthetic",
        plsql_project_id="sample",
        plsql_max_hops=1,
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-impact.db'}",
        project_storage_root=str(tmp_path / "projects-impact"),
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
        conversation_database_url=(
            f"sqlite+aiosqlite:///{tmp_path / 'plsql-disabled.db'}"
        ),
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


def _node_names(path_item: dict[str, object]) -> list[str]:
    nodes = path_item["nodes"]
    assert isinstance(nodes, list)
    return [node["qualifiedName"] for node in nodes]  # type: ignore[index]


async def test_impact_groups_transitive_dependents_with_explaining_paths(
    plsql_client: httpx.AsyncClient,
) -> None:
    employees = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": employees}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["truncated"] is False
    assert payload["count"] == 7
    assert payload["object"]["qualifiedName"] == "HR.EMPLOYEES"

    items = payload["items"]
    # Grouped by distance (1 hop, then 2 hops), then lexicographic ids.
    assert [item["distance"] for item in items] == [1, 1, 1, 1, 1, 2, 2]
    assert [item["dependent"]["qualifiedName"] for item in items] == [
        "HR.COUNT_EMPLOYEES",
        "HR.EMPLOYEE_DETAILS",
        "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
        "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
        "HR.ARCHIVE_EMPLOYEE",
        "HR.PKG_PAYROLL.RUN_PAYROLL",
    ]

    for item in items:
        # Every item carries at least one shortest explaining path whose hop
        # count equals the item distance and which ends at the changed object.
        assert item["paths"], item["dependent"]["qualifiedName"]
        for path in item["paths"]:
            assert path["hopCount"] == item["distance"]
            assert path["nodes"][0]["id"] == item["dependent"]["id"]
            assert path["nodes"][-1]["id"] == employees
            assert path["relationships"]
            for relationship in path["relationships"]:
                assert relationship["evidence"]["path"]
                assert relationship["evidence"]["startLine"]

    # ARCHIVE_EMPLOYEE depends on EMPLOYEES via two shortest 2-hop routes:
    # through CREATE_EMPLOYEE's WRITES and through the EMPLOYEE_DETAILS view.
    archive = items[5]
    assert archive["dependent"]["qualifiedName"] == "HR.ARCHIVE_EMPLOYEE"
    assert len(archive["paths"]) == 2
    final_hops = {
        path["relationships"][-1]["relationship"] for path in archive["paths"]
    }
    assert final_hops == {"WRITES", "VIEW_DEPENDS_ON"}

    # Determinism: repeated calls return identical payloads.
    repeated = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": employees}
    )
    assert repeated.status_code == 200
    assert repeated.json() == payload


async def test_impact_respects_hop_bound(
    plsql_client: httpx.AsyncClient,
    one_hop_client: httpx.AsyncClient,
) -> None:
    employees = await _object_id(plsql_client, "EMPLOYEES")

    full = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": employees}
    )
    assert full.status_code == 200
    assert full.json()["count"] == 7

    direct = await one_hop_client.get(
        "/api/v1/plsql/impact", params={"objectId": employees}
    )
    assert direct.status_code == 200
    payload = direct.json()
    assert payload["count"] == 5
    assert payload["truncated"] is False
    assert all(item["distance"] == 1 for item in payload["items"])


async def test_impact_expands_package_to_member_anchors(
    plsql_client: httpx.AsyncClient,
) -> None:
    package = await _object_id(plsql_client, "PKG_EMPLOYEE")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": package}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["object"]["name"] == "PKG_EMPLOYEE"
    assert payload["count"] == 3
    by_name = {
        item["dependent"]["qualifiedName"]: item["distance"]
        for item in payload["items"]
    }
    assert by_name == {
        "HR.ARCHIVE_EMPLOYEE": 1,
        "HR.PKG_PAYROLL.CALCULATE_MORA": 1,
        "HR.PKG_PAYROLL.RUN_PAYROLL": 2,
    }
    # Explaining paths end at the impacted member anchor inside the package.
    run_payroll = next(
        item for item in payload["items"] if item["dependent"]["name"] == "RUN_PAYROLL"
    )
    assert _node_names(run_payroll["paths"][0]) == [
        "HR.PKG_PAYROLL.RUN_PAYROLL",
        "HR.PKG_PAYROLL.CALCULATE_MORA",
        "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
    ]


async def test_impact_truncates_at_row_limit(
    plsql_client: httpx.AsyncClient,
) -> None:
    employees = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": employees, "limit": 3},
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 3
    assert payload["truncated"] is True
    assert payload["count"] == 7
    # Truncation keeps the deterministic head (all direct dependents).
    assert all(item["distance"] == 1 for item in payload["items"])


async def test_impact_unknown_or_disabled(
    plsql_client: httpx.AsyncClient,
    disabled_client: httpx.AsyncClient,
) -> None:
    unknown = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "analysis_not_found"

    disabled = await disabled_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": "plsql://sample/HR/TABLE/EMPLOYEES"},
    )
    assert disabled.status_code == 503
    assert disabled.json()["code"] == "analysis_not_configured"
