"""Validate a completed Spanish SSE answer without asserting exact legal wording."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


def main(path: str) -> int:
    completed: dict[str, Any] | None = None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.startswith("data: "):
            continue
        value = line.removeprefix("data: ")
        if value == "[DONE]":
            continue
        payload = json.loads(value)
        if payload.get("type") == "message.completed":
            completed = payload
    if completed is None:
        raise RuntimeError("spanish_smoke_missing_completed_event")
    result = completed.get("result")
    if not isinstance(result, dict):
        raise RuntimeError("spanish_smoke_missing_result")
    answer = result.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise RuntimeError("spanish_smoke_empty_answer")
    words = set(re.findall(r"[a-záéíóúñü]+", answer.lower()))
    spanish_markers = {
        "según",
        "evidencia",
        "establece",
        "sistema",
        "pensiones",
        "información",
        "insuficiente",
        "ley",
    }
    if not words.intersection(spanish_markers):
        raise RuntimeError("spanish_smoke_answer_language_mismatch")
    graph_version = result.get("graphVersion")
    citations = result.get("citations")
    evidence = result.get("graphEvidence")
    if not isinstance(graph_version, str) or not graph_version:
        raise RuntimeError("spanish_smoke_missing_graph_version")
    if not isinstance(citations, list) or not citations:
        raise RuntimeError("spanish_smoke_missing_citations")
    if not isinstance(evidence, dict) or not evidence.get("nodes"):
        raise RuntimeError("spanish_smoke_missing_graph_evidence")
    print(
        json.dumps(
            {
                "status": "passed",
                "graphVersion": graph_version,
                "confidence": result.get("confidence"),
                "citationCount": len(citations),
                "nodeCount": len(evidence["nodes"]),
                "edgeCount": len(evidence.get("edges", [])),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
