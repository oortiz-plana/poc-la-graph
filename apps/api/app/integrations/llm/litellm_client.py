"""LiteLLM implementation of the internal model interface."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from .client import FollowUpRequest, ModelRequest
from .errors import (
    ModelConfigurationError,
    ModelResponseError,
    ModelTimeoutError,
    ModelUnavailableError,
)
from .models import (
    AnswerDraft,
    FollowUpResolutionOutput,
    FollowUpResult,
    ModelResult,
    TokenUsage,
)


class LiteLLMSettings(Protocol):
    """Minimal settings shape required by this adapter."""

    model: str
    api_base: str | None
    api_key: str | None
    timeout: float
    retries: int


class LiteLLMClient:
    """OpenAI-compatible model access through LiteLLM.

    Importing LiteLLM lazily keeps provider dependencies contained here and
    allows deterministic test models to run without loading provider SDKs.
    """

    def __init__(self, settings: LiteLLMSettings) -> None:
        self._model = settings.model.strip()
        self._api_base = settings.api_base
        self._api_key = settings.api_key
        self._timeout = settings.timeout
        self._retries = settings.retries
        if not self._model:
            raise ModelConfigurationError("LLM_MODEL is required")
        if self._timeout <= 0 or self._retries < 0:
            raise ModelConfigurationError("Invalid model timeout or retry count")

    async def generate(self, request: ModelRequest) -> ModelResult:
        response = await self._complete(
            request.messages,
            request.temperature,
            request.max_tokens,
            response_format=_strict_response_format(AnswerDraft, "answer_draft"),
        )
        return self._normalize(response)

    async def resolve_follow_up(self, request: FollowUpRequest) -> FollowUpResult:
        response = await self._complete(
            request.messages,
            request.temperature,
            request.max_tokens,
            response_format=_strict_response_format(
                FollowUpResolutionOutput, "follow_up_resolution"
            ),
        )
        return self._normalize_follow_up(response)

    async def _complete(
        self,
        messages: list[Any],
        temperature: float,
        max_tokens: int,
        *,
        response_format: Mapping[str, Any],
    ) -> Any:
        try:
            from litellm import acompletion
        except ImportError as exc:  # pragma: no cover - deployment packaging issue
            raise ModelConfigurationError("LiteLLM is not installed") from exc

        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": [message.model_dump() for message in messages],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "timeout": self._timeout,
            "num_retries": self._retries,
            "response_format": response_format,
        }
        if self._api_base:
            kwargs["api_base"] = self._api_base
        if self._api_key:
            kwargs["api_key"] = self._api_key

        try:
            response = await asyncio.wait_for(
                acompletion(**kwargs),
                timeout=self._timeout * (self._retries + 1),
            )
        except TimeoutError as exc:
            raise ModelTimeoutError("The model request timed out") from exc
        except Exception as exc:
            # Provider messages can contain URLs, request bodies, or credentials.
            # Preserve the causal exception for server logs but expose no details.
            raise ModelUnavailableError("The model provider is unavailable") from exc

        return response

    def _normalize(self, response: Any) -> ModelResult:
        try:
            choice = _first_choice(response)
            message = _field(choice, "message")
            # Some OpenAI-compatible providers expose a parsed structured
            # object in ``message.parsed`` while others return JSON text.
            parsed = _field(message, "parsed", default=None)
            raw_content = parsed if parsed is not None else _field(message, "content")
            draft = AnswerDraft.model_validate(_json_object(raw_content))
            usage_value = _field(response, "usage", default=None)
            usage = _normalize_usage(usage_value)
            return ModelResult(
                output=draft,
                model=str(_field(response, "model", default=self._model)),
                usage=usage,
                finish_reason=_field(choice, "finish_reason", default=None),
            )
        except (
            AttributeError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise ModelResponseError(
                "The model returned an invalid structured response"
            ) from exc

    def _normalize_follow_up(self, response: Any) -> FollowUpResult:
        try:
            choice = _first_choice(response)
            message = _field(choice, "message")
            parsed = _field(message, "parsed", default=None)
            raw_content = parsed if parsed is not None else _field(message, "content")
            output = FollowUpResolutionOutput.model_validate(_json_object(raw_content))
            return FollowUpResult(
                output=output,
                model=str(_field(response, "model", default=self._model)),
                usage=_normalize_usage(_field(response, "usage", default=None)),
                finish_reason=_field(choice, "finish_reason", default=None),
            )
        except (
            AttributeError,
            IndexError,
            TypeError,
            ValueError,
            ValidationError,
        ) as exc:
            raise ModelResponseError(
                "The model returned an invalid follow-up response"
            ) from exc


def _field(value: Any, name: str, default: Any = ...) -> Any:
    """Read a field from SDK objects and mapping-shaped test/provider results."""
    if isinstance(value, Mapping):
        if name in value:
            return value[name]
    else:
        try:
            return getattr(value, name)
        except AttributeError:
            pass
    if default is ...:
        raise AttributeError(f"missing provider field: {name}")
    return default


def _first_choice(response: Any) -> Any:
    choices = _field(response, "choices")
    if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes)):
        raise TypeError("provider choices are not a sequence")
    if not choices:
        raise IndexError("provider returned no choices")
    return choices[0]


def _strict_response_format(model: type[BaseModel], name: str) -> dict[str, Any]:
    """Build the strict JSON Schema accepted by OpenAI-compatible providers.

    Pydantic omits defaulted fields from ``required`` even when they are part of
    the declared response shape. Strict structured outputs require every object
    property to be listed as required; nullable fields remain nullable through
    their generated ``anyOf`` schema. The runtime Pydantic validation below is
    retained as a second, provider-independent boundary.
    """

    schema = model.model_json_schema()

    def require_all_properties(value: Any) -> None:
        if isinstance(value, dict):
            properties = value.get("properties")
            if isinstance(properties, dict):
                value["required"] = list(properties)
            for nested in value.values():
                require_all_properties(nested)
        elif isinstance(value, list):
            for nested in value:
                require_all_properties(nested)

    require_all_properties(schema)
    return {
        "type": "json_schema",
        "json_schema": {"name": name, "strict": True, "schema": schema},
    }


def _json_object(content: Any) -> Mapping[str, Any]:
    """Normalize common JSON response representations without weakening validation.

    LiteLLM may return text, a parsed object, or a list of text content parts.
    Markdown JSON fences are accepted because several OpenAI-compatible gateways
    add them despite ``response_format=json_object``. Any other prose or JSON
    shape is rejected and subsequently surfaced as the safe public error.
    """
    if isinstance(content, Mapping):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, Mapping) and part.get("type") in {
                "text",
                "output_text",
            }:
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(part, str):
                parts.append(part)
        content = "".join(parts)
    if not isinstance(content, str):
        raise TypeError("model content is not JSON text")
    text = content.strip()
    if text.startswith("```") and text.endswith("```"):
        lines = text.splitlines()
        if len(lines) < 3:
            raise ValueError("empty JSON code fence")
        text = "\n".join(lines[1:-1]).strip()
        if text.lower().startswith("json\n"):
            text = text[5:].lstrip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        # A few gateways prepend a short status/reasoning marker even when
        # JSON mode is requested (for example ``<json>...``). Extract only a
        # syntactically complete object; Pydantic still validates its exact
        # schema below, so arbitrary prose can never cross this boundary.
        decoder = json.JSONDecoder()
        parsed = None
        for offset, character in enumerate(text):
            if character != "{":
                continue
            try:
                candidate, _ = decoder.raw_decode(text[offset:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, Mapping):
                parsed = candidate
                break
        if parsed is None:
            raise
    if not isinstance(parsed, Mapping):
        raise TypeError("structured model response must be an object")
    return parsed


def _normalize_usage(value: Any) -> TokenUsage:
    if value is None:
        return TokenUsage()

    def integer(name: str) -> int:
        raw = (
            value.get(name, 0)
            if isinstance(value, Mapping)
            else getattr(value, name, 0)
        )
        return raw if isinstance(raw, int) and raw >= 0 else 0

    return TokenUsage(
        prompt_tokens=integer("prompt_tokens"),
        completion_tokens=integer("completion_tokens"),
        total_tokens=integer("total_tokens"),
    )
