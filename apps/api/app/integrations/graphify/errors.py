"""Stable errors exposed by the Graphify integration boundary."""

from __future__ import annotations

from typing import Literal

GraphifyErrorCategory = Literal[
    "unavailable",
    "timeout",
    "invalid_response",
    "limit_exceeded",
    "configuration",
    "not_found",
]


class GraphifyError(RuntimeError):
    """An error safe for application-level handling."""

    def __init__(self, category: GraphifyErrorCategory, message: str) -> None:
        super().__init__(message)
        self.category = category


class GraphifyConfigurationError(GraphifyError):
    def __init__(self, message: str) -> None:
        super().__init__("configuration", message)
