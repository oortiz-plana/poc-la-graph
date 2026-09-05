"""PL/SQL impact endpoint filter and blast-radius tests (Release 2 usability)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-impact-filters.db'}",
        project_storage_root=str(tmp_path / "projects-impact-filters"),
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


async def test_impact_includes_blast_radius_summary(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id}
    )
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary == {
        "direct": 1,
        "indirect": 1,
        "packages": 1,
        "tablesModified": 0,
    }


async def test_impact_summary_for_table_reports_packages_and_tables_modified(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id}
    )
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary["direct"] == 5
    assert summary["indirect"] == 2
    assert summary["packages"] == 2
    assert summary["tablesModified"] == 1


async def test_impact_relationship_filter_limits_traversal(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "relationship": "WRITES"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == {
        "direct": 1,
        "indirect": 0,
        "packages": 1,
        "tablesModified": 1,
    }
    assert [item["dependent"]["name"] for item in payload["items"]] == [
        "CREATE_EMPLOYEE"
    ]


async def test_impact_writes_only_alias_matches_relationship_filter(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "writesOnly": "true"},
    )
    assert response.status_code == 200
    assert response.json()["summary"]["direct"] == 1
    assert [item["dependent"]["name"] for item in response.json()["items"]] == [
        "CREATE_EMPLOYEE"
    ]


async def test_impact_depth_caps_hops(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "depth": 1}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["direct"] == 5
    assert payload["summary"]["indirect"] == 0
    assert payload["count"] == 5


async def test_impact_direct_only_matches_depth_one(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "directOnly": "true"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["indirect"] == 0
    assert payload["count"] == 5


async def test_impact_downstream_lists_dependencies(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "RUN_PAYROLL")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "direction": "downstream"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"] == {
        "direct": 2,
        "indirect": 3,
        "packages": 2,
        "tablesModified": 1,
    }
    names = {item["dependent"]["name"] for item in payload["items"]}
    assert names == {
        "CALCULATE_MORA",
        "DEPARTMENTS",
        "CALCULATE_BONUS",
        "EMPLOYEES",
        "COUNT_EMPLOYEES",
    }


async def test_impact_rejects_unknown_relationship(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "relationship": "NONSENSE"},
    )
    assert response.status_code == 422


async def test_impact_rejects_unknown_direction(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "direction": "sideways"},
    )
    assert response.status_code == 422
