"""Provider-neutral language model integration."""

from .client import FollowUpRequest, LanguageModel, ModelRequest
from .errors import (
    ModelConfigurationError,
    ModelError,
    ModelResponseError,
    ModelTimeoutError,
    ModelUnavailableError,
)
from .litellm_client import LiteLLMClient
from .mock import DeterministicModel
from .models import (
    AnswerDraft,
    ChatMessage,
    Confidence,
    FollowUpResolutionOutput,
    FollowUpResult,
    ModelResult,
    TokenUsage,
)

__all__ = [
    "AnswerDraft",
    "ChatMessage",
    "Confidence",
    "DeterministicModel",
    "FollowUpRequest",
    "FollowUpResolutionOutput",
    "FollowUpResult",
    "LanguageModel",
    "LiteLLMClient",
    "ModelConfigurationError",
    "ModelError",
    "ModelRequest",
    "ModelResponseError",
    "ModelTimeoutError",
    "ModelUnavailableError",
    "ModelResult",
    "TokenUsage",
]
