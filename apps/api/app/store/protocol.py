"""Persistence boundary for conversations."""

from __future__ import annotations

from typing import Literal, Protocol

from app.agent.models import Answer
from app.models import Conversation, Message

MessageStatus = Literal["pending", "completed", "failed"]


class ConversationNotFound(KeyError):
    """Raised when a conversation identifier does not exist."""


class ConversationRequestConflict(RuntimeError):
    """Raised when another request currently owns the conversation lease."""

    def __init__(
        self, conversation_id: str, active_request_id: str | None = None
    ) -> None:
        super().__init__(conversation_id)
        self.conversation_id = conversation_id
        self.active_request_id = active_request_id


class ConversationStore(Protocol):
    """Storage interface used by the API and agent workflow."""

    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def cleanup(self) -> int:
        """Delete expired conversations and return the number removed."""
        ...

    async def create(self, project_id: str) -> Conversation: ...

    async def get(self, conversation_id: str) -> Conversation: ...

    async def delete(self, conversation_id: str) -> None: ...

    async def add_user_message(self, conversation_id: str, content: str) -> Message: ...

    async def add_assistant_message(
        self,
        conversation_id: str,
        content: str,
        status: MessageStatus,
        result: Answer | None = None,
    ) -> Message: ...

    async def acquire_request(self, conversation_id: str, request_id: str) -> None: ...

    async def release_request(self, conversation_id: str, request_id: str) -> None: ...

    async def get_history(
        self,
        conversation_id: str,
        max_turns: int,
        max_chars: int,
    ) -> list[Message]:
        """Return bounded completed exchanges, in chronological order."""
        ...
