"""Typed conversation API contracts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agent.models import Answer


class ApiModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", populate_by_name=True, serialize_by_alias=True
    )


class CreateConversationRequest(ApiModel):
    project_id: str | None = Field(
        default=None, alias="projectId", min_length=1, max_length=128
    )


class SendMessageRequest(ApiModel):
    message: str = Field(min_length=1, max_length=4000)
    include_graph_paths: bool = Field(default=True, alias="includeGraphPaths")


class Message(ApiModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    status: Literal["pending", "completed", "failed"]
    created_at: datetime = Field(alias="createdAt")
    result: Answer | None = None


class Conversation(ApiModel):
    id: str
    project_id: str = Field(alias="projectId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
    messages: list[Message] = Field(default_factory=list)
