"""Credential-free live contract test for Graphify 0.9.18 and the adapter."""

from __future__ import annotations

import asyncio

from app.integrations.graphify.mcp_client import (
    GraphifyMCPConfig,
    MCPGraphKnowledgeClient,
)


async def main() -> None:
    client = MCPGraphKnowledgeClient(
        GraphifyMCPConfig(
            url="http://127.0.0.1:18001/mcp",
            project_id="contract-fixture",
            project_path="/knowledge/contract-fixture",
            tool_names={
                "search": "query_graph",
                "get_node": "get_node",
                "get_neighbors": "get_neighbors",
                "shortest_path": "shortest_path",
            },
            runtime_mode="real",
            graph_version="contract-fixture-v1",
            max_tool_calls=8,
        )
    )
    await client.check_compatibility()
    result = await client.search("¿Qué establece la Ley 100 de 1993?")
    unaccented = await client.search("Que establece la Ley 100 de 1993?")
    uppercase = await client.search("QUE ESTABLECE LA LEY 100 DE 1993?")
    labels = {node.label: node.id for node in result.nodes}
    assert {node.label for node in unaccented.nodes} == set(labels)
    assert {node.label for node in uppercase.nodes} == set(labels)
    law_id = labels["Ley 100 de 1993"]
    pensions_id = labels["Sistema General de Pensiones"]
    assert law_id.startswith("graphify:")
    assert result.graph_version == "contract-fixture-v1"

    node = await client.get_node(law_id)
    neighbors = await client.get_neighbors(law_id)
    path = await client.shortest_path(law_id, pensions_id)
    assert node.label == "Ley 100 de 1993"
    assert any(item.label == "Sistema General de Pensiones" for item in neighbors.nodes)
    assert path.node_ids == [law_id, pensions_id]


if __name__ == "__main__":
    asyncio.run(main())
