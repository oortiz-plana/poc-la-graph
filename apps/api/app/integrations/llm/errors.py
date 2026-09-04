"""Safe errors exposed by the language model boundary."""


class ModelError(RuntimeError):
    """Base error safe to surface to application error handling."""

    code = "model_error"
    retryable = False


class ModelConfigurationError(ModelError):
    code = "model_configuration_error"


class ModelUnavailableError(ModelError):
    code = "model_unavailable"
    retryable = True

    def __init__(
        self,
        message: str,
        *,
        retryable: bool = True,
        provider_kind: str = "unavailable",
    ) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.provider_kind = provider_kind


class ModelTimeoutError(ModelError):
    code = "model_timeout"
    retryable = True


class ModelResponseError(ModelError):
    code = "invalid_model_response"
