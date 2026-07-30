from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.integrations.graphify.errors import (
    GraphifyConfigurationError,
    GraphifyError,
)
from app.integrations.graphify.mcp_client import (
    GraphifyMCPConfig,
    MCPGraphKnowledgeClient,
)

FIXTURES = Path(__file__).parent / "fixtures"


def real_config(graph_version: str | None = None) -> GraphifyMCPConfig:
    return GraphifyMCPConfig(
        url="http://graphify:8001/mcp",
        project_id="laws",
        project_path="/knowledge/laws",
        runtime_mode="real",
        graph_version=graph_version,
        tool_names={
            "search": "query_graph",
            "get_node": "get_node",
            "get_neighbors": "get_neighbors",
            "shortest_path": "shortest_path",
        },
    )


def captured(name: str) -> dict[str, str]:
    return {"_text": (FIXTURES / name).read_text(encoding="utf-8")}


def captured_tools() -> list[SimpleNamespace]:
    document = json.loads(
        (FIXTURES / "tool-schemas-0.9.18.json").read_text(encoding="utf-8")
    )
    tools = []
    for name, specification in document["tools"].items():
        properties: dict[str, dict[str, Any]] = {}
        for key, kind in specification["properties"].items():
            if kind == "bfs|dfs":
                properties[key] = {"type": "string", "enum": ["bfs", "dfs"]}
            elif kind == "string[]":
                properties[key] = {"type": "array", "items": {"type": "string"}}
            else:
                properties[key] = {"type": kind}
        tools.append(
            SimpleNamespace(
                name=name,
                inputSchema={
                    "type": "object",
                    "properties": properties,
                    "required": specification["required"],
                },
            )
        )
    return tools


def test_captured_0918_schemas_are_compatible() -> None:
    client = MCPGraphKnowledgeClient(real_config())
    client._validate_tool_schemas(captured_tools())


@pytest.mark.parametrize(
    ("tool_name", "schema"),
    [
        ("query_graph", None),
        ("get_node", {"type": "object", "properties": [], "required": ["label"]}),
        (
            "shortest_path",
            {
                "type": "object",
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "integer"},
                    "max_hops": {"type": "integer"},
                },
                "required": ["source", "target"],
            },
        ),
    ],
)
def test_malformed_or_incompatible_schema_fails_clearly(
    tool_name: str, schema: object
) -> None:
    tools = captured_tools()
    target = next(tool for tool in tools if tool.name == tool_name)
    target.inputSchema = schema
    with pytest.raises(GraphifyConfigurationError, match=tool_name):
        MCPGraphKnowledgeClient(real_config())._validate_tool_schemas(tools)


async def test_compatibility_check_lists_without_calling_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = MCPGraphKnowledgeClient(real_config())

    async def list_tools() -> list[SimpleNamespace]:
        return captured_tools()

    monkeypatch.setattr(client, "_list_official_tools", list_tools)
    await client.check_compatibility()
    assert client._verified_tools == {
        "query_graph",
        "get_node",
        "get_neighbors",
        "shortest_path",
    }
    assert client._calls == 0


async def test_all_native_tools_accept_ids_from_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = MCPGraphKnowledgeClient(real_config())
    calls: list[tuple[str, dict[str, Any]]] = []

    async def call(operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
        calls.append((operation, arguments))
        return {
            "search": captured("query-graph-spanish.txt"),
            "get_node": captured("get-node.txt"),
            "get_neighbors": captured("get-neighbors.txt"),
            "shortest_path": captured("shortest-path.txt"),
        }[operation]

    monkeypatch.setattr(client, "_call_official_sdk", call)
    search = await client.search("¿Qué establece la Ley 100 sobre pensiones?")
    law = next(node for node in search.nodes if node.label == "Ley 100 de 1993")
    pensions = next(
        node for node in search.nodes if node.label == "Sistema General de Pensiones"
    )

    node = await client.get_node(law.id)
    neighbors = await client.get_neighbors(law.id)
    path = await client.shortest_path(law.id, pensions.id)

    assert node.id == law.id
    assert neighbors.nodes[0].id == law.id
    assert path.node_ids == [law.id, pensions.id]
    assert calls[1][1] == {"label": "Ley 100 de 1993"}
    assert calls[2][1] == {"label": "Ley 100 de 1993"}
    assert calls[3][1] == {
        "source": "Ley 100 de 1993",
        "target": "Sistema General de Pensiones",
        "max_hops": 2,
    }


async def test_unknown_hashed_id_fails_before_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = MCPGraphKnowledgeClient(real_config())
    invoked = False

    async def call(operation: str, arguments: dict[str, Any]) -> dict[str, Any]:
        nonlocal invoked
        invoked = True
        return {}

    monkeypatch.setattr(client, "_call_official_sdk", call)
    with pytest.raises(GraphifyError, match="search must resolve it first"):
        await client.get_neighbors("graphify:000000000000000000000000")
    assert not invoked


def test_native_result_limits_are_enforced() -> None:
    client = MCPGraphKnowledgeClient(real_config())
    oversized = SimpleNamespace(text="x" * (client.config.max_evidence_bytes + 1))
    with pytest.raises(GraphifyError) as caught:
        client._decode_content([oversized])
    assert caught.value.category == "limit_exceeded"


def test_trusted_published_graph_version_is_attached_to_real_search() -> None:
    client = MCPGraphKnowledgeClient(real_config("laws-2026-07-29.sha256"))
    result = client._normalize_real_search(captured("query-graph-spanish.txt"))
    assert result.graph_version == "laws-2026-07-29.sha256"
    assert result.edges[0].properties["context"] == "Reforma pensional"


def test_native_truncation_marker_is_propagated() -> None:
    client = MCPGraphKnowledgeClient(real_config())
    text = captured("query-graph-spanish.txt")["_text"]
    result = client._normalize_real_search(
        {"_text": text + "\n... (truncated — 3 more nodes cut by ~256-token budget."}
    )
    assert result.truncated is True
    assert result.warnings == ["Graphify truncated evidence to its token budget."]
