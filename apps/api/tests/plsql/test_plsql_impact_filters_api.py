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
        conversation_database_url=(
            f"sqlite+aiosqlite:///{tmp_path / 'plsql-impact-filters.db'}"
        ),
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


async def _summary(
    client: httpx.AsyncClient, object_id: str, **params: object
) -> dict[str, int]:
    response = await client.get(
        "/api/v1/plsql/impact/summary", params={"objectId": object_id, **params}
    )
    assert response.status_code == 200
    return response.json()["summary"]


async def test_impact_summary_is_independent_of_the_paged_report(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id}
    )
    assert response.status_code == 200
    assert "summary" not in response.json()
    summary = await plsql_client.get(
        "/api/v1/plsql/impact/summary", params={"objectId": object_id}
    )
    assert summary.status_code == 200
    assert summary.json()["object"]["id"] == object_id
    assert (
        summary.json()["summary"]["direct"] + summary.json()["summary"]["indirect"]
        == response.json()["count"]
    )


async def test_impact_summary_rejects_unknown_objects(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/impact/summary",
        params={"objectId": "plsql://sample/HR/TABLE/NOPE"},
    )
    assert response.status_code == 404


async def test_impact_includes_blast_radius_summary(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CALCULATE_BONUS")
    summary = await _summary(plsql_client, object_id)
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
    summary = await _summary(plsql_client, object_id)
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
    assert await _summary(plsql_client, object_id, relationship="WRITES") == {
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
    assert (await _summary(plsql_client, object_id, writesOnly="true"))["direct"] == 1
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
    summary = await _summary(plsql_client, object_id, depth=1)
    assert summary["direct"] == 5
    assert summary["indirect"] == 0
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
    assert (await _summary(plsql_client, object_id, directOnly="true"))["indirect"] == 0
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
    assert await _summary(plsql_client, object_id, direction="downstream") == {
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


async def test_impact_accepts_triggers_relationship(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "CREATE_EMPLOYEE")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={
            "objectId": object_id,
            "direction": "downstream",
            "relationship": "TRIGGERS",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert (
        await _summary(
            plsql_client,
            object_id,
            direction="downstream",
            relationship="TRIGGERS",
        )
    )["direct"] == 1
    assert [item["dependent"]["name"] for item in payload["items"]] == [
        "NOTIFY_HR_AUDIT"
    ]


async def test_impact_rejects_unknown_direction(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "direction": "sideways"},
    )
    assert response.status_code == 422


async def test_impact_scope_filters_items_before_paging_and_matches_summary(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")

    async def fetch(scope: str, **extra: object) -> dict:
        response = await plsql_client.get(
            "/api/v1/plsql/impact",
            params={"objectId": object_id, "scope": scope, **extra},
        )
        assert response.status_code == 200
        return response.json()

    full_summary = await _summary(plsql_client, object_id)

    direct = await fetch("direct")
    assert direct["count"] == full_summary["direct"] == 5
    assert {item["distance"] for item in direct["items"]} == {1}

    # Indirect rows sit behind the direct ones in the unfiltered order, so a
    # one-row page must still surface them rather than come back empty.
    first = await fetch("indirect", limit=1)
    assert first["count"] == full_summary["indirect"] == 2
    assert [item["distance"] > 1 for item in first["items"]] == [True]
    assert first["nextCursor"] is not None
    second = await fetch("indirect", limit=1, cursor=first["nextCursor"])
    assert [item["distance"] > 1 for item in second["items"]] == [True]
    assert second["nextCursor"] is None
    assert {item["id"] for item in first["items"]}.isdisjoint(
        {item["id"] for item in second["items"]}
    )

    packaged = await fetch("packages")
    assert 0 < packaged["count"] <= (await fetch("all"))["count"]
    assert all(
        item["dependent"]["kind"] == "Package"
        or item["dependent"]["qualifiedName"].count(".") >= 1
        for item in packaged["items"]
    )

    writers = await fetch("tablesModified")
    assert writers["count"] >= 1
    for item in writers["items"]:
        relationships = {
            edge["relationship"]
            for path in item["paths"]
            for edge in path["relationships"]
        }
        assert "WRITES" in relationships


async def test_impact_scope_cursor_is_not_reusable_across_scopes(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    first = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "scope": "indirect", "limit": 1},
    )
    cursor = first.json()["nextCursor"]
    replay = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={"objectId": object_id, "scope": "direct", "cursor": cursor},
    )
    assert replay.status_code == 422


async def test_impact_rejects_unknown_scope(plsql_client: httpx.AsyncClient) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "scope": "bogus"}
    )
    assert response.status_code == 422


async def test_impact_offset_addresses_pages_directly(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")

    async def fetch(**extra: object) -> dict:
        response = await plsql_client.get(
            "/api/v1/plsql/impact",
            params={"objectId": object_id, "limit": 3, **extra},
        )
        assert response.status_code == 200
        return response.json()

    first = await fetch()
    by_cursor = await fetch(cursor=first["nextCursor"])
    by_offset = await fetch(offset=3)
    assert [i["id"] for i in by_offset["items"]] == [
        i["id"] for i in by_cursor["items"]
    ]
    assert by_offset["count"] == first["count"]
    assert by_offset["nextCursor"] == by_cursor["nextCursor"]
    assert (await fetch(offset=first["count"]))["items"] == []


async def test_impact_rejects_cursor_together_with_offset(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    first = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "limit": 3}
    )
    response = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={
            "objectId": object_id,
            "limit": 3,
            "cursor": first.json()["nextCursor"],
            "offset": 3,
        },
    )
    assert response.status_code == 422


async def test_impact_package_order_lists_packages_alphabetically(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    payload = (
        await plsql_client.get(
            "/api/v1/plsql/impact", params={"objectId": object_id, "order": "package"}
        )
    ).json()
    keys = [
        (
            item["dependent"]["qualifiedName"].split(".")[1]
            if item["dependent"]["qualifiedName"].count(".") >= 2
            else (
                item["dependent"]["name"]
                if item["dependent"]["kind"] == "Package"
                else None
            )
        )
        for item in payload["items"]
    ]
    filed = [key for key in keys if key is not None]
    assert filed == sorted(filed, key=str.casefold)
    # Objects outside any package come after every packaged one.
    assert keys == filed + [None] * (len(keys) - len(filed))


async def test_impact_cursor_is_not_reusable_across_orders(
    plsql_client: httpx.AsyncClient,
) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    first = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "limit": 2}
    )
    replay = await plsql_client.get(
        "/api/v1/plsql/impact",
        params={
            "objectId": object_id,
            "order": "package",
            "cursor": first.json()["nextCursor"],
        },
    )
    assert replay.status_code == 422


async def test_impact_rejects_unknown_order(plsql_client: httpx.AsyncClient) -> None:
    object_id = await _object_id(plsql_client, "EMPLOYEES")
    response = await plsql_client.get(
        "/api/v1/plsql/impact", params={"objectId": object_id, "order": "size"}
    )
    assert response.status_code == 422
