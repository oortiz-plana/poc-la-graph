from __future__ import annotations

import io
import json
import logging

from app.observability import JsonFormatter, configure_logging


def test_formatter_emits_valid_utf8_json_and_reviewed_context() -> None:
    record = logging.LogRecord(
        name="graphify_agent.knowledge",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="knowledge_ingestion_completed",
        args=(),
        exc_info=None,
    )
    record.ingestion_id = "ingestión-uno"
    record.graph_version = "versión-uno"
    record.document_count = 4
    record.node_count = 120
    record.edge_count = 150
    record.duration_ms = 321

    payload = json.loads(JsonFormatter(service="knowledge-ingestion").format(record))

    assert payload["service"] == "knowledge-ingestion"
    assert payload["message"] == "knowledge_ingestion_completed"
    assert payload["ingestion_id"] == "ingestión-uno"
    assert payload["graph_version"] == "versión-uno"
    assert payload["document_count"] == 4
    assert payload["node_count"] == 120
    assert payload["edge_count"] == 150
    assert payload["duration_ms"] == 321
    assert payload["timestamp"].endswith("+00:00")


def test_formatter_ignores_arbitrary_extras_and_redacts_sensitive_text() -> None:
    record = logging.LogRecord(
        name="graphify_agent.test",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=(
            "provider failed api_key=sk-super-secret-value "
            "at /home/person/private/legal.md"
        ),
        args=(),
        exc_info=None,
    )
    record.request_id = "request token=do-not-print"
    record.unreviewed_payload = "password=must-not-appear"

    encoded = JsonFormatter(service="api").format(record)
    payload = json.loads(encoded)

    assert "super-secret-value" not in encoded
    assert "/home/person" not in encoded
    assert "must-not-appear" not in encoded
    assert "unreviewed_payload" not in payload
    assert payload["request_id"] == "request token=[REDACTED]"
    assert "[PATH_REDACTED]" in payload["message"]


def test_formatter_omits_exception_details_and_bounds_message_size() -> None:
    try:
        raise RuntimeError("authorization=Bearer private-credential")
    except RuntimeError:
        record = logging.LogRecord(
            name="graphify_agent.test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="x" * 2_000,
            args=(),
            exc_info=True,
        )

    payload = json.loads(JsonFormatter(service="api").format(record))

    assert len(payload["message"]) == 513
    assert payload["message"].endswith("…")
    assert "exception" not in payload


def test_configure_logging_routes_application_events_to_selected_stream() -> None:
    stream = io.StringIO()
    root = logging.getLogger()
    original_handlers = root.handlers[:]
    original_level = root.level
    try:
        logger = configure_logging("INFO", service="knowledge-ingestion", stream=stream)
        logger.info(
            "knowledge_ingestion_started",
            extra={"ingestion_id": "job-1", "document_count": 4},
        )
    finally:
        root.handlers = original_handlers
        root.setLevel(original_level)

    payload = json.loads(stream.getvalue())
    assert payload["service"] == "knowledge-ingestion"
    assert payload["ingestion_id"] == "job-1"
    assert payload["document_count"] == 4
