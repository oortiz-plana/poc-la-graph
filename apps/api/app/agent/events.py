"""Typed lifecycle events consumed by the API's SSE serializer."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import Answer, Citation


class LifecycleEvent(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    type: Literal[
        "message.started",
        "tool.started",
        "tool.completed",
        "answer.delta",
        "citation.available",
        "message.completed",
        "message.failed",
    ]
    request_id: str = Field(serialization_alias="requestId")
    conversation_id: str = Field(serialization_alias="conversationId")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    message_id: str | None = Field(default=None, serialization_alias="messageId")
    tool_call_id: str | None = Field(default=None, serialization_alias="toolCallId")
    tool: str | None = None
    summary: dict[str, Any] | None = None
    delta: str | None = None
    citation: Citation | None = None
    result: Answer | None = None
    error: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        """Return the exact JSON object to serialize as SSE data."""
        payload = self.model_dump(mode="json", by_alias=True, exclude_none=True)
        if self.citation is not None:
            payload["citation"] = self.citation.model_dump(mode="json", by_alias=True)
        if self.result is not None:
            payload["result"] = self.result.model_dump(mode="json", by_alias=True)
        return payload
