from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import update

from app.agent.models import Answer, GraphEvidence
from app.store import (
    ConversationNotFound,
    ConversationRequestConflict,
    SQLAlchemyConversationStore,
    create_conversation_store,
)
from app.store.sqlalchemy import ConversationRow


def _answer(conversation_id: str, text: str = "Respuesta") -> Answer:
    return Answer(
        request_id="request-1",
        conversation_id=conversation_id,
        answer=text,
        confidence="high",
        graph_evidence=GraphEvidence(),
    )


async def test_sqlite_round_trip_survives_store_restart(tmp_path: Path) -> None:
    database_url = f"sqlite+aiosqlite:///{tmp_path}/conversations.db"
    first = create_conversation_store(database_url)
    await first.initialize()
    conversation = await first.create("legal-project")
    await first.add_user_message(conversation.id, "¿Qué establece la Ley 100?")
    await first.add_assistant_message(
        conversation.id,
        "La evidencia indica...",
        "completed",
        _answer(conversation.id),
    )
    await first.close()

    second = create_conversation_store(database_url)
    await second.initialize()
    restored = await second.get(conversation.id)
    await second.close()

    assert restored.project_id == "legal-project"
    assert [message.role for message in restored.messages] == ["user", "assistant"]
    assert restored.messages[0].content == "¿Qué establece la Ley 100?"
    assert restored.messages[1].result is not None
    assert restored.messages[1].result.confidence == "high"


async def test_request_lease_rejects_conflict_and_can_be_released(
    tmp_path: Path,
) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/lease.db", lease_seconds=60
    )
    await store.initialize()
    conversation = await store.create("project")

    await store.acquire_request(conversation.id, "request-a")
    await store.acquire_request(conversation.id, "request-a")
    with pytest.raises(ConversationRequestConflict) as conflict:
        await store.acquire_request(conversation.id, "request-b")
    assert conflict.value.active_request_id == "request-a"

    await store.release_request(conversation.id, "request-a")
    await store.acquire_request(conversation.id, "request-b")
    await store.close()


async def test_expired_request_lease_can_be_reclaimed(tmp_path: Path) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/expired-lease.db", lease_seconds=1
    )
    await store.initialize()
    conversation = await store.create("project")
    await store.acquire_request(conversation.id, "request-a")
    async with store._sessions.begin() as session:
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id == conversation.id)
            .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )

    await store.acquire_request(conversation.id, "request-b")
    await store.close()


async def test_prunes_oldest_complete_exchanges_and_bounds_history(
    tmp_path: Path,
) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/history.db", max_turns=2
    )
    await store.initialize()
    conversation = await store.create("project")
    for index in range(3):
        await store.add_user_message(conversation.id, f"question-{index}")
        await store.add_assistant_message(
            conversation.id, f"answer-{index}", "completed"
        )
    await store.add_user_message(conversation.id, "current-unpaired-question")

    restored = await store.get(conversation.id)
    history = await store.get_history(conversation.id, max_turns=6, max_chars=18)
    await store.close()

    assert [message.content for message in restored.messages] == [
        "question-1",
        "answer-1",
        "question-2",
        "answer-2",
        "current-unpaired-question",
    ]
    assert [message.content for message in history] == ["question-2", "answer-2"]


async def test_cleanup_deletes_expired_conversations(tmp_path: Path) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/cleanup.db", retention_days=30
    )
    await store.initialize()
    conversation = await store.create("project")
    async with store._sessions.begin() as session:
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id == conversation.id)
            .values(updated_at=datetime.now(UTC) - timedelta(days=31))
        )

    assert await store.cleanup() == 1
    with pytest.raises(ConversationNotFound):
        await store.get(conversation.id)
    await store.close()


async def test_delete_unknown_conversation_raises(tmp_path: Path) -> None:
    store = SQLAlchemyConversationStore(f"sqlite+aiosqlite:///{tmp_path}/missing.db")
    await store.initialize()
    with pytest.raises(ConversationNotFound):
        await store.delete("missing")
    with pytest.raises(ConversationNotFound):
        await store.acquire_request("missing", "request")
    await store.close()
