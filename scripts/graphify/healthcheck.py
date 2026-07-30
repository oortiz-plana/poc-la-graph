"""Verify that the Graphify Streamable HTTP MCP endpoint is usable."""

from __future__ import annotations

import asyncio
import os

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

REQUIRED_TOOLS = {
    "query_graph",
    "get_node",
    "get_neighbors",
    "shortest_path",
}


async def check() -> None:
    url = os.getenv("GRAPHIFY_HEALTHCHECK_URL", "http://127.0.0.1:8001/mcp")
    async with asyncio.timeout(5):
        async with streamablehttp_client(url) as streams:
            async with ClientSession(streams[0], streams[1]) as session:
                await session.initialize()
                tools = await session.list_tools()
    available = {tool.name for tool in tools.tools}
    missing = REQUIRED_TOOLS - available
    if missing:
        raise RuntimeError("required_graphify_tools_unavailable")


if __name__ == "__main__":
    asyncio.run(check())
