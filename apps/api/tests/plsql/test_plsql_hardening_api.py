"""PL/SQL analysis console Phase 6 hardening tests (bounds sweep, readiness)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.config.settings import Settings
from app.integrations.plsql import PlsqlUnavailable
from app.main import create_app

FIXTURE_SOURCE_ROOT = (
    Path(__file__).resolve().parents[1] / "fixtures" / "plsql" / "source"
)


class _OkAnalysisClient:
    async def check_connectivity(self) -> str:
        return "connected"


class _BrokenAnalysisClient:
    async def check_connectivity(self) -> str:
        raise PlsqlUnavailable("analysis backend is down")


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter=overrides.pop("plsql_adapter", "synthetic"),
        plsql_project_id="sample",
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-harden.db'}",
        project_storage_root=str(tmp_path / "projects-harden"),
        knowledge_ingest_on_startup=False,
        **overrides,
    )


@asynccontextmanager
async def _app_client(
    tmp_path: Path,
    *,
    analysis_override: object | None = None,
    **overrides: object,
) -> AsyncIterator[tuple[object, httpx.AsyncClient]]:
    settings = _settings(tmp_path, **overrides)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        if analysis_override is not None:
            app.state.plsql_analysis = analysis_override
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield app, client


async def _object_id(client: httpx.AsyncClient, query: str) -> str:
    response = await client.get("/api/v1/plsql/objects", params={"q": query})
    assert response.status_code == 200
    matches = [item for item in response.json()["items"] if item["name"] == query]
    assert len(matches) == 1
    return matches[0]["id"]


# --- Configuration caps ---------------------------------------------------


def test_settings_reject_out_of_bounds_configuration(tmp_path: Path) -> None:
    for override in (
        {"plsql_max_rows": 201},
        {"plsql_max_rows": 0},
        {"plsql_max_hops": 6},
        {"plsql_max_hops": 0},
        {"plsql_max_source_bytes": 10_485_761},
        {"plsql_max_source_bytes": 1023},
        {"plsql_query_timeout_seconds": 0},
        {"plsql_query_timeout_seconds": 300.1},
    ):
        with pytest.raises(ValidationError):
            _settings(tmp_path, **override)


def test_settings_accept_cap_edge_values(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        plsql_max_rows=200,
        plsql_max_hops=5,
        plsql_max_source_bytes=10_485_760,
        plsql_query_timeout_seconds=300.0,
    )
    assert settings.plsql_max_rows == 200
    assert settings.plsql_max_hops == 5
    assert settings.plsql_max_source_bytes == 10_485_760
    assert settings.plsql_query_timeout_seconds == 300.0


# --- Readiness matrix -----------------------------------------------------


async def test_readiness_matrix_disabled_synthetic(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path, plsql_adapter="disabled") as (_, client):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json()["components"]["analysis"]["status"] == "disabled"

    async with _app_client(tmp_path) as (_, client):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json()["components"]["analysis"]["status"] == "synthetic"


async def test_readiness_matrix_connected_and_unavailable(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path, analysis_override=_OkAnalysisClient()) as (
        _,
        client,
    ):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json()["components"]["analysis"]["status"] == "connected"

    async with _app_client(tmp_path, analysis_override=_BrokenAnalysisClient()) as (
        _,
        client,
    ):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json()["components"]["analysis"]["status"] == "unavailable"


# --- Limit query-parameter cap -------------------------------------------


async def test_limit_above_cap_is_rejected_on_every_route(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path) as (_, client):
        employees = await _object_id(client, "EMPLOYEES")
        payroll = await _object_id(client, "RUN_PAYROLL")
        requests = [
            ("objects", {}),
            ("callers", {"objectId": employees}),
            ("callees", {"objectId": employees}),
            ("table-access", {"objectId": employees}),
            ("unresolved", {}),
            ("impact", {"objectId": employees}),
            ("paths", {"from": payroll, "to": employees}),
        ]
        for path, params in requests:
            response = await client.get(
                f"/api/v1/plsql/{path}", params={**params, "limit": 201}
            )
            assert response.status_code == 422, path
            assert response.json()["code"] == "invalid_request", path


# --- Row / hop / byte cap sweep -------------------------------------------


async def test_row_cap_sweep_truncates_each_envelope(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path, plsql_max_rows=3) as (_, client):
        employees = await _object_id(client, "EMPLOYEES")
        payroll = await _object_id(client, "RUN_PAYROLL")

        search = await client.get("/api/v1/plsql/objects")
        assert len(search.json()["items"]) == 3
        assert search.json()["truncated"] is True
        assert search.json()["count"] == 14

        access = await client.get(
            "/api/v1/plsql/table-access", params={"objectId": employees}
        )
        assert len(access.json()["items"]) == 3
        assert access.json()["truncated"] is True
        assert access.json()["count"] == 6

        unresolved = await client.get("/api/v1/plsql/unresolved")
        assert len(unresolved.json()["items"]) == 2
        assert unresolved.json()["truncated"] is False

        paths = await client.get(
            "/api/v1/plsql/paths",
            params={"from": payroll, "to": employees},
        )
        assert len(paths.json()["items"]) == 3
        assert paths.json()["truncated"] is False
        assert paths.json()["count"] == 3

        impact = await client.get(
            "/api/v1/plsql/impact", params={"objectId": employees}
        )
        assert len(impact.json()["items"]) == 3
        assert impact.json()["truncated"] is True
        assert impact.json()["count"] == 7


async def test_caller_callee_row_caps(tmp_path: Path) -> None:
    async with _app_client(tmp_path) as (_, client):
        # CALCULATE_MORA calls three routines (one UNRESOLVED placeholder);
        # a per-request limit truncates deterministically.
        calculate_mora = await _object_id(client, "CALCULATE_MORA")
        callees = await client.get(
            "/api/v1/plsql/callees",
            params={"objectId": calculate_mora, "limit": 2},
        )
        assert callees.status_code == 200
        payload = callees.json()
        assert len(payload["items"]) == 2
        assert payload["truncated"] is True
        assert payload["count"] == 3
        assert payload["items"][0]["target"]["qualifiedName"] == ("HR.COUNT_EMPLOYEES")

        # CREATE_EMPLOYEE has exactly one caller, so no truncation and the
        # configured cap is not confused with an error.
        create_employee = await _object_id(client, "CREATE_EMPLOYEE")
        callers = await client.get(
            "/api/v1/plsql/callers", params={"objectId": create_employee}
        )
        assert callers.status_code == 200
        payload = callers.json()
        assert len(payload["items"]) == 1
        assert payload["truncated"] is False
        assert payload["count"] == 1
        assert payload["items"][0]["source"]["qualifiedName"] == "HR.ARCHIVE_EMPLOYEE"

    # The configured row cap also bounds these envelopes.
    async with _app_client(tmp_path, plsql_max_rows=2) as (_, client):
        calculate_mora = await _object_id(client, "CALCULATE_MORA")
        capped = await client.get(
            "/api/v1/plsql/callees", params={"objectId": calculate_mora}
        )
        assert capped.status_code == 200
        payload = capped.json()
        assert len(payload["items"]) == 2
        assert payload["truncated"] is True
        assert payload["count"] == 3


async def test_hop_cap_sweep_paths_and_impact(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path, plsql_max_hops=2) as (_, client):
        employees = await _object_id(client, "EMPLOYEES")
        payroll = await _object_id(client, "RUN_PAYROLL")

        paths = await client.get(
            "/api/v1/plsql/paths",
            params={"from": payroll, "to": employees},
        )
        assert paths.status_code == 200
        assert all(item["hopCount"] <= 2 for item in paths.json()["items"])

        impact = await client.get(
            "/api/v1/plsql/impact", params={"objectId": employees}
        )
        assert impact.status_code == 200
        assert all(item["distance"] <= 2 for item in impact.json()["items"])


async def test_source_byte_cap_sweep(
    tmp_path: Path,
) -> None:
    async with _app_client(
        tmp_path,
        plsql_source_root=str(FIXTURE_SOURCE_ROOT),
        plsql_max_source_bytes=1024,
    ) as (_, client):
        # employees.sql in the fixture corpus exceeds the 1024-byte cap.
        employees = await _object_id(client, "EMPLOYEES")
        capped = await client.get(
            "/api/v1/plsql/source", params={"objectId": employees}
        )
        assert capped.status_code == 503
        assert capped.json()["code"] == "analysis_limit_exceeded"

    async with _app_client(tmp_path, plsql_source_root=str(FIXTURE_SOURCE_ROOT)) as (
        _,
        client,
    ):
        employees = await _object_id(client, "EMPLOYEES")
        served = await client.get(
            "/api/v1/plsql/source", params={"objectId": employees}
        )
        assert served.status_code == 200
        assert served.json()["lines"]


async def test_file_route_byte_cap_sweep(tmp_path: Path) -> None:
    async with _app_client(tmp_path, plsql_source_root=str(FIXTURE_SOURCE_ROOT)) as (
        _,
        client,
    ):
        employees = await _object_id(client, "EMPLOYEES")
        source = await client.get(
            "/api/v1/plsql/source", params={"objectId": employees}
        )
        employees_file = source.json()["file"]["fileId"]
        large_file = await client.get(
            "/api/v1/plsql/files",
            params={"fileId": employees_file, "startLine": 1, "endLine": 2},
        )
        assert large_file.status_code == 200
        assert large_file.json()["lines"]
        assert large_file.json()["highlight"] == {"startLine": 1, "endLine": 2}

    # The employees.sql fixture exceeds 1024 bytes, so the /files route must
    # reject it with the same normalized problem as /source. The file id is
    # taken from search results, because /source itself is already capped.
    async with _app_client(
        tmp_path,
        plsql_source_root=str(FIXTURE_SOURCE_ROOT),
        plsql_max_source_bytes=1024,
    ) as (_, client):
        search = await client.get("/api/v1/plsql/objects", params={"q": "EMPLOYEES"})
        employees_file = next(
            item["declaration"]["sourceFileId"]
            for item in search.json()["items"]
            if item["name"] == "EMPLOYEES"
        )
        capped = await client.get(
            "/api/v1/plsql/files", params={"fileId": employees_file}
        )
        assert capped.status_code == 503
        assert capped.json()["code"] == "analysis_limit_exceeded"
