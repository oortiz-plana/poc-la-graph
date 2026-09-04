"""PL/SQL analysis console Phase 3 API tests (paths + unresolved, synthetic)."""

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
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-paths.db'}",
        project_storage_root=str(tmp_path / "projects-paths"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


@pytest.fixture
async def two_hop_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter="synthetic",
        plsql_project_id="sample",
        plsql_max_hops=2,
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-hops.db'}",
        project_storage_root=str(tmp_path / "projects-hops"),
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


def _relationships(path_item: dict[str, object]) -> list[str]:
    relationships = path_item["relationships"]
    assert isinstance(relationships, list)
    return [edge["relationship"] for edge in relationships]  # type: ignore[index]


async def test_paths_return_ordered_bounded_paths_with_evidence(
    plsql_client: httpx.AsyncClient,
) -> None:
    from_id = await _object_id(plsql_client, "RUN_PAYROLL")
    to_id = await _object_id(plsql_client, "EMPLOYEES")

    response = await plsql_client.get(
        "/api/v1/plsql/paths", params={"from": from_id, "to": to_id}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["truncated"] is False
    assert payload["count"] == 3

    items = payload["items"]
    assert [item["hopCount"] for item in items] == [2, 3, 3]
    assert all(len(item["nodes"]) == item["hopCount"] + 1 for item in items)
    assert all(len(item["relationships"]) == item["hopCount"] for item in items)

    # Ordered by hop count, then lexicographic object ids: the two 3-hop
    # routes diverge at their third node (COUNT_EMPLOYEES sorts before the
    # PKG_EMPLOYEE member CALCULATE_BONUS under the plsql:// id scheme).
    assert [_node_names(item) for item in items] == [
        [
            "HR.PKG_PAYROLL.RUN_PAYROLL",
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.EMPLOYEES",
        ],
        [
            "HR.PKG_PAYROLL.RUN_PAYROLL",
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.COUNT_EMPLOYEES",
            "HR.EMPLOYEES",
        ],
        [
            "HR.PKG_PAYROLL.RUN_PAYROLL",
            "HR.PKG_PAYROLL.CALCULATE_MORA",
            "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
            "HR.EMPLOYEES",
        ],
    ]
    assert [_relationships(item) for item in items] == [
        ["CALLS", "READS"],
        ["CALLS", "CALLS", "READS"],
        ["CALLS", "CALLS", "READS"],
    ]

    # Every hop carries resolution and evidence coordinates.
    hop = items[0]["relationships"][0]
    assert hop["source"]["qualifiedName"] == "HR.PKG_PAYROLL.RUN_PAYROLL"
    assert hop["target"]["qualifiedName"] == "HR.PKG_PAYROLL.CALCULATE_MORA"
    assert hop["evidence"]["path"] == "hr/pkg_payroll.pkb"
    assert hop["evidence"]["startLine"] == 34

    # Determinism: repeated calls return identical payloads.
    repeated = await plsql_client.get(
        "/api/v1/plsql/paths", params={"from": from_id, "to": to_id}
    )
    assert repeated.status_code == 200
    assert repeated.json() == payload


async def test_paths_respect_hop_bound_not_row_truncation(
    plsql_client: httpx.AsyncClient,
    two_hop_client: httpx.AsyncClient,
) -> None:
    payroll = await _object_id(plsql_client, "RUN_PAYROLL")
    employees = await _object_id(plsql_client, "EMPLOYEES")

    # Default client (5 hops) sees all three routes.
    full = await plsql_client.get(
        "/api/v1/plsql/paths", params={"from": payroll, "to": employees}
    )
    assert full.status_code == 200
    assert full.json()["count"] == 3

    # With plsql_max_hops=2 only the 2-hop path remains; this is a hop cap,
    # not row truncation, so the envelope is not flagged truncated.
    bounded = await two_hop_client.get(
        "/api/v1/plsql/paths", params={"from": payroll, "to": employees}
    )
    assert bounded.status_code == 200
    payload = bounded.json()
    assert payload["count"] == 1
    assert payload["truncated"] is False
    assert payload["items"][0]["hopCount"] == 2

    # A pair connected in one hop stays reachable under a tight cap, ordered
    # by hop count (direct route first, then the two 2-hop routes).
    mora = await _object_id(plsql_client, "CALCULATE_MORA")
    one_hop = await two_hop_client.get(
        "/api/v1/plsql/paths", params={"from": mora, "to": employees}
    )
    assert one_hop.status_code == 200
    payload = one_hop.json()
    assert payload["count"] == 3
    assert [item["hopCount"] for item in payload["items"]] == [1, 2, 2]
    assert _relationships(payload["items"][0]) == ["READS"]


async def test_paths_truncate_at_row_limit(
    plsql_client: httpx.AsyncClient,
) -> None:
    payroll = await _object_id(plsql_client, "RUN_PAYROLL")
    employees = await _object_id(plsql_client, "EMPLOYEES")
    params = {"from": payroll, "to": employees}

    limited = await plsql_client.get(
        "/api/v1/plsql/paths", params={**params, "limit": 1}
    )
    assert limited.status_code == 200
    payload = limited.json()
    assert len(payload["items"]) == 1
    assert payload["truncated"] is True
    assert payload["count"] == 3

    wider = await plsql_client.get("/api/v1/plsql/paths", params={**params, "limit": 2})
    assert wider.status_code == 200
    assert len(wider.json()["items"]) == 2
    assert wider.json()["truncated"] is True
    assert wider.json()["count"] == 3


async def test_paths_unknown_or_disabled(
    plsql_client: httpx.AsyncClient,
    disabled_client: httpx.AsyncClient,
) -> None:
    employees = await _object_id(plsql_client, "EMPLOYEES")
    ghost = "plsql://sample/HR/TABLE/NOT_THERE"

    for from_id, to_id in ((ghost, employees), (employees, ghost)):
        response = await plsql_client.get(
            "/api/v1/plsql/paths", params={"from": from_id, "to": to_id}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "analysis_not_found"

    response = await disabled_client.get(
        "/api/v1/plsql/paths",
        params={"from": employees, "to": employees},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "analysis_not_configured"


async def test_unresolved_lists_ambiguous_and_unresolved_with_evidence(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get("/api/v1/plsql/unresolved")
    assert response.status_code == 200
    payload = response.json()
    assert payload["truncated"] is False
    assert payload["count"] == 2
    assert {item["resolution"] for item in payload["items"]} == {
        "AMBIGUOUS",
        "UNRESOLVED",
    }

    by_target = {item["target"]["qualifiedName"]: item for item in payload["items"]}
    unresolved = by_target["HR.PKG_LEGACY.RUN_UNKNOWN"]
    assert unresolved["resolution"] == "UNRESOLVED"
    assert unresolved["relationship"] == "CALLS"
    assert unresolved["evidence"]["path"] == "hr/pkg_payroll.pkb"
    assert unresolved["evidence"]["startLine"] == 40

    ambiguous = by_target["HR.EMPLOYEE_DETAILS"]
    assert ambiguous["resolution"] == "AMBIGUOUS"
    assert ambiguous["relationship"] == "READS"
    assert ambiguous["evidence"]["path"] == "hr/archive_employee.sql"
    assert ambiguous["evidence"]["startLine"] == 9

    repeated = await plsql_client.get("/api/v1/plsql/unresolved")
    assert repeated.status_code == 200
    assert repeated.json() == payload


async def test_unresolved_truncates_and_disabled(
    plsql_client: httpx.AsyncClient,
    disabled_client: httpx.AsyncClient,
) -> None:
    limited = await plsql_client.get("/api/v1/plsql/unresolved", params={"limit": 1})
    assert limited.status_code == 200
    payload = limited.json()
    assert len(payload["items"]) == 1
    assert payload["truncated"] is True
    assert payload["count"] == 2

    disabled = await disabled_client.get("/api/v1/plsql/unresolved")
    assert disabled.status_code == 503
    assert disabled.json()["code"] == "analysis_not_configured"
