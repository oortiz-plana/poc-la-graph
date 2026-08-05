"""Small, reviewed structured-logging boundary for every application process."""

from __future__ import annotations

import json
import logging
import math
import re
import sys
from datetime import UTC, datetime
from typing import TextIO

_CONTEXT_FIELDS = (
    "request_id",
    "method",
    "path",
    "status_code",
    "auth_reason",
    "auth_cause",
    "error_type",
    "component",
    "ingestion_id",
    "graph_version",
    "document_count",
    "node_count",
    "edge_count",
    "duration_ms",
    "duration_seconds",
)
_MAX_TEXT_LENGTH = 512
_SENSITIVE_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|authorization|password|secret|token)"
    r"(\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+"
)
_PROVIDER_TOKEN = re.compile(r"(?i)\b(sk|rk|pk)-[a-z0-9_-]{8,}\b")
_HOST_PATH = re.compile(r"(?<![\w])/(?:home|knowledge|tmp|var|etc)/[^\s,;]+")
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _sanitize_text(value: object) -> str:
    text = str(value).replace("\r", " ").replace("\n", " ")
    text = _CONTROL_CHARACTERS.sub("", text)
    text = _SENSITIVE_ASSIGNMENT.sub(r"\1\2[REDACTED]", text)
    text = _PROVIDER_TOKEN.sub("[REDACTED]", text)
    text = _HOST_PATH.sub("[PATH_REDACTED]", text)
    if len(text) > _MAX_TEXT_LENGTH:
        return f"{text[:_MAX_TEXT_LENGTH]}…"
    return text


def _safe_value(value: object) -> str | int | float | bool | None:
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return _sanitize_text(value)


class JsonFormatter(logging.Formatter):
    """Emit one valid, compact JSON object per record.

    Only the reviewed context-field allowlist is copied from ``LogRecord``.
    Exception text and arbitrary ``extra`` values are deliberately omitted:
    callers should log an ``error_type`` and keep provider/document details in
    protected diagnostics rather than standard output.
    """

    def __init__(self, *, service: str) -> None:
        super().__init__()
        self.service = service

    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.fromtimestamp(record.created, UTC).isoformat(
            timespec="milliseconds"
        )
        payload: dict[str, str | int | float | bool | None] = {
            "timestamp": timestamp,
            "level": record.levelname,
            "service": self.service,
            "logger": _sanitize_text(record.name),
            "message": _sanitize_text(record.getMessage()),
        }
        for name in _CONTEXT_FIELDS:
            value = getattr(record, name, None)
            if value is not None:
                payload[name] = _safe_value(value)
        return json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )


def configure_logging(
    log_level: str | int,
    *,
    service: str,
    stream: TextIO | None = None,
) -> logging.Logger:
    """Configure the process root logger and return its application logger."""
    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(JsonFormatter(service=service))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(
        log_level if isinstance(log_level, int) else log_level.upper().strip()
    )
    return logging.getLogger(f"graphify_agent.{service}")
