"""Durable async SQLAlchemy conversation repository."""

from __future__ import annotations

import base64
import binascii
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import uuid4

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    and_,
    delete,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.agent.models import Answer
from app.models import Conversation, ConversationList, ConversationSummary, Message

from .protocol import (
    ConversationNotFound,
    ConversationRequestConflict,
    ConversationScope,
    ConversationStateConflict,
    MessageStatus,
)


class Base(DeclarativeBase):
    pass


class ConversationRow(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        Index(
            "ix_conversations_owner_project_archive_updated_id",
            "created_by",
            "project_id",
            "archived_at",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(128), nullable=False)
    graph_version: Mapped[str | None] = mapped_column(String(128))
    created_by: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True
    )
    active_request_id: Mapped[str | None] = mapped_column(String(128))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    messages: Mapped[list[MessageRow]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="MessageRow.ordinal",
        lazy="selectin",
    )


class MessageRow(Base):
    __tablename__ = "conversation_messages"
    __table_args__ = (
        Index(
            "ix_conversation_messages_conversation_ordinal",
            "conversation_id",
            "ordinal",
        ),
    )

    row_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    conversation: Mapped[ConversationRow] = relationship(back_populates="messages")


class SQLAlchemyConversationStore:
    """SQLite/PostgreSQL implementation with durable request leases."""

    def __init__(
        self,
        database_url: str,
        *,
        retention_days: int = 30,
        max_turns: int = 100,
        lease_seconds: int = 120,
    ) -> None:
        if retention_days < 1 or max_turns < 1 or lease_seconds < 1:
            raise ValueError(
                "retention_days, max_turns, and lease_seconds must be positive"
            )
        self._engine: AsyncEngine = create_async_engine(
            database_url, pool_pre_ping=True
        )
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._retention_days = retention_days
        self._max_turns = max_turns
        self._lease_seconds = lease_seconds

    async def initialize(self) -> None:
        async with self._engine.begin() as connection:
            if self._engine.dialect.name == "sqlite":
                await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            await connection.run_sync(Base.metadata.create_all)
        await self.cleanup()

    async def close(self) -> None:
        await self._engine.dispose()

    async def cleanup(self) -> int:
        cutoff = datetime.now(UTC) - timedelta(days=self._retention_days)
        async with self._sessions.begin() as session:
            result = await session.execute(
                delete(ConversationRow).where(
                    ConversationRow.archived_at.is_not(None),
                    ConversationRow.archived_at < cutoff,
                )
            )
            return _rowcount(result)

    async def create(
        self,
        project_id: str,
        graph_version: str | None = None,
        created_by: str = "development-user",
    ) -> Conversation:
        now = datetime.now(UTC)
        row = ConversationRow(
            id=str(uuid4()),
            project_id=project_id,
            graph_version=graph_version,
            created_by=created_by,
            created_at=now,
            updated_at=now,
        )
        async with self._sessions.begin() as session:
            session.add(row)
        return _conversation_model(row, [])

    async def get(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation:
        async with self._sessions() as session:
            row = await _get_row(session, conversation_id, created_by)
            return _conversation_model(row, row.messages)

    async def list_conversations(
        self,
        project_id: str,
        created_by: str = "development-user",
        *,
        state: Literal["active", "archived"] = "active",
        limit: int = 50,
        cursor: str | None = None,
    ) -> ConversationList:
        boundary = _decode_cursor(cursor) if cursor else None
        archived = (
            ConversationRow.archived_at.is_(None)
            if state == "active"
            else ConversationRow.archived_at.is_not(None)
        )
        statement = select(ConversationRow).where(
            ConversationRow.project_id == project_id,
            ConversationRow.created_by == created_by,
            archived,
        )
        if boundary:
            updated_at, identifier = boundary
            statement = statement.where(
                or_(
                    ConversationRow.updated_at < updated_at,
                    and_(
                        ConversationRow.updated_at == updated_at,
                        ConversationRow.id < identifier,
                    ),
                )
            )
        statement = statement.order_by(
            ConversationRow.updated_at.desc(), ConversationRow.id.desc()
        ).limit(limit + 1)
        async with self._sessions() as session:
            rows = list((await session.scalars(statement)).all())
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = (
            _encode_cursor(page[-1].updated_at, page[-1].id)
            if has_more and page
            else None
        )
        return ConversationList(
            items=[_summary_model(row) for row in page], next_cursor=next_cursor
        )

    async def get_scope(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> ConversationScope:
        async with self._sessions() as session:
            row = await _get_row(session, conversation_id, created_by)
            return ConversationScope(row.project_id, row.graph_version)

    async def rename(
        self, conversation_id: str, name: str, created_by: str = "development-user"
    ) -> Conversation:
        normalized = name.strip()
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            row = await _get_row(session, conversation_id, created_by)
            _reject_active_lease(row, now)
            row.name = normalized
            row.updated_at = now
        return _conversation_model(row, row.messages)

    async def archive(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            row = await _get_row(session, conversation_id, created_by)
            _reject_active_lease(row, now)
            row.archived_at = now
            row.updated_at = now

    async def restore(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> Conversation:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            row = await _get_row(
                session, conversation_id, created_by, active_only=False
            )
            if row.archived_at is None:
                raise ConversationNotFound(conversation_id)
            _reject_active_lease(row, now)
            row.archived_at = None
            row.updated_at = now
        return _conversation_model(row, row.messages)

    async def purge(
        self, conversation_id: str, created_by: str = "development-user"
    ) -> None:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            row = await _get_row(
                session, conversation_id, created_by, active_only=False
            )
            if row.archived_at is None:
                raise ConversationStateConflict(conversation_id)
            _reject_active_lease(row, now)
            await session.delete(row)

    async def delete_project(self, project_id: str) -> int:
        async with self._sessions.begin() as session:
            result = await session.execute(
                delete(ConversationRow).where(ConversationRow.project_id == project_id)
            )
            return _rowcount(result)

    async def add_user_message(
        self,
        conversation_id: str,
        content: str,
        created_by: str = "development-user",
    ) -> Message:
        return await self._append(
            conversation_id, "user", content, "completed", None, created_by
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
        role: Literal["user", "assistant"],
        content: str,
        status: MessageStatus,
        result: Answer | None,
        created_by: str,
    ) -> Message:
        now = datetime.now(UTC)
        async with self._sessions.begin() as session:
            conversation = await _get_row(session, conversation_id, created_by)
            ordinal = (
                await session.scalar(
                    select(func.coalesce(func.max(MessageRow.ordinal), 0)).where(
                        MessageRow.conversation_id == conversation_id
                    )
                )
                or 0
            ) + 1
            row = MessageRow(
                id=str(uuid4()),
                conversation_id=conversation_id,
                ordinal=ordinal,
                role=role,
                content=content,
                status=status,
                created_at=now,
                result=result.model_dump(mode="json") if result else None,
            )
            session.add(row)
            conversation.updated_at = now
            if role == "user" and conversation.name is None:
                conversation.name = _derive_name(content)
        return _message_model(row)

    async def acquire_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None:
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=self._lease_seconds)
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(ConversationRow)
                .where(
                    ConversationRow.id == conversation_id,
                    ConversationRow.created_by == created_by,
                    ConversationRow.archived_at.is_(None),
                    or_(
                        ConversationRow.active_request_id.is_(None),
                        ConversationRow.lease_expires_at.is_(None),
                        ConversationRow.lease_expires_at <= now,
                        ConversationRow.active_request_id == request_id,
                    ),
                )
                .values(active_request_id=request_id, lease_expires_at=expires_at)
            )
            if _rowcount(result):
                return
            active_request_id = await session.scalar(
                select(ConversationRow.active_request_id).where(
                    ConversationRow.id == conversation_id,
                    ConversationRow.created_by == created_by,
                    ConversationRow.archived_at.is_(None),
                )
            )
            if active_request_id is None:
                raise ConversationNotFound(conversation_id)
            raise ConversationRequestConflict(conversation_id, active_request_id)

    async def release_request(
        self,
        conversation_id: str,
        request_id: str,
        created_by: str = "development-user",
    ) -> None:
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(ConversationRow)
                .where(
                    ConversationRow.id == conversation_id,
                    ConversationRow.created_by == created_by,
                    ConversationRow.active_request_id == request_id,
                )
                .values(active_request_id=None, lease_expires_at=None)
            )
            if _rowcount(result):
                return
            exists = await session.scalar(
                select(ConversationRow.id).where(
                    ConversationRow.id == conversation_id,
                    ConversationRow.created_by == created_by,
                )
            )
            if exists is None:
                raise ConversationNotFound(conversation_id)

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
        return [message for exchange in reversed(selected) for message in exchange]

    async def _prune(self, conversation_id: str) -> None:
        async with self._sessions.begin() as session:
            rows = list(
                (
                    await session.scalars(
                        select(MessageRow)
                        .where(MessageRow.conversation_id == conversation_id)
                        .order_by(MessageRow.ordinal)
                    )
                ).all()
            )
            exchange_row_ids = _complete_exchange_row_ids(rows)
            excess = len(exchange_row_ids) - self._max_turns
            if excess <= 0:
                return
            remove_ids = [
                row_id for exchange in exchange_row_ids[:excess] for row_id in exchange
            ]
            await session.execute(
                delete(MessageRow).where(MessageRow.row_id.in_(remove_ids))
            )


def create_conversation_store(
    database_url: str,
    retention_days: int = 30,
    max_turns: int = 100,
    lease_seconds: int = 120,
) -> SQLAlchemyConversationStore:
    """Build the configured durable conversation store."""
    return SQLAlchemyConversationStore(
        database_url,
        retention_days=retention_days,
        max_turns=max_turns,
        lease_seconds=lease_seconds,
    )


async def _get_row(
    session: AsyncSession,
    conversation_id: str,
    created_by: str,
    *,
    active_only: bool = True,
) -> ConversationRow:
    filters = [
        ConversationRow.id == conversation_id,
        ConversationRow.created_by == created_by,
    ]
    if active_only:
        filters.append(ConversationRow.archived_at.is_(None))
    row = await session.scalar(select(ConversationRow).where(*filters))
    if row is None:
        raise ConversationNotFound(conversation_id)
    return row


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _message_model(row: MessageRow) -> Message:
    result = Answer.model_validate(row.result) if row.result else None
    return Message.model_validate(
        {
            "id": row.id,
            "role": row.role,
            "content": row.content,
            "status": row.status,
            "created_at": _aware(row.created_at),
            "result": result,
        }
    )


def _conversation_model(
    row: ConversationRow, messages: list[MessageRow]
) -> Conversation:
    return Conversation.model_validate(
        {
            "id": row.id,
            "project_id": row.project_id,
            "name": row.name or "New conversation",
            "created_at": _aware(row.created_at),
            "updated_at": _aware(row.updated_at),
            "archived_at": _aware(row.archived_at) if row.archived_at else None,
            "messages": [_message_model(message) for message in messages],
        }
    )


def _summary_model(row: ConversationRow) -> ConversationSummary:
    return ConversationSummary.model_validate(
        {
            "id": row.id,
            "project_id": row.project_id,
            "name": row.name or "New conversation",
            "created_at": _aware(row.created_at),
            "updated_at": _aware(row.updated_at),
            "archived_at": _aware(row.archived_at) if row.archived_at else None,
        }
    )


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


def _reject_active_lease(row: ConversationRow, now: datetime) -> None:
    if (
        row.active_request_id is not None
        and row.lease_expires_at is not None
        and _aware(row.lease_expires_at) > now
    ):
        raise ConversationRequestConflict(row.id, row.active_request_id)


def _encode_cursor(updated_at: datetime, identifier: str) -> str:
    payload = json.dumps(
        [_aware(updated_at).isoformat(), identifier], separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        value = json.loads(base64.urlsafe_b64decode(cursor + padding))
        if not isinstance(value, list) or len(value) != 2:
            raise ValueError
        timestamp, identifier = value
        if not isinstance(timestamp, str) or not isinstance(identifier, str):
            raise ValueError
        parsed = datetime.fromisoformat(timestamp)
        if parsed.tzinfo is None or not identifier:
            raise ValueError
        return parsed, identifier
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error) as exc:
        raise ValueError("Invalid conversation cursor") from exc


def _rowcount(result: object) -> int:
    return int(cast(CursorResult[Any], result).rowcount or 0)


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


def _complete_exchange_row_ids(rows: list[MessageRow]) -> list[tuple[int, int]]:
    exchanges: list[tuple[int, int]] = []
    pending_user: MessageRow | None = None
    for row in rows:
        if row.role == "user" and row.status == "completed":
            pending_user = row
        elif row.role == "assistant" and row.status == "completed" and pending_user:
            exchanges.append((pending_user.row_id, row.row_id))
            pending_user = None
    return exchanges
