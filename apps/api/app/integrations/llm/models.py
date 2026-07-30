"""Typed, provider-independent model contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Confidence = Literal["high", "medium", "low", "insufficient"]
FollowUpKind = Literal["standalone", "resolved_follow_up", "clarification"]


class ChatMessage(BaseModel):
    """A message accepted by the internal model interface."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1)


class AnswerDraft(BaseModel):
    """Structured answer produced by a model before grounding validation.

    ``citation_ids`` may only refer to evidence identifiers supplied in the
    request. The workflow remains responsible for enforcing that invariant.
    """

    model_config = ConfigDict(extra="forbid")

    answer: str = Field(min_length=1)
    confidence: Confidence
    citation_ids: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class ModelResult(BaseModel):
    """Normalized result; no provider response object crosses this boundary."""

    model_config = ConfigDict(extra="forbid")

    output: AnswerDraft
    model: str
    usage: TokenUsage = Field(default_factory=TokenUsage)
    finish_reason: str | None = None


class FollowUpResolutionOutput(BaseModel):
    """Structured output for converting a contextual turn into a safe query."""

    model_config = ConfigDict(extra="forbid")

    kind: FollowUpKind
    standalone_query: str | None = Field(default=None, max_length=4000)
    clarification_question: str | None = Field(default=None, max_length=1000)
    referenced_turn_ids: list[str] = Field(default_factory=list, max_length=6)


class FollowUpResult(BaseModel):
    """Normalized follow-up result; provider objects never cross this boundary."""

    model_config = ConfigDict(extra="forbid")

    output: FollowUpResolutionOutput
    model: str
    usage: TokenUsage = Field(default_factory=TokenUsage)
    finish_reason: str | None = None
