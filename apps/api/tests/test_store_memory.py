from __future__ import annotations

import pytest

from app.store import ConversationRequestConflict, InMemoryConversationStore


async def test_in_memory_store_matches_history_and_lease_contract() -> None:
    store = InMemoryConversationStore(max_turns=1)
    await store.initialize()
    conversation = await store.create("project")
    await store.add_user_message(conversation.id, "first")
    await store.add_assistant_message(conversation.id, "one", "completed")
    await store.add_user_message(conversation.id, "second")
    await store.add_assistant_message(conversation.id, "two", "completed")

    assert [
        message.content
        for message in await store.get_history(
            conversation.id, max_turns=10, max_chars=100
        )
    ] == ["second", "two"]

    await store.acquire_request(conversation.id, "one")
    with pytest.raises(ConversationRequestConflict):
        await store.acquire_request(conversation.id, "two")
    await store.release_request(conversation.id, "one")
    await store.acquire_request(conversation.id, "two")
    await store.close()
