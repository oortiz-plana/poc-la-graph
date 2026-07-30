"""Black-box synthetic multi-turn and restart-persistence verification."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

API_BASE = "http://127.0.0.1:8000"
REPOSITORY = Path(__file__).resolve().parents[3]
COMPOSE_FILES = tuple(
    os.getenv(
        "E2E_COMPOSE_FILES",
        "docker-compose.yml:docker-compose.synthetic.yml",
    ).split(":")
)


def request_json(
    method: str, path: str, payload: dict[str, Any] | None = None
) -> dict[str, Any]:
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def send_message(conversation_id: str, message: str) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{API_BASE}/api/v1/conversations/{conversation_id}/messages",
        data=json.dumps({"message": message, "includeGraphPaths": True}).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        content_type = response.headers.get("Content-Type", "")
        assert "text/event-stream" in content_type, content_type
        frames = [
            json.loads(line.removeprefix("data:").strip())
            for raw_line in response
            if (line := raw_line.decode().strip()).startswith("data:")
        ]

    completed = next(
        frame["result"] for frame in frames if frame["type"] == "message.completed"
    )
    event_types = [frame["type"] for frame in frames]
    common = ("message.started", "answer.delta", "message.completed")
    positions = [event_types.index(event_type) for event_type in common]
    assert positions == sorted(positions), event_types
    assert completed["conversationId"] == conversation_id
    assert completed["answer"].strip()
    response_type = completed["responseType"]
    if response_type == "clarification":
        assert "tool.started" not in event_types
        assert not completed["citations"]
    else:
        retrieval = ("tool.started", "tool.completed")
        retrieval_positions = [
            event_types.index(event_type) for event_type in retrieval
        ]
        assert retrieval_positions == sorted(retrieval_positions), event_types
        if response_type == "answer":
            assert "citation.available" in event_types
            assert completed["citations"]
        else:
            assert response_type == "insufficient"
            assert os.getenv("E2E_ALLOW_INSUFFICIENT", "false").lower() == "true"
            assert not completed["citations"]
            assert completed["graphEvidence"]["nodes"]
    return {
        "eventTypes": event_types,
        "result": completed,
    }


def restart_api() -> None:
    command = ["docker", "compose"]
    for compose_file in COMPOSE_FILES:
        command.extend(("-f", compose_file))
    subprocess.run(
        [*command, "restart", "api"],
        cwd=REPOSITORY,
        check=True,
        timeout=120,
    )
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            ready = request_json("GET", "/ready")
            if ready.get("ready") is True:
                return
        except (OSError, urllib.error.HTTPError):
            pass
        time.sleep(1)
    raise TimeoutError("API did not become ready after restart")


def main() -> None:
    conversation = request_json(
        "POST", "/api/v1/conversations", {"projectId": "sample-project"}
    )
    conversation_id = conversation["id"]
    first = send_message(
        conversation_id,
        os.getenv(
            "E2E_FIRST_QUESTION",
            "¿Cómo se relaciona Knowledge Chat Web con Knowledge Agent API?",
        ),
    )
    follow_up = send_message(
        conversation_id,
        os.getenv(
            "E2E_FOLLOW_UP_QUESTION",
            "¿Y cómo se conecta este último con Graphify?",
        ),
    )

    restart_api()
    restored = request_json("GET", f"/api/v1/conversations/{conversation_id}")
    assert restored["id"] == conversation_id
    assert restored["projectId"] == "sample-project"
    assert len(restored["messages"]) == 4, restored["messages"]
    assert [message["role"] for message in restored["messages"]] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assistant_results = [
        message["result"]
        for message in restored["messages"]
        if message["role"] == "assistant"
    ]
    assert [result["responseType"] for result in assistant_results] == [
        first["result"]["responseType"],
        follow_up["result"]["responseType"],
    ]
    assert all(
        result["citations"] if result["responseType"] == "answer" else True
        for result in assistant_results
    )

    print(
        json.dumps(
            {
                "conversationId": conversation_id,
                "firstTurn": {
                    "responseType": first["result"]["responseType"],
                    "citationCount": len(first["result"]["citations"]),
                    "eventCount": len(first["eventTypes"]),
                },
                "followUp": {
                    "responseType": follow_up["result"]["responseType"],
                    "citationCount": len(follow_up["result"]["citations"]),
                    "eventCount": len(follow_up["eventTypes"]),
                },
                "persistedMessageCount": len(restored["messages"]),
                "apiRestarted": True,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
