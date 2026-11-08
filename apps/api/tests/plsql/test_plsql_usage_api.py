"""PL/SQL console usage analytics: capture, admin summary, and retention."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
import yaml
from fastapi import FastAPI

from app.auth import AuthPrincipal
from app.auth.dependencies import current_principal
from app.config.settings import Settings
from app.main import create_app
from app.usage import UsageEvent

ALICE = AuthPrincipal("subject-alice", "alice", frozenset({"viewer"}))
ADMIN = AuthPrincipal("subject-admin", "admin", frozenset({"viewer", "admin"}))


def _settings(tmp_path: Path, *, enabled: bool = True) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        plsql_adapter="synthetic",
        plsql_project_id="sample",
        plsql_usage_enabled=enabled,
        conversation_database_url=f"sqlite+aiosqlite:///{tmp_path / 'usage.db'}",
        project_storage_root=str(tmp_path / "projects-usage"),
        knowledge_ingest_on_startup=False,
    )


class Session:
    """A test client whose authenticated principal can be switched."""

    def __init__(self, app: FastAPI, client: httpx.AsyncClient) -> None:
        self.app = app
        self.client = client
        self.principal = ALICE
        app.dependency_overrides[current_principal] = lambda: self.principal

    def act_as(self, principal: AuthPrincipal) -> Session:
        self.principal = principal
        return self


@pytest.fixture
async def session(tmp_path: Path) -> AsyncIterator[Session]:
    app = create_app(_settings(tmp_path))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield Session(app, client)


async def _object_id(client: httpx.AsyncClient, name: str) -> str:
    response = await client.get("/api/v1/plsql/objects", params={"q": name})
    return str(
        next(item for item in response.json()["items"] if item["name"] == name)["id"]
    )


async def _usage(session: Session, **params: Any) -> dict[str, Any]:
    session.act_as(ADMIN)
    response = await session.client.get("/api/v1/plsql/usage", params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def test_records_each_console_operation_with_the_username(
    session: Session,
) -> None:
    object_id = await _object_id(session.client, "CALCULATE_BONUS")
    await session.client.get("/api/v1/plsql/overview", params={"objectId": object_id})
    await session.client.get("/api/v1/plsql/callers", params={"objectId": object_id})

    payload = await _usage(session)

    assert payload["requests"] == 3
    assert payload["distinctUsers"] == 1
    assert {row["operation"] for row in payload["operations"]} == {
        "search_objects",
        "get_overview",
        "list_callers",
    }
    assert payload["users"][0]["username"] == "alice"
    assert payload["users"][0]["requests"] == 3
    assert payload["topObjects"][0]["objectId"] == object_id
    assert payload["topObjects"][0]["object"]["name"] == "CALCULATE_BONUS"
    assert payload["topObjects"][0]["requests"] == 2
    assert len(payload["daily"]) == 7
    assert payload["daily"][-1]["requests"] == 3


async def test_reading_the_summary_is_not_recorded(session: Session) -> None:
    await _usage(session)
    payload = await _usage(session)
    assert payload["requests"] == 0


async def test_search_text_is_never_stored(session: Session) -> None:
    await session.client.get("/api/v1/plsql/objects", params={"q": "secret-term"})
    database = Path(
        session.app.state.settings.conversation_database_url.split("///", 1)[1]
    )
    engine = sa.create_engine(f"sqlite:///{database}")
    with engine.connect() as connection:
        rows = connection.execute(sa.text("SELECT * FROM plsql_usage_events")).all()
    engine.dispose()
    assert len(rows) == 1
    assert "secret-term" not in repr(rows)
    assert rows[0]._mapping["username"] == "alice"
    assert rows[0]._mapping["subject"] == "subject-alice"


async def test_failed_requests_count_as_errors(session: Session) -> None:
    response = await session.client.get(
        "/api/v1/plsql/object", params={"objectId": "plsql://missing"}
    )
    assert response.status_code == 404
    payload = await _usage(session)
    assert payload["errors"] == 1
    assert payload["operations"][0]["errors"] == 1


async def test_distinct_users_follow_subject_when_username_changes(
    session: Session,
) -> None:
    await session.client.get("/api/v1/plsql/objects", params={"q": "PKG"})
    session.act_as(
        AuthPrincipal("subject-alice", "alice.renamed", frozenset({"viewer"}))
    )
    await session.client.get("/api/v1/plsql/objects", params={"q": "PKG"})

    payload = await _usage(session)

    assert payload["distinctUsers"] == 1
    assert [user["username"] for user in payload["users"]] == ["alice.renamed"]


async def test_viewer_cannot_read_usage(session: Session) -> None:
    response = await session.client.get("/api/v1/plsql/usage")
    assert response.status_code == 403


async def test_unsupported_window_is_rejected(session: Session) -> None:
    session.act_as(ADMIN)
    for days in ("3", "week"):
        response = await session.client.get(
            "/api/v1/plsql/usage", params={"days": days}
        )
        assert response.status_code == 422


async def test_summary_window_excludes_older_events(session: Session) -> None:
    now = datetime.now(UTC)
    old = UsageEvent(
        occurred_at=now - timedelta(days=20),
        tenant_id=ADMIN.tenant_id,
        subject="subject-old",
        username="old",
        operation="search_objects",
        outcome="ok",
        status_code=200,
        duration_ms=5.0,
    )
    await session.app.state.usage.record(old)

    assert (await _usage(session, days=7))["requests"] == 0
    thirty = await _usage(session, days=30)
    assert thirty["requests"] == 1
    assert thirty["daysInWindow"] == 30
    assert len(thirty["daily"]) == 30


async def test_purge_removes_events_past_retention(session: Session) -> None:
    now = datetime.now(UTC)
    recorder = session.app.state.usage
    for age in (100, 1):
        await recorder.record(
            UsageEvent(
                occurred_at=now - timedelta(days=age),
                tenant_id=ADMIN.tenant_id,
                subject="s",
                username="u",
                operation="search_objects",
                outcome="ok",
                status_code=200,
                duration_ms=1.0,
            )
        )
    assert await recorder.purge_before(now - timedelta(days=90)) == 1
    assert (await _usage(session, days=90))["requests"] == 1


async def test_recorder_failure_does_not_fail_the_request(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(event: UsageEvent) -> None:
        raise RuntimeError("database is down")

    monkeypatch.setattr(session.app.state.usage, "record", broken)
    response = await session.client.get("/api/v1/plsql/objects", params={"q": "PKG"})
    assert response.status_code == 200


async def test_usage_is_off_by_default(tmp_path: Path) -> None:
    app = create_app(_settings(tmp_path, enabled=False))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            await client.get("/api/v1/plsql/objects", params={"q": "PKG"})
            response = await client.get("/api/v1/plsql/usage")
            recorded = await app.state.usage.summarize(
                "default",
                since=datetime.now(UTC) - timedelta(days=1),
                until=datetime.now(UTC),
            )
    assert response.status_code == 503
    assert recorded.requests == 0


def test_frozen_contract_matches_the_usage_endpoint(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[4]
    frozen = yaml.safe_load((root / "contracts/openapi/openapi.yaml").read_text())
    live = create_app(_settings(tmp_path)).openapi()
    assert (
        frozen["paths"]["/api/v1/plsql/usage"] == live["paths"]["/api/v1/plsql/usage"]
    )
    schema = json.loads(
        (root / "contracts/schemas/plsql-usage.schema.json").read_text()
    )
    summary = live["components"]["schemas"]["PlsqlUsageSummary"]
    assert set(schema["required"]) == set(summary["required"])
    assert set(schema["properties"]) == set(summary["properties"])
    for name, definition in (
        ("operation", "PlsqlUsageOperation"),
        ("day", "PlsqlUsageDay"),
        ("user", "PlsqlUsageUser"),
        ("object", "PlsqlUsageObject"),
    ):
        backend = live["components"]["schemas"][definition]
        assert set(schema["$defs"][name]["properties"]) == set(backend["properties"])
        assert frozen["components"]["schemas"][definition] == backend
