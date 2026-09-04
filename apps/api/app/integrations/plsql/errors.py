"""Normalized errors for the PL/SQL analysis gateway."""

from __future__ import annotations


class PlsqlError(Exception):
    """Base class for analysis gateway failures; category maps to a Problem code."""

    category = "analysis_unavailable"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class PlsqlNotConfigured(PlsqlError):
    """The analysis adapter is disabled; the console is not configured."""

    category = "analysis_not_configured"


class PlsqlObjectNotFound(PlsqlError):
    """No graph object matches the requested identifier."""

    category = "analysis_not_found"


class PlsqlUnavailable(PlsqlError):
    """The analysis backend cannot serve the request (network or driver)."""

    category = "analysis_unavailable"


class PlsqlTimeout(PlsqlError):
    """An analysis query exceeded its configured deadline."""

    category = "analysis_unavailable"


class PlsqlLimitExceeded(PlsqlError):
    """An analysis result exceeded configured bounds."""

    category = "analysis_limit_exceeded"


class PlsqlConfigurationError(PlsqlError):
    """Invalid analysis configuration; the adapter cannot start."""

    category = "analysis_unavailable"
