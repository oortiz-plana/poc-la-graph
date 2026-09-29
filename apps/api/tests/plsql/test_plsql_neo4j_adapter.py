"""Neo4j analysis adapter hermetic tests (no Bolt server required).

Covers the adapter's identifier round-trips, catalog row mapping, adapter
composition, the readiness wiring for ``PLSQL_ADAPTER=neo4j``, and the
per-endpoint query design (targeted selects with count twins plus bounded
frontier traversal — see docs/plsql-analysis/max-edge-rows-proposal.md).
Real-graph operations against a live ``plsqlgraph`` Neo4j are exercised by
``test_plsql_neo4j_api.py`` (skip-gated on ``PLSQL_NEO4J_TEST_URI``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from pydantic import ValidationError

from app.api.dependencies import build_analysis_client
from app.config.settings import Settings
from app.integrations.plsql import PlsqlConfigurationError
from app.integrations.plsql import neo4j_client as neo4j_client_module
from app.integrations.plsql.catalog import (
    COUNT_EDGE_CALLERS,
    COUNT_EDGE_TABLE_ACCESS,
    COUNT_EDGE_UNRESOLVED,
    EDGE_BY_TRIPLE,
    EDGE_CALLERS,
    EDGE_INCOMING,
    EDGE_MEMBER_ENDPOINTS,
    EDGE_OUTGOING,
    EDGE_TABLE_ACCESS,
    EDGE_UNRESOLVED,
    OBJECT_DECLARATION,
    OBJECTS_BY_QUALIFIED_NAMES,
    SOURCE_FILES,
)
from app.integrations.plsql.errors import PlsqlLimitExceeded
from app.integrations.plsql.models import (
    PlsqlFileRecord,
    PlsqlObjectRecord,
    PlsqlSourceHighlight,
    PlsqlSourceRecord,
)
from app.integrations.plsql.neo4j_client import (
    Neo4jPlsqlAnalysisClient,
    _edge_parts,
    _kind_from_labels,
    _owner_of,
    _schema_of,
    _via_table_reference,
    edge_id,
    object_id,
    qualified_name_from_object_id,
)
from app.main import create_app
from app.models.plsql import ObjectKind


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
    assert _kind_from_labels(("DatabaseObject", "Synonym", "Type")) == "Type"


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


def test_dependency_from_row_maps_trigger_invocation_edge() -> None:
    client = _client()
    try:
        row = {
            "relationship": "TRIGGERS",
            "resolution": "INFERRED",
            "sourceQualifiedName": "HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
            "sourceName": "CREATE_EMPLOYEE",
            "sourceLabels": ["DatabaseObject", "Procedure"],
            "targetQualifiedName": "HR.NOTIFY_HR_AUDIT",
            "targetName": "NOTIFY_HR_AUDIT",
            "targetLabels": ["DatabaseObject", "Procedure"],
            "sourceFileId": "file://sample/hr/trg_employees_audit.sql",
            "startLine": 4,
            "startColumn": 1,
            "startOffset": None,
            "endOffset": None,
            "derived": True,
            "events": "INSERT",
            "evidenceKind": "TriggerInvocation",
            "viaTable": "plsql://sample/HR/TABLE/EMPLOYEES",
        }
        record = client._dependency_from_row(row, file_paths={})
        assert record is not None
        assert record.relationship == "TRIGGERS"
        assert record.derived is True
        assert record.events == "INSERT"
        assert record.evidence_kind == "TriggerInvocation"
        assert record.via_table_kind == "Table"
        assert record.via_table_name == "EMPLOYEES"
        assert record.via_table_qualified_name == "HR.EMPLOYEES"
        assert record.via_table_id == object_id("sample", "HR.EMPLOYEES")

        # Absent derived-edge columns degrade to None, never an error.
        plain = dict(row)
        for key in ("derived", "events", "evidenceKind", "viaTable"):
            plain[key] = None
        plain_record = client._dependency_from_row(plain, file_paths={})
        assert plain_record is not None
        assert plain_record.derived is None
        assert plain_record.events is None
        assert plain_record.evidence_kind is None
        assert plain_record.via_table_id is None
        assert plain_record.via_table_kind is None
    finally:
        client.close()


def test_via_table_reference_parsing() -> None:
    parsed = _via_table_reference("plsql://sample/HR/TABLE/EMPLOYEES", "sample")
    assert parsed is not None
    object_id_, kind, name, qualified_name = parsed
    assert object_id_ == object_id("sample", "HR.EMPLOYEES")
    assert kind == "Table"
    assert name == "EMPLOYEES"
    assert qualified_name == "HR.EMPLOYEES"

    assert _via_table_reference(None, "sample") is None
    assert _via_table_reference("not-a-plsql-uri", "sample") is None
    assert _via_table_reference("plsql://sample/HR/TABLE", "sample") is None
    assert _via_table_reference("plsql://sample/HR/BOGUS_KIND/X", "sample") is None


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


async def test_file_map_resolves_a_source_file_id_written_as_a_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Trigger-body CALLS evidence in the real graph writes the
    project-relative path itself into ``sourceFileId`` instead of the
    ``SourceFile`` node's id; both edge-evidence resolution and the
    on-demand source fetch must still resolve it, sharing one file map."""

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        assert query == SOURCE_FILES
        return [
            {
                "path": "Triggers/FM_GORPA_UPD.sql",
                "fileId": "file://sample/Triggers/FM_GORPA_UPD.sql",
            }
        ]

    client = Neo4jPlsqlAnalysisClient(project_id="sample", uri="bolt://127.0.0.1:9")
    monkeypatch.setattr(client, "_execute", execute)
    try:
        mapping = await client._file_map()
        row = _edge_row(sourceFileId="Triggers/FM_GORPA_UPD.sql")
        record = client._dependency_from_row(row, mapping)
        assert record is not None
        assert record.evidence is not None
        assert record.evidence.source_file_id == "Triggers/FM_GORPA_UPD.sql"
        assert record.evidence.path == "Triggers/FM_GORPA_UPD.sql"

        assert (
            await client._resolve_path("Triggers/FM_GORPA_UPD.sql")
            == "Triggers/FM_GORPA_UPD.sql"
        )
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


