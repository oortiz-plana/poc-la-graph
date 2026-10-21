"""One dependency per object pair, however many call sites it has."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'occ.db'}",
        project_storage_root=str(tmp_path / "projects-occ"),
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
    matches = [item for item in response.json()["items"] if item["name"] == name]
    assert len(matches) == 1
    return matches[0]["id"]


def _lines(edge: dict) -> list[int]:
    return [occurrence["startLine"] for occurrence in edge["occurrences"]]


async def test_callers_report_one_dependency_with_every_call_line(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/callers", params={"objectId": object_id}
    )
    assert response.status_code == 200
    payload = response.json()
    mora = [
        edge for edge in payload["items"] if edge["source"]["name"] == "CALCULATE_MORA"
    ]
    assert len(mora) == 1
    assert mora[0]["occurrenceCount"] == 2
    assert _lines(mora[0]) == [11, 29]
    assert mora[0]["evidence"]["startLine"] == 11
    # Totals count objects, not call sites.
    assert payload["count"] == len(payload["items"])
    sources = [edge["source"]["id"] for edge in payload["items"]]
    assert len(sources) == len(set(sources))


async def test_table_access_and_summary_counts_distinct_objects(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    reads = await plsql_client.get(
        "/api/v1/plsql/dependencies",
        params={"objectId": object_id, "category": "reads"},
    )
    assert reads.status_code == 200
    payload = reads.json()
    mora = [
        edge for edge in payload["items"] if edge["source"]["name"] == "CALCULATE_MORA"
    ]
    assert len(mora) == 1
    assert mora[0]["occurrenceCount"] == 2
    assert _lines(mora[0]) == [13, 21]
    assert payload["counts"]["reads"] == len(payload["items"])


async def test_single_call_site_keeps_one_occurrence(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "COUNT_EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/callers", params={"objectId": object_id}
    )
    items = response.json()["items"]
    assert items
    for edge in items:
        assert edge["occurrenceCount"] == len(edge["occurrences"]) == 1


async def test_impact_final_hop_carries_every_call_line(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "directOnly": "true"}
    )
    item = next(
        entry
        for entry in response.json()["items"]
        if entry["dependent"]["name"] == "CALCULATE_MORA"
    )
    final_edge = item["paths"][0]["relationships"][-1]
    assert final_edge["occurrenceCount"] == 2
    assert _lines(final_edge) == [11, 29]
