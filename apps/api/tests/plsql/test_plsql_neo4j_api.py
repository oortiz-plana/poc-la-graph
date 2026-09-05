"""Neo4j analysis adapter integration tests against a real graph.

These tests require a live ``plsqlgraph``-synchronized Neo4j (the same
server the product would point ``PLSQL_ADAPTER=neo4j`` at) and are skipped
unless the environment provides one. They are the alignment harness for the
catalog's schema assumptions (see the note in
``app/integrations/plsql/catalog.py``): run them against a real instance and
treat any failure as a schema-alignment item to fix in the catalog module.

Environment:

- ``PLSQL_NEO4J_TEST_URI`` (required; e.g. ``bolt://127.0.0.1:7687``)
- ``PLSQL_NEO4J_TEST_USER`` / ``PLSQL_NEO4J_TEST_PASSWORD`` (optional)
- ``PLSQL_NEO4J_TEST_PROJECT`` (optional; default ``sample``)
- ``PLSQL_SOURCE_ROOT`` (optional; required only for source-viewer checks)

Run with the API's local environment:

    PLSQL_NEO4J_TEST_URI=bolt://127.0.0.1:7687 \\
    PLSQL_NEO4J_TEST_USER=neo4j PLSQL_NEO4J_TEST_PASSWORD=... \\
    pytest tests/plsql/test_plsql_neo4j_api.py
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

from app.api.dependencies import build_analysis_client
from app.config.settings import Settings
from app.integrations.plsql import Neo4jPlsqlAnalysisClient
from app.main import create_app

TEST_URI = os.environ.get("PLSQL_NEO4J_TEST_URI", "").strip()

pytestmark = pytest.mark.skipif(
    not TEST_URI,
    reason=(
        "set PLSQL_NEO4J_TEST_URI (plus PLSQL_NEO4J_TEST_USER, "
        "PLSQL_NEO4J_TEST_PASSWORD, PLSQL_NEO4J_TEST_PROJECT, and "
        "PLSQL_SOURCE_ROOT when checking source) to run against a real "
        "plsqlgraph Neo4j instance"
    ),
)

TEST_USER = os.environ.get("PLSQL_NEO4J_TEST_USER") or None
TEST_PASSWORD = os.environ.get("PLSQL_NEO4J_TEST_PASSWORD") or None
TEST_PROJECT = os.environ.get("PLSQL_NEO4J_TEST_PROJECT") or "sample"
TEST_SOURCE_ROOT = os.environ.get("PLSQL_SOURCE_ROOT") or None


def _client() -> Neo4jPlsqlAnalysisClient:
    client = build_analysis_client(
        Settings(
            llm_adapter="mock",
            graphify_adapter="mock",
            graphify_runtime_mode="synthetic",
            plsql_adapter="neo4j",
            plsql_project_id=TEST_PROJECT,
            plsql_neo4j_uri=TEST_URI,
            plsql_neo4j_user=TEST_USER,
            plsql_neo4j_password=TEST_PASSWORD,
            plsql_source_root=TEST_SOURCE_ROOT,
        )
    )
    assert isinstance(client, Neo4jPlsqlAnalysisClient)
    return client


@asynccontextmanager
async def _app_client(
    tmp_path: Path,
) -> AsyncIterator[httpx.AsyncClient]:
    settings = Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter="neo4j",
        plsql_project_id=TEST_PROJECT,
        plsql_neo4j_uri=TEST_URI,
        plsql_neo4j_user=TEST_USER,
        plsql_neo4j_password=TEST_PASSWORD,
        plsql_source_root=TEST_SOURCE_ROOT,
        conversation_database_url=(
            f"sqlite+aiosqlite:///{tmp_path / 'plsql-neo4j-real.db'}"
        ),
        project_storage_root=str(tmp_path / "projects-neo4j-real"),
        knowledge_ingest_on_startup=False,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client


async def test_connectivity_probe() -> None:
    client = _client()
    try:
        assert await client.check_connectivity() == "connected"
    finally:
        client.close()


async def test_readiness_reports_connected_and_router_answers(
    tmp_path: Path,
) -> None:
    async with _app_client(tmp_path) as client:
        ready = await client.get("/ready")
        assert ready.status_code == 200
        assert ready.json()["components"]["analysis"]["status"] == "connected"

        # Envelopes stay well-formed whatever the graph contains.
        search = await client.get("/api/v1/plsql/objects", params={"limit": 10})
        assert search.status_code == 200
        payload = search.json()
        assert set(payload) == {"items", "truncated", "count"}

        unresolved = await client.get("/api/v1/plsql/unresolved")
        assert unresolved.status_code == 200
        assert set(unresolved.json()) == {"items", "truncated", "count"}


async def test_search_is_deterministic_over_repeated_calls() -> None:
    client = _client()
    try:
        first = await client.search_objects(query="", kinds=None, limit=25)
        second = await client.search_objects(query="", kinds=None, limit=25)
        assert [item.id for item in first.items] == [item.id for item in second.items]
        assert first.total == second.total
        assert first.truncated == second.truncated
    finally:
        client.close()
