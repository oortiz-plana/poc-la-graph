"""PL/SQL analysis console Phase 4 API tests (source evidence, guards, files)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

from app.config.settings import Settings
from app.main import create_app

FIXTURE_SOURCE_ROOT = (
    Path(__file__).resolve().parents[1] / "fixtures" / "plsql" / "source"
)


@asynccontextmanager
async def _plsql_app_client(
    tmp_path: Path,
    *,
    adapter: str = "synthetic",
    **overrides: object,
) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter=adapter,
        plsql_project_id="sample",
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-source.db'}",
        project_storage_root=str(tmp_path / "projects-source"),
        knowledge_ingest_on_startup=False,
        **overrides,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


@pytest.fixture
async def plsql_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    async with _plsql_app_client(
        tmp_path, plsql_source_root=str(FIXTURE_SOURCE_ROOT)
    ) as client:
        yield client


@pytest.fixture
async def no_root_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    async with _plsql_app_client(tmp_path) as client:
        yield client


@pytest.fixture
async def cap_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    async with _plsql_app_client(
        tmp_path,
        plsql_source_root=str(FIXTURE_SOURCE_ROOT),
        plsql_max_source_bytes=1024,
    ) as client:
        yield client


@pytest.fixture
async def disabled_client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    async with _plsql_app_client(tmp_path, adapter="disabled") as client:
        yield client


async def _object_id(client: httpx.AsyncClient, query: str) -> str:
    response = await client.get("/api/v1/plsql/objects", params={"q": query})
    assert response.status_code == 200
    matches = [item for item in response.json()["items"] if item["name"] == query]
    assert len(matches) == 1
    return matches[0]["id"]


def _source_lines(relative: str) -> list[str]:
    return (FIXTURE_SOURCE_ROOT / relative).read_text(encoding="utf-8").splitlines()


async def test_object_source_returns_file_content_with_declaration_highlight(
    plsql_client: httpx.AsyncClient,
) -> None:
    run_payroll = await _object_id(plsql_client, "RUN_PAYROLL")
    response = await plsql_client.get(
        "/api/v1/plsql/source", params={"objectId": run_payroll}
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["file"]["fileId"] == "file://sample/hr/pkg_payroll.pkb"
    assert payload["file"]["path"] == "hr/pkg_payroll.pkb"
    assert payload["highlight"] == {"startLine": 30, "endLine": 30}
    expected = _source_lines("hr/pkg_payroll.pkb")
    assert payload["lines"] == expected
    assert payload["lines"][29] == "  procedure run_payroll is"

    repeated = await plsql_client.get(
        "/api/v1/plsql/source", params={"objectId": run_payroll}
    )
    assert repeated.status_code == 200
    assert repeated.json() == payload


async def test_file_source_returns_content_and_echoes_requested_range(
    plsql_client: httpx.AsyncClient,
) -> None:
    file_id = "file://sample/hr/pkg_employee.pkb"
    response = await plsql_client.get("/api/v1/plsql/files", params={"fileId": file_id})
    assert response.status_code == 200
    payload = response.json()
    assert payload["file"]["path"] == "hr/pkg_employee.pkb"
    assert payload["highlight"] is None
    assert payload["lines"] == _source_lines("hr/pkg_employee.pkb")

    ranged = await plsql_client.get(
        "/api/v1/plsql/files",
        params={"fileId": file_id, "startLine": 21, "endLine": 25},
    )
    assert ranged.status_code == 200
    assert ranged.json()["highlight"] == {"startLine": 21, "endLine": 25}

    # endLine defaults to startLine when omitted.
    single = await plsql_client.get(
        "/api/v1/plsql/files",
        params={"fileId": file_id, "startLine": 7},
    )
    assert single.status_code == 200
    assert single.json()["highlight"] == {"startLine": 7, "endLine": 7}


async def test_relationship_evidence_returns_one_edge_with_coordinates(
    plsql_client: httpx.AsyncClient,
) -> None:
    mora = await _object_id(plsql_client, "CALCULATE_MORA")
    callees = await plsql_client.get("/api/v1/plsql/callees", params={"objectId": mora})
    assert callees.status_code == 200
    unresolved = next(
        edge
        for edge in callees.json()["items"]
        if edge["target"]["name"] == "RUN_UNKNOWN"
    )

    response = await plsql_client.get(
        "/api/v1/plsql/relationships/evidence",
        params={"relationshipId": unresolved["id"]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == unresolved["id"]
    assert payload["relationship"] == "CALLS"
    assert payload["resolution"] == "UNRESOLVED"
    assert payload["evidence"]["path"] == "hr/pkg_payroll.pkb"
    assert payload["evidence"]["startLine"] == 40
    assert payload["source"]["qualifiedName"] == "HR.PKG_PAYROLL.CALCULATE_MORA"
    assert payload["target"]["qualifiedName"] == "HR.PKG_LEGACY.RUN_UNKNOWN"

    unknown = await plsql_client.get(
        "/api/v1/plsql/relationships/evidence",
        params={"relationshipId": "edge://sample/CALLS/no/such/edge"},
    )
    assert unknown.status_code == 404
    assert unknown.json()["code"] == "analysis_not_found"


async def test_unknown_objects_files_and_disabled(
    plsql_client: httpx.AsyncClient,
    disabled_client: httpx.AsyncClient,
) -> None:
    unknown_object = await plsql_client.get(
        "/api/v1/plsql/source",
        params={"objectId": "plsql://sample/HR/TABLE/NOT_THERE"},
    )
    assert unknown_object.status_code == 404
    assert unknown_object.json()["code"] == "analysis_not_found"

    unknown_file = await plsql_client.get(
        "/api/v1/plsql/files",
        params={"fileId": "file://sample/hr/not_there.sql"},
    )
    assert unknown_file.status_code == 404
    assert unknown_file.json()["code"] == "analysis_not_found"

    for endpoint in (
        ("source", {"objectId": "plsql://sample/HR/TABLE/EMPLOYEES"}),
        ("files", {"fileId": "file://sample/hr/employees.sql"}),
        (
            "relationships/evidence",
            {"relationshipId": "edge://sample/CALLS/x/y"},
        ),
    ):
        path, params = endpoint
        response = await disabled_client.get(f"/api/v1/plsql/{path}", params=params)
        assert response.status_code == 503
        assert response.json()["code"] == "analysis_not_configured"


async def test_traversal_attempts_are_rejected(
    plsql_client: httpx.AsyncClient,
) -> None:
    attacks = [
        "file://sample/../../etc/passwd",
        "file://sample/hr/../hr/employees.sql",
        "file://sample/hr/employees.sql/../../outside.sql",
        "/etc/passwd",
        "file://sample//etc/passwd",
    ]
    for attack in attacks:
        response = await plsql_client.get(
            "/api/v1/plsql/files", params={"fileId": attack}
        )
        assert response.status_code == 404, attack
        assert response.json()["code"] == "analysis_not_found", attack
        assert "root:" not in response.text, attack


async def test_symlink_escape_is_rejected_without_leaking(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside-secret.sql"
    outside.write_text(
        "-- TOP-SECRET-OUTSIDE-CONTENT marker\nselect 1 from dual;\n",
        encoding="utf-8",
    )
    source_root = tmp_path / "source"
    hr = source_root / "hr"
    hr.mkdir(parents=True)
    (hr / "employees.sql").symlink_to(outside)

    async with _plsql_app_client(
        tmp_path, plsql_source_root=str(source_root)
    ) as client:
        employees = await _object_id(client, "EMPLOYEES")
        response = await client.get(
            "/api/v1/plsql/source", params={"objectId": employees}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "analysis_not_found"
        assert "TOP-SECRET-OUTSIDE-CONTENT" not in response.text


async def test_oversized_file_is_rejected_by_byte_cap(
    cap_client: httpx.AsyncClient,
) -> None:
    # employees.sql in the fixture root is > 1024 bytes (the cap minimum).
    employees = await _object_id(cap_client, "EMPLOYEES")
    by_object = await cap_client.get(
        "/api/v1/plsql/source", params={"objectId": employees}
    )
    assert by_object.status_code == 503
    assert by_object.json()["code"] == "analysis_limit_exceeded"

    by_file = await cap_client.get(
        "/api/v1/plsql/files",
        params={"fileId": "file://sample/hr/employees.sql"},
    )
    assert by_file.status_code == 503
    assert by_file.json()["code"] == "analysis_limit_exceeded"


async def test_missing_source_root_is_not_configured(
    no_root_client: httpx.AsyncClient,
) -> None:
    response = await no_root_client.get(
        "/api/v1/plsql/files",
        params={"fileId": "file://sample/hr/employees.sql"},
    )
    assert response.status_code == 503
    assert response.json()["code"] == "analysis_not_configured"
