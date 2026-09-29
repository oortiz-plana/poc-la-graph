"""Synthetic foreign-key analysis, direction, evidence, and contract regressions."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import get_args

import httpx
import pytest
import yaml

from app.config.settings import Settings
from app.integrations.plsql.synthetic import SyntheticPlsqlAnalysisClient
from app.main import create_app
from app.models.plsql import ImpactRelationship, PlsqlRelationship

ROOT = Path(__file__).resolve().parents[4]
SOURCE = Path(__file__).resolve().parents[1] / "fixtures/plsql/source"
EMPLOYEES = "plsql://sample/HR/TABLE/EMPLOYEES"
DEPARTMENTS = "plsql://sample/HR/TABLE/DEPARTMENTS"


@pytest.fixture
async def client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(
        Settings(
            llm_adapter="mock",
            graphify_adapter="mock",
            graphify_runtime_mode="synthetic",
            plsql_adapter="synthetic",
            plsql_project_id="sample",
            plsql_source_root=str(SOURCE),
            conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'fk.db'}",
            project_storage_root=str(tmp_path / "projects"),
            knowledge_ingest_on_startup=False,
        )
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as session:
            yield session


@pytest.mark.parametrize("object_id", [EMPLOYEES, DEPARTMENTS])
async def test_dependencies_include_incoming_and_outgoing_fk_with_source(
    client: httpx.AsyncClient,
    object_id: str,
) -> None:
    response = await client.get(
        "/api/v1/plsql/dependencies",
        params={
            "objectId": object_id,
            "category": "other",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    edge = next(e for e in payload["items"] if e["relationship"] == "FOREIGN_KEY")
    assert payload["counts"]["other"] == len(payload["items"])
    assert edge["source"]["id"] == EMPLOYEES
    assert edge["target"]["id"] == DEPARTMENTS
    evidence = edge["evidence"]
    stored = await client.get(
        "/api/v1/plsql/relationships/evidence",
        params={
            "relationshipId": edge["id"],
        },
    )
    assert stored.status_code == 200
    assert stored.json()["evidence"] == evidence
    source = await client.get(
        "/api/v1/plsql/files",
        params={
            "fileId": evidence["sourceFileId"],
            "startLine": evidence["startLine"],
        },
    )
    assert source.status_code == 200
    assert "foreign key" in source.json()["lines"][evidence["startLine"] - 1]


@pytest.mark.parametrize(
    "direction,anchor,peer",
    [
        ("upstream", DEPARTMENTS, EMPLOYEES),
        ("downstream", EMPLOYEES, DEPARTMENTS),
    ],
)
@pytest.mark.parametrize("explicit", [False, True])
async def test_impact_follows_fk_direction(
    client: httpx.AsyncClient,
    direction: str,
    anchor: str,
    peer: str,
    explicit: bool,
) -> None:
    params = {"objectId": anchor, "direction": direction}
    if explicit:
        params["relationship"] = "FOREIGN_KEY"
    response = await client.get("/api/v1/plsql/impact", params=params)
    assert response.status_code == 200
    payload = response.json()
    item = next(i for i in payload["items"] if i["dependent"]["id"] == peer)
    assert item["distance"] == 1
    assert item["paths"][0]["relationships"][0]["relationship"] == "FOREIGN_KEY"
    assert [n["id"] for n in item["paths"][0]["nodes"]] == [EMPLOYEES, DEPARTMENTS]
    if explicit:
        assert payload["count"] == 1
        assert payload["summary"]["tablesModified"] == 0


@pytest.mark.parametrize("relationship", [None, "FOREIGN_KEY"])
async def test_writes_only_excludes_foreign_keys(
    client: httpx.AsyncClient,
    relationship: str | None,
) -> None:
    params = {"objectId": DEPARTMENTS, "writesOnly": "true"}
    if relationship:
        params["relationship"] = relationship
    response = await client.get("/api/v1/plsql/impact", params=params)
    assert response.status_code == 200
    assert [i["dependent"]["name"] for i in response.json()["items"]] == ["RUN_PAYROLL"]
    assert all(
        e["relationship"] == "WRITES"
        for i in response.json()["items"]
        for p in i["paths"]
        for e in p["relationships"]
    )


async def test_fk_paths_are_directed_and_paginated(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/api/v1/plsql/paths",
        params={
            "from": EMPLOYEES,
            "to": DEPARTMENTS,
        },
    )
    assert response.status_code == 200
    assert (
        response.json()["items"][0]["relationships"][0]["relationship"] == "FOREIGN_KEY"
    )
    reverse = await client.get(
        "/api/v1/plsql/paths",
        params={
            "from": DEPARTMENTS,
            "to": EMPLOYEES,
        },
    )
    assert reverse.json()["items"] == []
    params = {
        "from": "plsql://sample/HR/PACKAGE/PKG_PAYROLL/PROCEDURE/RUN_PAYROLL",
        "to": DEPARTMENTS,
        "limit": "1",
    }
    paths = []
    while True:
        page = await client.get("/api/v1/plsql/paths", params=params)
        assert page.status_code == 200
        payload = page.json()
        paths.extend(payload["items"])
        if not payload["nextCursor"]:
            break
        params["cursor"] = payload["nextCursor"]
        assert len(paths) <= payload["count"]
    assert len(paths) == payload["count"] == len({p["id"] for p in paths})
    assert any(
        e["relationship"] == "FOREIGN_KEY" for p in paths for e in p["relationships"]
    )


async def test_fk_impact_pagination_preserves_full_summary(
    client: httpx.AsyncClient,
) -> None:
    params = {"objectId": DEPARTMENTS, "limit": "1"}
    items = []
    summary = None
    while True:
        response = await client.get("/api/v1/plsql/impact", params=params)
        assert response.status_code == 200
        payload = response.json()
        summary = summary or payload["summary"]
        assert payload["summary"] == summary
        items.extend(payload["items"])
        if not payload["nextCursor"]:
            break
        params["cursor"] = payload["nextCursor"]
        assert len(items) <= payload["count"]
    assert len(items) == payload["count"] == len({i["id"] for i in items})
    assert EMPLOYEES in {i["dependent"]["id"] for i in items}


async def test_fk_cycle_stays_bounded() -> None:
    client = SyntheticPlsqlAnalysisClient(project_id="sample")
    edge = next(e for e in client._edges if e.relationship == "FOREIGN_KEY")
    reverse = edge.model_copy(
        update={
            "id": "reverse-fk",
            "source_id": edge.target_id,
            "target_id": edge.source_id,
            "source_name": edge.target_name,
            "target_name": edge.source_name,
            "source_qualified_name": edge.target_qualified_name,
            "target_qualified_name": edge.source_qualified_name,
        }
    )
    client._edges += (reverse,)
    for direction in ("upstream", "downstream"):
        page = await client.impact_of(
            object_id=DEPARTMENTS,
            max_hops=5,
            limit=10,
            direction=direction,
            relationships=frozenset({"FOREIGN_KEY"}),
        )
        assert page.total == 1
        assert page.items[0].distance == 1
    page = await client.find_paths(
        from_id=EMPLOYEES, to_id=DEPARTMENTS, max_hops=5, limit=10
    )
    assert page.total == 1
    assert page.items[0].hop_count == 1


def test_frozen_relationship_enums_match_backend() -> None:
    frozen = yaml.safe_load((ROOT / "contracts/openapi/openapi.yaml").read_text())
    enum = frozen["components"]["schemas"]["PlsqlDependency"]["properties"][
        "relationship"
    ]["enum"]
    assert set(enum) == set(get_args(PlsqlRelationship))
    params = frozen["paths"]["/api/v1/plsql/impact"]["get"]["parameters"]
    schema = next(p["schema"] for p in params if p["name"] == "relationship")
    assert set(schema["anyOf"][0]["enum"]) == set(get_args(ImpactRelationship))
    dependency = json.loads(
        (ROOT / "contracts/schemas/plsql-dependency.schema.json").read_text()
    )
    assert set(dependency["$defs"]["relationship"]["enum"]) == set(
        get_args(PlsqlRelationship)
    )
