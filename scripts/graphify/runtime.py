"""Run the verified Graphify 0.9.18 Streamable HTTP MCP entry point."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path


def main() -> int:
    if os.getenv("GRAPHIFY_RUNTIME_MODE", "real") != "real":
        print("graphify_runtime_error=real_mode_required", flush=True)
        return 78
    graph = Path(os.getenv("GRAPHIFY_GRAPH_PATH", "/knowledge/graph/active/graph.json"))
    timeout = int(os.getenv("GRAPHIFY_STARTUP_WAIT_SECONDS", "600"))
    deadline = time.monotonic() + timeout
    while not graph.is_file():
        if time.monotonic() >= deadline:
            print("graphify_runtime_error=active_graph_unavailable", flush=True)
            return 78
        time.sleep(1)
    command = [
        "graphify-mcp",
        "--graph",
        str(graph),
        "--transport",
        "http",
        "--host",
        "0.0.0.0",
        "--port",
        "8001",
        "--path",
        "/mcp",
        "--stateless",
    ]
    os.execvp(command[0], command)
    return 70


if __name__ == "__main__":
    sys.exit(main())
