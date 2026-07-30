"""Safe errors exposed by the language model boundary."""


class ModelError(RuntimeError):
    """Base error safe to surface to application error handling."""

    code = "model_error"


class ModelConfigurationError(ModelError):
    code = "model_configuration_error"


class ModelUnavailableError(ModelError):
    code = "model_unavailable"


class ModelTimeoutError(ModelError):
    code = "model_timeout"


class ModelResponseError(ModelError):
    code = "invalid_model_response"