# --- per-endpoint queries and bounded traversal -----------------------------

ExecuteStub = Callable[..., Awaitable[list[dict[str, object]]]]


def _edge_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "relationship": "CALLS",
        "resolution": "EXACT",
        "sourceQualifiedName": "HR.PKG_PAYROLL.RUN_PAYROLL",
        "sourceName": "RUN_PAYROLL",
        "sourceLabels": ["DatabaseObject", "Procedure"],
        "targetQualifiedName": "HR.GET_SALARY",
        "targetName": "GET_SALARY",
        "targetLabels": ["DatabaseObject", "Function"],
        "sourceFileId": "file://sample/hr/pkg_payroll.pkb",
        "startLine": 34,
        "startColumn": 1,
        "startOffset": 100,
        "endOffset": 130,
    }
    row.update(overrides)
    return row


def _object_record(
    qualified_name: str, *, kind: ObjectKind = "Function", name: str | None = None
) -> PlsqlObjectRecord:
    return PlsqlObjectRecord(
        id=object_id("sample", qualified_name),
        kind=kind,
        name=name or qualified_name.rsplit(".", 1)[-1],
        schema_name=_schema_of(qualified_name),
        qualified_name=qualified_name,
        project_id="sample",
    )


def _stubbed_client(
    monkeypatch: pytest.MonkeyPatch,
    execute: ExecuteStub,
    *,
    max_traversal_edges: int = 20_000,
) -> Neo4jPlsqlAnalysisClient:
    client = Neo4jPlsqlAnalysisClient(
        project_id="sample",
        uri="bolt://127.0.0.1:9",  # never connected in these tests
        max_traversal_edges=max_traversal_edges,
    )

    async def fake_file_map() -> dict[str, str]:
        return {}

    monkeypatch.setattr(client, "_execute", execute)
    monkeypatch.setattr(client, "_file_map", fake_file_map)
    return client


