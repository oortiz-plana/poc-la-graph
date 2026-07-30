from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.integrations.graphify.errors import (
    GraphifyConfigurationError,
    GraphifyError,
)
from app.integrations.graphify.mcp_client import (
    GraphifyMCPConfig,
    MCPGraphKnowledgeClient,
)


@pytest.fixture
def config() -> GraphifyMCPConfig:
    return GraphifyMCPConfig(
        url="http://graphify:8001/mcp",
        project_id="sample-project",
        project_path="/knowledge/sample-project",
        runtime_mode="synthetic",
    )


def test_project_path_cannot_escape_trusted_root(config: GraphifyMCPConfig) -> None:
    with pytest.raises(GraphifyConfigurationError, match="beneath"):
        replace(config, project_path="/tmp/user-selected")


def test_decode_and_normalize_camel_case_graph(config: GraphifyMCPConfig) -> None:
    client = MCPGraphKnowledgeClient(config)
    payload = client._decode_content(
        [
            SimpleNamespace(
                text='{"result":{"graphEvidence":{"nodes":[{"id":"n1",'
                '"label":"One","type":"entity"}],"edges":[]},"graphVersion":"v7"}}'
            )
        ]
    )
    result = client._normalize_search(payload)
    assert result.graph_version == "v7"
    assert result.nodes[0].id == "n1"


@pytest.mark.parametrize(
    "content",
    [
        None,
        [SimpleNamespace(binary=b"x")],
        [SimpleNamespace(text="not-json")],
        [SimpleNamespace(text="[]")],
        [SimpleNamespace(text='{"result":[]}')],
    ],
)
def test_malformed_mcp_content_is_rejected(
    config: GraphifyMCPConfig, content: object
) -> None:
    client = MCPGraphKnowledgeClient(config)
    with pytest.raises(GraphifyError) as caught:
        client._decode_content(content)
    assert caught.value.category == "invalid_response"


def test_normalizer_rejects_malformed_nodes(config: GraphifyMCPConfig) -> None:
    client = MCPGraphKnowledgeClient(config)
    with pytest.raises(GraphifyError) as caught:
        client._normalize_search({"nodes": "not-an-array", "edges": []})
    assert caught.value.category == "invalid_response"


async def test_adapter_call_limit_applies_before_transport(
    config: GraphifyMCPConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = MCPGraphKnowledgeClient(replace(config, max_tool_calls=1))

    async def response(
        operation: str, arguments: dict[str, object]
    ) -> dict[str, object]:
        return {"nodes": [], "edges": []}

    monkeypatch.setattr(client, "_call_official_sdk", response)
    await client.search("first")
    with pytest.raises(GraphifyError) as caught:
        await client.search("second")
    assert caught.value.category == "limit_exceeded"


async def test_adapter_timeout_is_normalized(
    config: GraphifyMCPConfig, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = MCPGraphKnowledgeClient(replace(config, timeout_seconds=0.001))

    async def slow(operation: str, arguments: dict[str, object]) -> dict[str, object]:
        import asyncio

        await asyncio.sleep(0.05)
        return {}

    monkeypatch.setattr(client, "_call_official_sdk", slow)
    with pytest.raises(GraphifyError) as caught:
        await client.search("question")
    assert caught.value.category == "timeout"
    assert "http" not in str(caught.value).lower()
