"""Persistence boundary for conversations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from app.agent.models import Answer
from app.models import Conversation, ConversationList, Message

MessageStatus = Literal["pending", "completed", "failed"]


@dataclass(frozen=True)
class ConversationScope:
    project_id: str
    graph_version: str | None


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


class ConversationStateConflict(RuntimeError):
    """Raised when archive state does not allow a mutation."""


class ConversationStore(Protocol):
    """Storage interface used by the API and agent workflow."""

    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    async def cleanup(self) -> int:
        """Delete expired conversations and return the number removed."""
        ...

    async def create(
        self,
        project_id: str,
        graph_version: str | None = None,
        created_by: str = "development-user",
    ) -> Conversation: ...

    async def get(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation: ...

    async def list_conversations(
        self,
        project_id: str,
        created_by: str = "development-user",
        *,
        state: Literal["active", "archived"] = "active",
        limit: int = 50,
        cursor: str | None = None,
    ) -> ConversationList: ...

    async def get_scope(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> ConversationScope: ...

    async def rename(
        self, conversation_id: str, name: str, created_by: str = "development-user"
    ) -> Conversation: ...

    async def archive(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None: ...

    async def restore(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation: ...

    async def purge(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None: ...

    async def delete_project(self, project_id: str) -> int: ...

    async def add_user_message(
        self,
        conversation_id: str,
        content: str,
        created_by: str = "development-user",
    ) -> Message: ...

    async def add_assistant_message(
        self,
        conversation_id: str,
        content: str,
        status: MessageStatus,
        result: Answer | None = None,
        created_by: str = "development-user",
    ) -> Message: ...

    async def acquire_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None: ...

    async def release_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None: ...

    async def get_history(
        self,
        conversation_id: str,
        max_turns: int,
        max_chars: int,
        created_by: str = "development-user",
    ) -> list[Message]:
        """Return bounded completed exchanges, in chronological order."""
        ...