async def test_callers_of_uses_targeted_select_and_count_twins(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = _object_record("HR.GET_SALARY")
    rows = [
        _edge_row(),
        _edge_row(
            sourceQualifiedName="HR.PKG_EMPLOYEE.CREATE_EMPLOYEE",
            sourceName="CREATE_EMPLOYEE",
            sourceLabels=["DatabaseObject", "Procedure"],
        ),
    ]
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_CALLERS:
            return rows
        if query == COUNT_EDGE_CALLERS:
            return [{"total": 2}]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[target.id] = target
    try:
        page = await client.callers_of(object_id=target.id, limit=1)
    finally:
        client.close()

    assert [item.id for item in page.items] == [
        edge_id("sample", "CALLS", "HR.PKG_PAYROLL.RUN_PAYROLL", "HR.GET_SALARY")
    ]
    assert page.truncated is True
    assert page.total == 2
    assert [query for query, _ in calls] == [EDGE_CALLERS, COUNT_EDGE_CALLERS]
    assert calls[0][1]["qualifiedName"] == "HR.GET_SALARY"
    assert calls[0][1]["limit"] == 2  # page size + 1 to detect truncation
    assert "limit" not in calls[1][1]


async def test_table_access_of_filters_by_member_prefix_and_table_kinds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    package = _object_record("HR.PKG_EMPLOYEE", kind="Package", name="PKG_EMPLOYEE")
    reads = _edge_row(
        relationship="READS",
        sourceQualifiedName="HR.PKG_EMPLOYEE.CALCULATE_BONUS",
        sourceName="CALCULATE_BONUS",
        sourceLabels=["DatabaseObject", "Function"],
        targetQualifiedName="HR.EMPLOYEES",
        targetName="EMPLOYEES",
        targetLabels=["DatabaseObject", "Table"],
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_TABLE_ACCESS:
            return [reads]
        if query == COUNT_EDGE_TABLE_ACCESS:
            return [{"total": 1}]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[package.id] = package
    try:
        page = await client.table_access_of(object_id=package.id, limit=10)
    finally:
        client.close()

    assert len(page.items) == 1
    assert page.items[0].relationship == "READS"
    assert page.total == 1
    assert calls[0][1]["memberPrefix"] == "HR.PKG_EMPLOYEE."
    assert set(calls[0][1]["relationships"]) == {
        "READS",
        "WRITES",
        "TRIGGER_ON",
        "VIEW_DEPENDS_ON",
        "FOREIGN_KEY",
    }
    assert calls[0][1]["tableKinds"] == ["Table", "View"]


async def test_unresolved_references_filters_by_resolution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ambiguous = _edge_row(resolution="AMBIGUOUS")
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_UNRESOLVED:
            return [ambiguous]
        if query == COUNT_EDGE_UNRESOLVED:
            return [{"total": 1}]
        return []

    client = _stubbed_client(monkeypatch, execute)
    try:
        page = await client.unresolved_references(limit=10)
    finally:
        client.close()

    assert page.total == 1
    assert page.items[0].resolution == "AMBIGUOUS"
    assert set(calls[0][1]["unresolvedResolutions"]) == {"AMBIGUOUS", "UNRESOLVED"}
    assert set(calls[0][1]["relationships"]) == {
        "CALLS",
        "READS",
        "WRITES",
        "TRIGGER_ON",
        "VIEW_DEPENDS_ON",
        "FOREIGN_KEY",
    }


async def test_find_paths_expands_bounded_frontiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _object_record("HR.A", kind="Package", name="A")
    target = _object_record("HR.C", kind="Function", name="C")
    ab = _edge_row(
        sourceQualifiedName="HR.A",
        sourceName="A",
        sourceLabels=["DatabaseObject", "Package"],
        targetQualifiedName="HR.B",
        targetName="B",
        targetLabels=["DatabaseObject", "Package"],
    )
    bc = _edge_row(
        sourceQualifiedName="HR.B",
        sourceName="B",
        sourceLabels=["DatabaseObject", "Package"],
        targetQualifiedName="HR.C",
        targetName="C",
        targetLabels=["DatabaseObject", "Function"],
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_OUTGOING and params["sources"] == ["HR.A"]:
            return [ab]
        if query == EDGE_OUTGOING and params["sources"] == ["HR.B"]:
            return [bc]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[source.id] = source
    client._object_cache[target.id] = target
    try:
        page = await client.find_paths(
            from_id=source.id, to_id=target.id, max_hops=2, limit=10
        )
        first_calls = list(calls)
        offset_page = await client.find_paths(
            from_id=source.id,
            to_id=target.id,
            max_hops=2,
            limit=10,
            offset=1,
        )
    finally:
        client.close()

    assert page.total == 1
    assert len(page.items) == 1
    path = page.items[0]
    assert path.hop_count == 2
    assert [step.id for step in path.steps] == [
        edge_id("sample", "CALLS", "HR.A", "HR.B"),
        edge_id("sample", "CALLS", "HR.B", "HR.C"),
    ]
    assert offset_page.total == 1
    assert offset_page.items == []
    assert offset_page.truncated is False
    assert [query for query, _ in first_calls] == [EDGE_OUTGOING, EDGE_OUTGOING]
    assert first_calls[0][1]["sources"] == ["HR.A"]
    assert first_calls[1][1]["sources"] == ["HR.B"]
    assert set(first_calls[0][1]["relationships"]) == {
        "CALLS",
        "READS",
        "WRITES",
        "VIEW_DEPENDS_ON",
        "FOREIGN_KEY",
        "TRIGGERS",
    }


async def test_find_paths_raises_when_traversal_budget_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _object_record("HR.A", kind="Package", name="A")
    target = _object_record("HR.B", kind="Package", name="B")
    rows = [
        _edge_row(
            sourceQualifiedName="HR.A",
            sourceName="A",
            sourceLabels=["DatabaseObject", "Package"],
            targetQualifiedName="HR.B",
            targetName="B",
            targetLabels=["DatabaseObject", "Package"],
        ),
        _edge_row(
            sourceQualifiedName="HR.A",
            sourceName="A",
            sourceLabels=["DatabaseObject", "Package"],
            targetQualifiedName="HR.B",
            targetName="B",
            targetLabels=["DatabaseObject", "Table"],
        ),
    ]

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        return rows if query == EDGE_OUTGOING else []

    client = _stubbed_client(monkeypatch, execute, max_traversal_edges=1)
    client._object_cache[source.id] = source
    client._object_cache[target.id] = target
    try:
        with pytest.raises(PlsqlLimitExceeded):
            await client.find_paths(
                from_id=source.id, to_id=target.id, max_hops=5, limit=10
            )
    finally:
        client.close()


async def test_relationship_evidence_queries_by_decoded_triple(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    params_seen: dict[str, object] = {}

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        if query == EDGE_BY_TRIPLE:
            params_seen.update(params)
            return [_edge_row()]
        return []

    client = _stubbed_client(monkeypatch, execute)
    try:
        edge = await client.relationship_evidence(
            edge_id("sample", "CALLS", "HR.PKG_PAYROLL.RUN_PAYROLL", "HR.GET_SALARY")
        )
    finally:
        client.close()

    assert edge is not None
    assert edge.relationship == "CALLS"
    assert params_seen["relationship"] == "CALLS"
    assert params_seen["sourceQualifiedName"] == "HR.PKG_PAYROLL.RUN_PAYROLL"
    assert params_seen["targetQualifiedName"] == "HR.GET_SALARY"


async def test_relationship_evidence_rejects_foreign_ids_without_querying(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append(query)
        return []

    client = _stubbed_client(monkeypatch, execute)
    try:
        assert await client.relationship_evidence("not-an-id") is None
        assert (
            await client.relationship_evidence(
                edge_id("sample", "INDEXES", "HR.A", "HR.B")
            )
            is None
        )
    finally:
        client.close()

    assert calls == []


async def test_impact_of_expands_reverse_frontiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    changed = _object_record("HR.EMPLOYEES", kind="Table", name="EMPLOYEES")
    dependent = _object_record("HR.COUNT_EMPLOYEES", kind="Function")
    reads = _edge_row(
        relationship="READS",
        sourceQualifiedName="HR.COUNT_EMPLOYEES",
        sourceName="COUNT_EMPLOYEES",
        sourceLabels=["DatabaseObject", "Function"],
        targetQualifiedName="HR.EMPLOYEES",
        targetName="EMPLOYEES",
        targetLabels=["DatabaseObject", "Table"],
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_INCOMING and params["targets"] == ["HR.EMPLOYEES"]:
            return [reads]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[changed.id] = changed
    client._object_cache[dependent.id] = dependent
    try:
        page = await client.impact_of(object_id=changed.id, max_hops=5, limit=10)
        first_calls = list(calls)
        offset_page = await client.impact_of(
            object_id=changed.id, max_hops=5, limit=10, offset=1
        )
    finally:
        client.close()

    assert page.total == 1
    assert len(page.items) == 1
    assert page.items[0].dependent.qualified_name == "HR.COUNT_EMPLOYEES"
    assert page.items[0].distance == 1
    assert len(page.items[0].paths) == 1
    assert offset_page.total == 1
    assert offset_page.items == []
    assert offset_page.truncated is False
    # The reverse search keeps expanding past the first dependent: round one
    # fetches edges into EMPLOYEES, round two edges into COUNT_EMPLOYEES.
    incoming_calls = [call for call in first_calls if call[0] == EDGE_INCOMING]
    assert [call[1]["targets"] for call in incoming_calls] == [
        ["HR.EMPLOYEES"],
        ["HR.COUNT_EMPLOYEES"],
    ]


async def test_impact_of_resolves_all_dependents_in_one_batched_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    changed = _object_record("HR.EMPLOYEES", kind="Table", name="EMPLOYEES")
    names = [f"HR.FN_{index:02d}" for index in range(30)]
    edges = [
        _edge_row(
            relationship="READS",
            sourceQualifiedName=name,
            sourceName=name.split(".")[1],
            sourceLabels=["DatabaseObject", "Function"],
            targetQualifiedName="HR.EMPLOYEES",
            targetName="EMPLOYEES",
            targetLabels=["DatabaseObject", "Table"],
        )
        for name in names
    ]
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_INCOMING and params["targets"] == ["HR.EMPLOYEES"]:
            return edges
        if query == OBJECTS_BY_QUALIFIED_NAMES:
            return [
                {
                    "n": {"qualifiedName": name, "name": name.split(".")[1]},
                    "nodeLabels": ["DatabaseObject", "Function"],
                }
                for name in params["qualifiedNames"]  # type: ignore[attr-defined]
            ]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[changed.id] = changed
    try:
        page = await client.impact_of(object_id=changed.id, max_hops=1, limit=50)
        await client.impact_of(object_id=changed.id, max_hops=1, limit=50)
    finally:
        client.close()

    assert page.total == 30
    assert [item.dependent.qualified_name for item in page.items] == names
    batched = [call for call in calls if call[0] == OBJECTS_BY_QUALIFIED_NAMES]
    # One lookup for all thirty dependents; the repeat request hits the cache.
    assert len(batched) == 1
    assert sorted(batched[0][1]["qualifiedNames"]) == names  # type: ignore[arg-type]


def _impact_fixture() -> tuple[
    PlsqlObjectRecord, list[PlsqlObjectRecord], list[dict[str, object]]
]:
    changed = _object_record("HR.EMPLOYEES", kind="Table", name="EMPLOYEES")
    dependents = [
        _object_record(f"HR.FN_{index:02d}", kind="Function") for index in range(5)
    ]
    edges = [
        _edge_row(
            relationship="READS",
            sourceQualifiedName=dependent.qualified_name,
            sourceName=dependent.name,
            sourceLabels=["DatabaseObject", "Function"],
            targetQualifiedName="HR.EMPLOYEES",
            targetName="EMPLOYEES",
            targetLabels=["DatabaseObject", "Table"],
        )
        for dependent in dependents
    ]
    return changed, dependents, edges


async def test_impact_pages_reuse_one_traversal_until_the_cache_expires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    changed, dependents, edges = _impact_fixture()
    incoming = 0

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        nonlocal incoming
        if query == EDGE_INCOMING:
            incoming += 1
            return edges if params["targets"] == ["HR.EMPLOYEES"] else []
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[changed.id] = changed
    for dependent in dependents:
        client._object_cache[dependent.id] = dependent
    clock = [1000.0]
    # Stub only this module's clock; patching `time.monotonic` itself would
    # also move the event loop's clock.
    monkeypatch.setattr(
        neo4j_client_module, "time", SimpleNamespace(monotonic=lambda: clock[0])
    )
    try:
        first = await client.impact_of(object_id=changed.id, max_hops=1, limit=2)
        traversal_queries = incoming
        second = await client.impact_of(
            object_id=changed.id, max_hops=1, limit=2, offset=2
        )
        third = await client.impact_of(
            object_id=changed.id, max_hops=1, limit=2, offset=4
        )
        # A different depth is a different traversal.
        await client.impact_of(object_id=changed.id, max_hops=2, limit=2)
        deeper_queries = incoming
        clock[0] += 61.0
        await client.impact_of(object_id=changed.id, max_hops=1, limit=2)
    finally:
        client.close()

    assert [len(page.items) for page in (first, second, third)] == [2, 2, 1]
    assert first.summary == second.summary == third.summary
    assert first.items[0].dependent.qualified_name == "HR.FN_00"
    assert second.items[0].dependent.qualified_name == "HR.FN_02"
    assert deeper_queries > traversal_queries
    assert incoming - deeper_queries == traversal_queries


async def test_impact_cache_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    changed, dependents, edges = _impact_fixture()
    incoming = 0

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        nonlocal incoming
        if query != EDGE_INCOMING:
            return []
        incoming += 1
        return edges if params["targets"] == ["HR.EMPLOYEES"] else []

    client = _stubbed_client(monkeypatch, execute)
    client._impact_cache_ttl = 0.0
    client._object_cache[changed.id] = changed
    for dependent in dependents:
        client._object_cache[dependent.id] = dependent
    try:
        await client.impact_of(object_id=changed.id, max_hops=1, limit=2)
        after_first = incoming
        await client.impact_of(object_id=changed.id, max_hops=1, limit=2, offset=2)
    finally:
        client.close()

    assert incoming == after_first * 2


async def test_impact_of_caps_routes_and_never_refetches_an_object_in_a_dense_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    layers, width = 4, 6
    changed = _object_record("HR.T", kind="Table", name="T")

    def name(layer: int, index: int) -> str:
        return "HR.T" if layer == 0 else f"HR.L{layer}_{index}"

    incoming: dict[str, list[dict[str, object]]] = {}
    for layer in range(1, layers + 1):
        for index in range(width):
            for target_index in range(width if layer > 1 else 1):
                target = name(layer - 1, target_index)
                incoming.setdefault(target, []).append(
                    _edge_row(
                        relationship="CALLS" if layer > 1 else "READS",
                        sourceQualifiedName=name(layer, index),
                        sourceName=name(layer, index).split(".")[1],
                        sourceLabels=["DatabaseObject", "Function"],
                        targetQualifiedName=target,
                        targetName=target.split(".")[1],
                        targetLabels=["DatabaseObject", "Function"],
                    )
                )
    fetched: list[str] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        if query == EDGE_INCOMING:
            targets = params["targets"]
            fetched.extend(targets)  # type: ignore[arg-type]
            return [row for target in targets for row in incoming.get(target, [])]  # type: ignore[attr-defined]
        if query == OBJECTS_BY_QUALIFIED_NAMES:
            return [
                {
                    "n": {"qualifiedName": qn, "name": qn.split(".")[1]},
                    "nodeLabels": ["DatabaseObject", "Function"],
                }
                for qn in params["qualifiedNames"]  # type: ignore[attr-defined]
            ]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[changed.id] = changed
    try:
        page = await client.impact_of(object_id=changed.id, max_hops=layers, limit=200)
    finally:
        client.close()

    # 24 dependents, one distance per layer, however many routes exist.
    assert page.total == layers * width
    assert {item.dependent.qualified_name: item.distance for item in page.items} == {
        name(layer, index): layer
        for layer in range(1, layers + 1)
        for index in range(width)
    }
    # Every object is expanded once (the last layer is never expanded), so the
    # graph is not re-read once per route.
    assert len(fetched) == len(set(fetched)) == 1 + (layers - 1) * width
    deepest = [item for item in page.items if item.distance == layers]
    for item in deepest:
        assert 1 <= len(item.paths) <= 5
        assert all(path.hop_count == layers for path in item.paths)
        assert len({path.id for path in item.paths}) == len(item.paths)


async def test_impact_of_anchors_package_members_from_prefix_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    changed = _object_record("HR.PKG_EMPLOYEE", kind="Package", name="PKG_EMPLOYEE")
    member = _object_record(
        "HR.PKG_EMPLOYEE.CALCULATE_BONUS", kind="Function", name="CALCULATE_BONUS"
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == EDGE_MEMBER_ENDPOINTS:
            return [
                {
                    "sourceQualifiedName": "HR.PKG_EMPLOYEE.CALCULATE_BONUS",
                    "targetQualifiedName": "HR.EMPLOYEES",
                }
            ]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache[changed.id] = changed
    client._object_cache[member.id] = member
    try:
        page = await client.impact_of(object_id=changed.id, max_hops=5, limit=10)
    finally:
        client.close()

    # Only package members whose owner matches anchor the search; the table
    # endpoint above is dropped, and no incoming edges are scripted.
    assert page.items == []
    assert page.total == 0
    member_calls = [call for call in calls if call[0] == EDGE_MEMBER_ENDPOINTS]
    assert len(member_calls) == 1
    assert member_calls[0][1]["memberPrefix"] == "HR.PKG_EMPLOYEE."


# --- object source (declaration via DECLARES edge) --------------------------


async def test_object_source_resolves_declaration_via_declares_edge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    obj = _object_record("VU_SFI.FM_GORPA_UPD", kind="Trigger", name="FM_GORPA_UPD")
    captured: dict[str, object] = {}

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        if query == OBJECT_DECLARATION:
            assert params["projectId"] == "sample"
            assert params["qualifiedName"] == "VU_SFI.FM_GORPA_UPD"
            return [
                {
                    "path": "Triggers/FM_GORPA_UPD.sql",
                    "fileId": "file://sample/Triggers/FM_GORPA_UPD.sql",
                    "startLine": 5,
                    "startColumn": 1,
                    "startOffset": 48,
                    "endOffset": 200,
                }
            ]
        return []

    async def load_source(
        *,
        file_id: str,
        path: str,
        start_line: int | None,
        end_line: int | None,
    ) -> PlsqlSourceRecord:
        captured.update(
            file_id=file_id, path=path, start_line=start_line, end_line=end_line
        )
        return PlsqlSourceRecord(
            file=PlsqlFileRecord(file_id=file_id, path=path),
            lines=["-- trigger body"],
            highlight=(
                PlsqlSourceHighlight(start_line=start_line, end_line=start_line)
                if start_line is not None
                else None
            ),
        )

    client = Neo4jPlsqlAnalysisClient(project_id="sample", uri="bolt://127.0.0.1:9")
    monkeypatch.setattr(client, "_execute", execute)
    monkeypatch.setattr(client, "_load_source", load_source)
    client._object_cache[obj.id] = obj
    try:
        record = await client.object_source(object_id=obj.id)
    finally:
        client.close()

    assert record is not None
    assert record.highlight == PlsqlSourceHighlight(start_line=5, end_line=5)
    assert captured["path"] == "Triggers/FM_GORPA_UPD.sql"
    assert captured["file_id"] == "file://sample/Triggers/FM_GORPA_UPD.sql"
    assert captured["start_line"] == 5
    assert captured["end_line"] is None


async def test_object_source_returns_none_without_declaration_edge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    obj = _object_record("VU_SFI.NO_SOURCE", kind="Trigger", name="NO_SOURCE")

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        assert query == OBJECT_DECLARATION
        return []

    client = Neo4jPlsqlAnalysisClient(project_id="sample", uri="bolt://127.0.0.1:9")
    monkeypatch.setattr(client, "_execute", execute)
    client._object_cache[obj.id] = obj
    try:
        assert await client.object_source(object_id=obj.id) is None
    finally:
        client.close()


@pytest.mark.parametrize("with_evidence", [True, False])
async def test_foreign_key_queries_mapping_and_traversal(
    monkeypatch: pytest.MonkeyPatch,
    with_evidence: bool,
) -> None:
    source = _object_record("HR.EMPLOYEES", kind="Table")
    target = _object_record("HR.DEPARTMENTS", kind="Table")
    row = _edge_row(
        relationship="FOREIGN_KEY",
        sourceQualifiedName=source.qualified_name,
        sourceName=source.name,
        sourceLabels=["DatabaseObject", "Table"],
        targetQualifiedName=target.qualified_name,
        targetName=target.name,
        targetLabels=["DatabaseObject", "Table"],
        sourceFileId="file://sample/hr/employees.sql" if with_evidence else None,
        startLine=5,
        startColumn=1,
        startOffset=None,
        endOffset=None,
    )
    calls: list[tuple[str, dict[str, object]]] = []

    async def execute(query: str, **params: object) -> list[dict[str, object]]:
        calls.append((query, params))
        if query == COUNT_EDGE_TABLE_ACCESS:
            return [{"total": 1}]
        if query == EDGE_TABLE_ACCESS:
            return [row]
        if "FOREIGN_KEY" not in params.get("relationships", []):
            return []
        if query == EDGE_OUTGOING and params["sources"] == [source.qualified_name]:
            return [row]
        if query == EDGE_INCOMING and params["targets"] == [target.qualified_name]:
            return [row]
        return []

    client = _stubbed_client(monkeypatch, execute)
    client._object_cache.update({source.id: source, target.id: target})
    try:
        for anchor in (source, target):
            page = await client.table_access_of(object_id=anchor.id, limit=10)
            edge = page.items[0]
            assert edge.relationship == "FOREIGN_KEY"
            assert (edge.source_id, edge.target_id) == (source.id, target.id)
            if with_evidence:
                assert edge.evidence is not None
                assert edge.evidence.path == "hr/employees.sql"
                assert edge.evidence.start_line == 5
            else:
                assert edge.evidence is None
        paths = await client.find_paths(
            from_id=source.id, to_id=target.id, max_hops=5, limit=10
        )
        assert paths.total == 1
        assert paths.items[0].steps[0].relationship == "FOREIGN_KEY"
        for direction, anchor, peer in (
            ("upstream", target, source),
            ("downstream", source, target),
        ):
            for relationships in (None, frozenset({"FOREIGN_KEY"})):
                impact = await client.impact_of(
                    object_id=anchor.id,
                    direction=direction,
                    relationships=relationships,
                    max_hops=5,
                    limit=10,
                )
                assert impact.total == 1
                assert impact.items[0].dependent.id == peer.id
                assert impact.summary.tables_modified == 0
        writes = await client.impact_of(
            object_id=target.id,
            relationships=frozenset({"WRITES"}),
            max_hops=5,
            limit=10,
        )
        assert writes.items == []
    finally:
        client.close()
    for query, params in calls:
        if query in (EDGE_TABLE_ACCESS, COUNT_EDGE_TABLE_ACCESS):
            assert "FOREIGN_KEY" in params["relationships"]


def test_qualified_name_lookup_prefers_the_real_object_over_its_synonym() -> None:
    from app.integrations.plsql.catalog import OBJECT_BY_QUALIFIED_NAME

    assert "ORDER BY CASE WHEN n:Synonym THEN 1 ELSE 0 END" in (
        OBJECT_BY_QUALIFIED_NAME
    )


async def test_connectivity_check_warns_once_when_the_index_is_missing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    queries: list[str] = []

    async def execute(query: str, **params: object) -> list[dict[str, Any]]:
        queries.append(query)
        return []

    client = _stubbed_client(monkeypatch, execute)

    with caplog.at_level("WARNING", logger="graphify_agent.api"):
        assert await client.check_connectivity() == "connected"
        assert await client.check_connectivity() == "connected"

    warnings = [r for r in caplog.records if r.message == "plsql_index_missing"]
    assert len(warnings) == 1
    assert sum("SHOW INDEXES" in query for query in queries) == 1


async def test_connectivity_check_is_quiet_when_the_index_is_online(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def execute(query: str, **params: object) -> list[dict[str, Any]]:
        return [{"state": "ONLINE"}] if "SHOW INDEXES" in query else []

    client = _stubbed_client(monkeypatch, execute)

    with caplog.at_level("WARNING", logger="graphify_agent.api"):
        await client.check_connectivity()

    assert not [r for r in caplog.records if r.message == "plsql_index_missing"]
