"""PL/SQL analysis console Phase 1 API tests (deterministic synthetic mode)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.config.settings import Settings
from app.integrations.plsql.fixtures import build_corpus
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


def _corpus_size() -> int:
    return len(build_corpus("sample"))


def _searchable_size() -> int:
    """Objects surfaced by search: the corpus minus non-addressable synonyms."""
    return sum(1 for record in build_corpus("sample") if record.kind != "Synonym")


async def test_search_returns_every_searchable_object_deterministically(
    plsql_client: httpx.AsyncClient,
) -> None:
    first = await plsql_client.get("/api/v1/plsql/objects")
    assert first.status_code == 200
    payload = first.json()
    assert payload["truncated"] is False
    assert payload["count"] == _searchable_size()
    assert len(payload["items"]) == _searchable_size()
    assert all(item["kind"] != "Synonym" for item in payload["items"])
    item = payload["items"][0]
    for key in (
        "id",
        "kind",
        "name",
        "schema",
        "qualifiedName",
        "projectId",
        "declaration",
    ):
        assert key in item
    assert item["declaration"]["sourceFileId"].startswith("file://sample/")
    assert item["declaration"]["path"]

    repeated = await plsql_client.get("/api/v1/plsql/objects")
    assert repeated.status_code == 200
    assert [entry["id"] for entry in repeated.json()["items"]] == [
        entry["id"] for entry in payload["items"]
    ]


async def test_search_filters_by_query_and_kinds(
    plsql_client: httpx.AsyncClient,
) -> None:
    by_query = await plsql_client.get("/api/v1/plsql/objects", params={"q": "payroll"})
    assert by_query.status_code == 200
    payload = by_query.json()
    assert payload["count"] == 3
    assert all(
        "payroll" in entry["qualifiedName"].casefold() for entry in payload["items"]
    )

    by_kinds = await plsql_client.get(
        "/api/v1/plsql/objects",
        params=[("kinds", "Table"), ("kinds", "View")],
    )
    assert by_kinds.status_code == 200
    kinds_payload = by_kinds.json()
    assert {entry["kind"] for entry in kinds_payload["items"]} == {
        "Table",
        "View",
    }
    assert kinds_payload["count"] == 3

    combined = await plsql_client.get(
        "/api/v1/plsql/objects",
        params={"q": "employee", "kinds": "Table"},
    )
    assert combined.status_code == 200
    combined_payload = combined.json()
    assert [entry["name"] for entry in combined_payload["items"]] == ["EMPLOYEES"]


async def test_search_excludes_synonyms(
    plsql_client: httpx.AsyncClient,
) -> None:
    all_objects = await plsql_client.get("/api/v1/plsql/objects")
    assert all_objects.status_code == 200
    payload = all_objects.json()
    assert payload["count"] == _searchable_size()
    assert all(item["kind"] != "Synonym" for item in payload["items"])

    # An explicit Synonym filter still surfaces nothing: synonyms are not
    # addressable objects in search.
    explicit = await plsql_client.get(
        "/api/v1/plsql/objects", params={"kinds": "Synonym"}
    )
    assert explicit.status_code == 200
    assert explicit.json()["count"] == 0
    assert explicit.json()["items"] == []


async def test_search_is_case_insensitive_and_truncates_at_limit(
    plsql_client: httpx.AsyncClient,
) -> None:
    case_insensitive = await plsql_client.get(
        "/api/v1/plsql/objects", params={"q": "PayRolL"}
    )
    assert case_insensitive.status_code == 200
    assert case_insensitive.json()["count"] == 3

    truncated = await plsql_client.get("/api/v1/plsql/objects", params={"limit": 3})
    assert truncated.status_code == 200
    payload = truncated.json()
    assert len(payload["items"]) == 3
    assert payload["truncated"] is True
    assert payload["count"] == _searchable_size()


async def test_search_rejects_unknown_kind(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/objects", params={"kinds": "Widget"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_request"


async def test_object_detail_returns_full_record(
    plsql_client: httpx.AsyncClient,
) -> None:
    search = await plsql_client.get(
        "/api/v1/plsql/objects", params={"q": "CALCULATE_MORA"}
    )
    object_id = search.json()["items"][0]["id"]

    detail = await plsql_client.get(
        "/api/v1/plsql/object", params={"objectId": object_id}
    )
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["id"] == object_id
    assert payload["kind"] == "Function"
    assert payload["owner"] == "PKG_PAYROLL"
    assert payload["signature"] == "VARCHAR2"
    assert payload["returnType"] == "NUMBER"
    assert payload["declaration"]["path"] == "hr/pkg_payroll.pkb"
    assert payload["declaration"]["startLine"] == 9


async def test_object_not_found_returns_problem(
    plsql_client: httpx.AsyncClient,
) -> None:
    response = await plsql_client.get(
        "/api/v1/plsql/object",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert response.status_code == 404
    assert response.json()["code"] == "analysis_not_found"


async def test_disabled_adapter_returns_not_configured(
    disabled_client: httpx.AsyncClient,
) -> None:
    search = await disabled_client.get("/api/v1/plsql/objects")
    assert search.status_code == 503
    assert search.json()["code"] == "analysis_not_configured"

    detail = await disabled_client.get(
        "/api/v1/plsql/object",
        params={"objectId": "plsql://sample/HR/TABLE/EMPLOYEES"},
    )
    assert detail.status_code == 503
    assert detail.json()["code"] == "analysis_not_configured"
