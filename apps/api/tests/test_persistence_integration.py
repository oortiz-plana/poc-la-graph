from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import update
from sqlalchemy.ext.asyncio import create_async_engine
from test_api_multiturn import RecordingWorkflow

from app.api.dependencies import get_workflow
from app.config.settings import Settings
from app.main import create_app
from app.store.sqlalchemy import ConversationRow


def _settings(database: Path) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        graphify_runtime_mode="synthetic",
        graphify_project_id="sample-project",
        conversation_database_url=f"sqlite+aiosqlite:///{database}",
        conversation_retention_days=1,
        conversation_cleanup_interval_seconds=3600,
    )


async def test_conversation_and_history_survive_application_restart(
    tmp_path: Path,
) -> None:
    database = tmp_path / "durable.db"
    settings = _settings(database)
    first_workflow = RecordingWorkflow()
    first_app = create_app(settings)
    first_app.dependency_overrides[get_workflow] = lambda: first_workflow

    async with first_app.router.lifespan_context(first_app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first_app),
            base_url="http://test",
        ) as client:
            conversation = (await client.post("/api/v1/conversations")).json()
            endpoint = f"/api/v1/conversations/{conversation['id']}/messages"
            completed = await client.post(
                endpoint, json={"message": "Persist this exchange"}
            )
            assert completed.status_code == 200

    second_workflow = RecordingWorkflow()
    second_app = create_app(settings)
    second_app.dependency_overrides[get_workflow] = lambda: second_workflow
    async with second_app.router.lifespan_context(second_app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=second_app),
            base_url="http://test",
        ) as client:
            restored = await client.get(f"/api/v1/conversations/{conversation['id']}")
            follow_up = await client.post(
                endpoint, json={"message": "Use the prior exchange"}
            )

    assert restored.status_code == 200
    assert [
        (message["role"], message["content"]) for message in restored.json()["messages"]
    ] == [
        ("user", "Persist this exchange"),
        ("assistant", "Answer to: Persist this exchange"),
    ]
    assert follow_up.status_code == 200
    assert [(turn.role, turn.content) for turn in second_workflow.histories[0]] == [
        ("user", "Persist this exchange"),
        ("assistant", "Answer to: Persist this exchange"),
    ]


async def test_expired_conversation_is_removed_and_client_can_recover(
    tmp_path: Path,
) -> None:
    database = tmp_path / "expiry.db"
    settings = _settings(database)
    first_app = create_app(settings)

    async with first_app.router.lifespan_context(first_app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=first_app),
            base_url="http://test",
        ) as client:
            expired = (await client.post("/api/v1/conversations")).json()

    engine = create_async_engine(settings.conversation_database_url)
    async with engine.begin() as connection:
        await connection.execute(
            update(ConversationRow)
            .where(ConversationRow.id == expired["id"])
            .values(updated_at=datetime.now(UTC) - timedelta(days=2))
        )
    await engine.dispose()

    restarted_app = create_app(settings)
    async with restarted_app.router.lifespan_context(restarted_app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=restarted_app),
            base_url="http://test",
        ) as client:
            missing = await client.get(f"/api/v1/conversations/{expired['id']}")
            recovered = await client.post("/api/v1/conversations")

    assert missing.status_code == 404
    assert missing.json()["code"] == "conversation_not_found"
    assert recovered.status_code == 201
    assert recovered.json()["id"] != expired["id"]
