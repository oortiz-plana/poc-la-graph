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


async def test_cleanup_only_deletes_expired_archived_conversations(
    tmp_path: Path,
) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/cleanup.db", retention_days=30
    )
    await store.initialize()
    active = await store.create("project")
    archived = await store.create("project")
    await store.archive(archived.id)
    async with store._sessions.begin() as session:
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id.in_([active.id, archived.id]))
            .values(
                updated_at=datetime.now(UTC) - timedelta(days=31),
                archived_at=datetime.now(UTC) - timedelta(days=31),
            )
        )
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id == active.id)
            .values(archived_at=None)
        )

    assert await store.cleanup() == 1
    assert (await store.get(active.id)).id == active.id
    with pytest.raises(ConversationNotFound):
        await store.get(archived.id)
    await store.close()


async def test_private_lists_naming_archive_restore_and_stable_cursor(
    tmp_path: Path,
) -> None:
    store = SQLAlchemyConversationStore(
        f"sqlite+aiosqlite:///{tmp_path}/private-list.db"
    )
    await store.initialize()
    first = await store.create("project", created_by="alice")
    second = await store.create("project", created_by="alice")
    await store.create("project", created_by="bob")
    tied = datetime.now(UTC).replace(microsecond=0)
    async with store._sessions.begin() as session:
        await session.execute(
            update(ConversationRow)
            .where(ConversationRow.id.in_([first.id, second.id]))
            .values(updated_at=tied)
        )

    page_one = await store.list_conversations("project", "alice", limit=1)
    page_two = await store.list_conversations(
        "project", "alice", limit=1, cursor=page_one.next_cursor
    )
    assert [*page_one.items, *page_two.items]
    assert {page_one.items[0].id, page_two.items[0].id} == {first.id, second.id}

    question = "  What   does the first clause say?  More detail follows. "
    await store.add_user_message(first.id, question, "alice")
    named = await store.get(first.id, "alice")
    assert named.name == "What does the first clause say?"
    with pytest.raises(ConversationNotFound):
        await store.get(first.id, "bob")

    renamed = await store.rename(first.id, "Renamed", "alice")
    assert renamed.name == "Renamed"
    await store.archive(first.id, "alice")
    with pytest.raises(ConversationNotFound):
        await store.get(first.id, "alice")
    with pytest.raises(ConversationNotFound):
        await store.add_user_message(first.id, "Cannot continue", "alice")
    archived_page = await store.list_conversations("project", "alice", state="archived")
    assert [item.id for item in archived_page.items] == [first.id]
    restored = await store.restore(first.id, "alice")
    assert restored.archived_at is None
    await store.close()


async def test_delete_unknown_conversation_raises(tmp_path: Path) -> None:
    store = SQLAlchemyConversationStore(f"sqlite+aiosqlite:///{tmp_path}/missing.db")
    await store.initialize()
    with pytest.raises(ConversationNotFound):
        await store.purge("missing")
    with pytest.raises(ConversationNotFound):
        await store.acquire_request("missing", "request")
    await store.close()
