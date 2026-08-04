"""Run the verified Graphify 0.9.18 Streamable HTTP MCP entry point."""

from __future__ import annotations

import os
import sys


def main() -> int:
    if os.getenv("GRAPHIFY_RUNTIME_MODE", "real") != "real":
        print("graphify_runtime_error=real_mode_required", flush=True)
        return 78
    command = [
        "graphify-mcp",
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
