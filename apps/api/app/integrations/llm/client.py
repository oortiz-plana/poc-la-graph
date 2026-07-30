"""Internal language model interface."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

from .models import ChatMessage, FollowUpResult, ModelResult


class ModelRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=1200, ge=1, le=8192)


class FollowUpRequest(BaseModel):
    """A constrained model request that cannot invoke tools."""

    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    max_tokens: int = Field(default=600, ge=1, le=2048)


@runtime_checkable
class LanguageModel(Protocol):
    """The only model dependency exposed to agent orchestration."""

    async def generate(self, request: ModelRequest) -> ModelResult:
        """Generate a structured, normalized answer."""

    async def resolve_follow_up(self, request: FollowUpRequest) -> FollowUpResult:
        """Resolve conversation references without granting model tool access."""
