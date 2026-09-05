"""Neo4j analysis adapter hermetic tests (no Bolt server required).

Covers the adapter's identifier round-trips, catalog row mapping, adapter
composition, and the readiness wiring for ``PLSQL_ADAPTER=neo4j``. Real-graph
operations against a live ``plsqlgraph`` Neo4j are exercised by
``test_plsql_neo4j_api.py`` (skip-gated on ``PLSQL_NEO4J_TEST_URI``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError

from app.api.dependencies import build_analysis_client
from app.config.settings import Settings
from app.integrations.plsql import PlsqlConfigurationError
from app.integrations.plsql.neo4j_client import (
    Neo4jPlsqlAnalysisClient,
    _edge_parts,
    _kind_from_labels,
    _owner_of,
    _schema_of,
    edge_id,
    object_id,
    qualified_name_from_object_id,
)
from app.main import create_app


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter=overrides.pop("plsql_adapter", "synthetic"),
        plsql_project_id="sample",
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'plsql-neo4j.db'}",
        project_storage_root=str(tmp_path / "projects-neo4j"),
        knowledge_ingest_on_startup=False,
        **overrides,
    )


@asynccontextmanager
async def _app_client(
    tmp_path: Path, **overrides: object
) -> AsyncIterator[tuple[object, httpx.AsyncClient]]:
    settings = _settings(tmp_path, **overrides)
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield app, client


# --- identifier helpers -----------------------------------------------------


def test_object_id_round_trip() -> None:
    identifier = object_id("sample", "HR.PKG_EMPLOYEE.CALCULATE_BONUS")
    assert identifier.startswith("plsql://sample/o/")
    assert (
        qualified_name_from_object_id(identifier) == "HR.PKG_EMPLOYEE.CALCULATE_BONUS"
    )
    assert qualified_name_from_object_id("plsql://other/HR/EMPLOYEES") is None
    assert qualified_name_from_object_id("not-an-id") is None


def test_edge_id_round_trip() -> None:
    identifier = edge_id("sample", "CALLS", "HR.A", "HR.B")
    assert identifier.startswith("edge://sample/e/")
    assert _edge_parts(identifier) == ("CALLS", "HR.A", "HR.B")
    assert _edge_parts("edge://sample/HR/A/B") is None
    assert _edge_parts("not-an-id") is None


def test_qualified_name_helpers() -> None:
    assert _schema_of("HR.PKG_EMPLOYEE.CALCULATE_BONUS") == "HR"
    assert _owner_of("HR.PKG_EMPLOYEE.CALCULATE_BONUS") == "PKG_EMPLOYEE"
    assert _owner_of("HR.EMPLOYEES") is None
    assert _kind_from_labels(("DatabaseObject", "Table")) == "Table"
    assert _kind_from_labels(("DatabaseObject", "ExecutableUnit")) is None
    assert _kind_from_labels(("Procedure", "DatabaseObject")) == "Procedure"


# --- catalog row mapping ----------------------------------------------------


def _client() -> Neo4jPlsqlAnalysisClient:
    return Neo4jPlsqlAnalysisClient(
        project_id="sample",
        uri="bolt://127.0.0.1:9",  # never connected in these tests
    )


def test_dependency_from_row_maps_documented_edge_properties() -> None:
    client = _client()
    try:
        row = {
            "relationship": "CALLS",
            "resolution": "EXACT",
            "sourceQualifiedName": "HR.PKG_PAYROLL.RUN_PAYROLL",
            "sourceName": "RUN_PAYROLL",
            "sourceLabels": ["DatabaseObject", "Procedure"],
            "targetQualifiedName": "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
            "targetName": "CALCULATE_BONUS",
            "targetLabels": ["DatabaseObject", "Function"],
            "sourceFileId": "file://sample/hr/pkg_payroll.pkb",
            "startLine": 34,
            "startColumn": 1,
            "startOffset": 100,
            "endOffset": 130,
        }
        record = client._dependency_from_row(row, file_paths={})
        assert record is not None
        assert record.relationship == "CALLS"
        assert record.resolution == "EXACT"
        assert record.source_qualified_name == "HR.PKG_PAYROLL.RUN_PAYROLL"
        assert record.source_kind == "Procedure"
        assert record.target_kind == "Function"
        assert record.evidence is not None
        assert record.evidence.source_file_id == "file://sample/hr/pkg_payroll.pkb"
        assert record.evidence.path == "hr/pkg_payroll.pkb"
        assert record.evidence.start_line == 34

        # Unknown rows are skipped rather than fabricated.
        bad = dict(row, relationship="INDEXES")
        assert client._dependency_from_row(bad, file_paths={}) is None
        no_kind = dict(row, targetLabels=["DatabaseObject"])
        assert client._dependency_from_row(no_kind, file_paths={}) is None
        bad_resolution = dict(row, resolution="UNCERTAIN")
        assert client._dependency_from_row(bad_resolution, file_paths={}) is None
    finally:
        client.close()


def test_dependency_from_row_uses_file_map_when_file_id_not_embedded() -> None:
    client = _client()
    try:
        row = {
            "relationship": "READS",
            "resolution": "EXACT",
            "sourceQualifiedName": "HR.COUNT_EMPLOYEES",
            "sourceName": "COUNT_EMPLOYEES",
            "sourceLabels": ["DatabaseObject", "Function"],
            "targetQualifiedName": "HR.EMPLOYEES",
            "targetName": "EMPLOYEES",
            "targetLabels": ["DatabaseObject", "Table"],
            "sourceFileId": "file-12",
            "startLine": 6,
            "startColumn": 1,
            "startOffset": None,
            "endOffset": None,
        }
        record = client._dependency_from_row(
            row, file_paths={"file-12": "hr/count_employees.sql"}
        )
        assert record is not None
        assert record.evidence is not None
        assert record.evidence.path == "hr/count_employees.sql"
        assert record.evidence.start_offset is None

        unknown = client._dependency_from_row(row, file_paths={})
        assert unknown is not None
        assert unknown.evidence is None
    finally:
        client.close()


# --- composition and readiness ---------------------------------------------


def test_neo4j_client_rejects_empty_uri() -> None:
    with pytest.raises(PlsqlConfigurationError):
        Neo4jPlsqlAnalysisClient(project_id="sample", uri="")


def test_build_analysis_client_requires_uri_for_neo4j(tmp_path: Path) -> None:
    settings = _settings(tmp_path, plsql_adapter="neo4j", plsql_neo4j_uri=None)
    assert build_analysis_client(settings) is None


def test_build_analysis_client_composes_neo4j_with_uri(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path,
        plsql_adapter="neo4j",
        plsql_neo4j_uri="bolt://127.0.0.1:9",
        plsql_neo4j_user="user",
        plsql_neo4j_password="secret",
        plsql_source_root="/tmp/unused-source-root",
    )
    client = build_analysis_client(settings)
    assert client is not None
    assert isinstance(client, Neo4jPlsqlAnalysisClient)
    client.close()  # type: ignore[attr-defined]


async def test_readiness_reports_unavailable_when_neo4j_not_composed(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path, plsql_adapter="neo4j", plsql_neo4j_uri=None) as (
        _,
        client,
    ):
        response = await client.get("/ready")
        assert response.status_code == 200
        assert response.json()["components"]["analysis"]["status"] == "unavailable"


def test_settings_reject_bad_adapter_value(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        _settings(tmp_path, plsql_adapter="cassandra")
