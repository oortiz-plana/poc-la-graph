"""Concurrency-safe process-local conversation storage for deterministic tests."""

from __future__ import annotations

import asyncio
import base64
import json
import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from app.agent.models import Answer
from app.models import Conversation, ConversationList, ConversationSummary, Message

from .protocol import (
    ConversationNotFound,
    ConversationRequestConflict,
    ConversationScope,
    ConversationStateConflict,
    MessageStatus,
)


class InMemoryConversationStore:
    """Explicitly ephemeral storage; returned objects are defensive copies."""

    def __init__(
        self,
        *,
        retention_days: int = 30,
        max_turns: int = 100,
        lease_seconds: int = 120,
    ) -> None:
        self._items: dict[str, Conversation] = {}
        self._leases: dict[str, tuple[str, datetime]] = {}
        self._versions: dict[str, str | None] = {}
        self._owners: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._retention_days = retention_days
        self._max_turns = max_turns
        self._lease_seconds = lease_seconds

    async def initialize(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def cleanup(self) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=self._retention_days)
        async with self._lock:
            expired = [
                conversation_id
                for conversation_id, conversation in self._items.items()
                if conversation.archived_at is not None
                and conversation.archived_at < cutoff
            ]
            for conversation_id in expired:
                del self._items[conversation_id]
                self._leases.pop(conversation_id, None)
                self._versions.pop(conversation_id, None)
                self._owners.pop(conversation_id, None)
        return len(expired)

    async def create(
        self,
        project_id: str,
        graph_version: str | None = None,
        created_by: str = "development-user",
    ) -> Conversation:
        now = datetime.now(UTC)
        conversation = Conversation.model_validate(
            {
                "id": str(uuid4()),
                "project_id": project_id,
                "name": "New conversation",
                "created_at": now,
                "updated_at": now,
                "archived_at": None,
                "messages": [],
            }
        )
        async with self._lock:
            self._items[conversation.id] = conversation
            self._versions[conversation.id] = graph_version
            self._owners[conversation.id] = created_by
        return conversation.model_copy(deep=True)

    async def get(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation:
        async with self._lock:
            item = self._items.get(conversation_id)
            if (
                item is None
                or self._owners.get(conversation_id) != created_by
                or item.archived_at is not None
            ):
                raise ConversationNotFound(conversation_id)
            return item.model_copy(deep=True)

    async def list_conversations(
        self,
        project_id: str,
        created_by: str = "development-user",
        *,
        state: str = "active",
        limit: int = 50,
        cursor: str | None = None,
    ) -> ConversationList:
        boundary = _decode_cursor(cursor) if cursor else None
        async with self._lock:
            rows = [
                item
                for identifier, item in self._items.items()
                if item.project_id == project_id
                and self._owners.get(identifier) == created_by
                and (item.archived_at is None) == (state == "active")
                and (boundary is None or (item.updated_at, item.id) < boundary)
            ]
            rows.sort(key=lambda item: (item.updated_at, item.id), reverse=True)
            page = rows[: limit + 1]
        has_more = len(page) > limit
        page = page[:limit]
        return ConversationList(
            items=[
                ConversationSummary.model_validate(
                    item.model_dump(exclude={"messages"})
                )
                for item in page
            ],
            next_cursor=(
                _encode_cursor(page[-1].updated_at, page[-1].id)
                if has_more and page
                else None
            ),
        )

    async def get_scope(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> ConversationScope:
        async with self._lock:
            item = self._items.get(conversation_id)
            if (
                item is None
                or self._owners.get(conversation_id) != created_by
                or item.archived_at is not None
            ):
                raise ConversationNotFound(conversation_id)
            return ConversationScope(
                item.project_id, self._versions.get(conversation_id)
            )

    async def rename(
        self, conversation_id: str, name: str, created_by: str = "development-user"
    ) -> Conversation:
        async with self._lock:
            item = self._owned(conversation_id, created_by)
            self._reject_lease(conversation_id)
            item.name = name.strip()
            item.updated_at = datetime.now(UTC)
            return item.model_copy(deep=True)

    async def archive(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None:
        async with self._lock:
            item = self._owned(conversation_id, created_by)
            self._reject_lease(conversation_id)
            now = datetime.now(UTC)
            item.archived_at = now
            item.updated_at = now

    async def restore(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation:
        async with self._lock:
            item = self._owned(conversation_id, created_by, active_only=False)
            if item.archived_at is None:
                raise ConversationNotFound(conversation_id)
            self._reject_lease(conversation_id)
            item.archived_at = None
            item.updated_at = datetime.now(UTC)
            return item.model_copy(deep=True)

    async def purge(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None:
        async with self._lock:
            item = self._owned(conversation_id, created_by, active_only=False)
            if item.archived_at is None:
                raise ConversationStateConflict(conversation_id)
            self._reject_lease(conversation_id)
            self._items.pop(conversation_id)
            self._versions.pop(conversation_id, None)
            self._owners.pop(conversation_id, None)
            self._leases.pop(conversation_id, None)

    async def delete_project(self, project_id: str) -> int:
        async with self._lock:
            identifiers = [
                identifier
                for identifier, conversation in self._items.items()
                if conversation.project_id == project_id
            ]
            for identifier in identifiers:
                self._items.pop(identifier, None)
                self._versions.pop(identifier, None)
                self._owners.pop(identifier, None)
                self._leases.pop(identifier, None)
            return len(identifiers)

    async def add_user_message(
        self,
        conversation_id: str,
        content: str,
        created_by: str = "development-user",
    ) -> Message:
        return await self._append(
            conversation_id, "user", content, "completed", created_by=created_by
        )

    async def add_assistant_message(
        self,
        conversation_id: str,
        content: str,
        status: MessageStatus,
        result: Answer | None = None,
        created_by: str = "development-user",
    ) -> Message:
        message = await self._append(
            conversation_id, "assistant", content, status, result, created_by
        )
        await self._prune(conversation_id)
        return message

    async def _append(
        self,
        conversation_id: str,
        role: str,
        content: str,
        status: MessageStatus,
        result: Answer | None = None,
        created_by: str = "development-user",
    ) -> Message:
        message = Message.model_validate(
            {
                "id": str(uuid4()),
                "role": role,
                "content": content,
                "status": status,
                "created_at": datetime.now(UTC),
                "result": result,
            }
        )
        async with self._lock:
            item = self._items.get(conversation_id)
            if (
                item is None
                or self._owners.get(conversation_id) != created_by
                or item.archived_at is not None
            ):
                raise ConversationNotFound(conversation_id)
            item.messages.append(message)
            item.updated_at = datetime.now(UTC)
            if role == "user" and item.name == "New conversation":
                item.name = _derive_name(content)
        return message.model_copy(deep=True)

    async def acquire_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None:
        now = datetime.now(UTC)
        async with self._lock:
            item = self._items.get(conversation_id)
            if (
                item is None
                or self._owners.get(conversation_id) != created_by
                or item.archived_at is not None
            ):
                raise ConversationNotFound(conversation_id)
            lease = self._leases.get(conversation_id)
            if lease and lease[0] != request_id and lease[1] > now:
                raise ConversationRequestConflict(conversation_id, lease[0])
            self._leases[conversation_id] = (
                request_id,
                now + timedelta(seconds=self._lease_seconds),
            )

    async def release_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None:
        async with self._lock:
            if (
                conversation_id not in self._items
                or self._owners.get(conversation_id) != created_by
            ):
                raise ConversationNotFound(conversation_id)
            lease = self._leases.get(conversation_id)
            if lease and lease[0] == request_id:
                self._leases.pop(conversation_id, None)

    async def get_history(
        self,
        conversation_id: str,
        max_turns: int,
        max_chars: int,
        created_by: str = "development-user",
    ) -> list[Message]:
        conversation = await self.get(conversation_id, created_by)
        exchanges = _complete_exchanges(conversation.messages)
        selected: list[tuple[Message, Message]] = []
        used_chars = 0
        for exchange in reversed(exchanges[-max_turns:]):
            exchange_chars = len(exchange[0].content) + len(exchange[1].content)
            if selected and used_chars + exchange_chars > max_chars:
                break
            if exchange_chars > max_chars:
                continue
            selected.append(exchange)
            used_chars += exchange_chars
        return [
            message.model_copy(deep=True)
            for exchange in reversed(selected)
            for message in exchange
        ]

    async def _prune(self, conversation_id: str) -> None:
        async with self._lock:
            conversation = self._items.get(conversation_id)
            if conversation is None:
                raise ConversationNotFound(conversation_id)
            exchanges = _complete_exchanges(conversation.messages)
            excess = len(exchanges) - self._max_turns
            if excess <= 0:
                return
            remove_ids = {
                message.id for exchange in exchanges[:excess] for message in exchange
            }
            conversation.messages = [
                message
                for message in conversation.messages
                if message.id not in remove_ids
            ]

    def _owned(
        self, conversation_id: str, created_by: str, *, active_only: bool = True
    ) -> Conversation:
        item = self._items.get(conversation_id)
        if (
            item is None
            or self._owners.get(conversation_id) != created_by
            or (active_only and item.archived_at is not None)
        ):
            raise ConversationNotFound(conversation_id)
        return item

    def _reject_lease(self, conversation_id: str) -> None:
        lease = self._leases.get(conversation_id)
        if lease and lease[1] > datetime.now(UTC):
            raise ConversationRequestConflict(conversation_id, lease[0])


def _complete_exchanges(messages: list[Message]) -> list[tuple[Message, Message]]:
    exchanges: list[tuple[Message, Message]] = []
    pending_user: Message | None = None
    for message in messages:
        if message.role == "user" and message.status == "completed":
            pending_user = message
        elif (
            message.role == "assistant"
            and message.status == "completed"
            and pending_user is not None
        ):
            exchanges.append((pending_user, message))
            pending_user = None
    return exchanges


def _derive_name(content: str) -> str:
    normalized = " ".join(content.split())
    match = re.search(r"[.!?;:](?:\s|$)", normalized)
    candidate = normalized[: match.end()].strip() if match else normalized
    if len(candidate) <= 80:
        return candidate
    prefix = candidate[:79].rstrip()
    boundary = prefix.rfind(" ")
    if boundary > 0:
        prefix = prefix[:boundary]
    return f"{prefix.rstrip()}…"


def _encode_cursor(updated_at: datetime, identifier: str) -> str:
    payload = json.dumps([updated_at.isoformat(), identifier]).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        timestamp, identifier = value
        parsed = datetime.fromisoformat(timestamp)
        if parsed.tzinfo is None or not identifier:
            raise ValueError
        return parsed, identifier
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid conversation cursor") from exc
