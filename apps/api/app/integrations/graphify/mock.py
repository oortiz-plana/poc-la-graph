"""Deterministic Graphify test double; never selected implicitly."""

from __future__ import annotations

import json
from pathlib import Path

from .errors import GraphifyError
from .models import GraphNode, GraphPath, GraphSearchResult, GraphSubgraph


class MockGraphKnowledgeClient:
    def __init__(self, result: GraphSearchResult) -> None:
        self.result = result.model_copy(deep=True)

    @classmethod
    def from_fixture(cls, path: str | Path) -> MockGraphKnowledgeClient:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(GraphSearchResult.model_validate(payload))

    async def check_compatibility(self) -> None:
        return None

    async def search(self, query: str) -> GraphSearchResult:
        del query
        return self.result.model_copy(deep=True)

    async def get_node(self, node_id: str) -> GraphNode:
        for node in self.result.nodes:
            if node.id == node_id:
                return node.model_copy(deep=True)
        raise GraphifyError("not_found", "Graph node was not found")

    async def get_neighbors(self, node_id: str, depth: int = 1) -> GraphSubgraph:
        if depth < 1:
            raise GraphifyError("limit_exceeded", "Depth must be positive")
        node_ids = {node_id}
        edges = []
        for _ in range(depth):
            for edge in self.result.edges:
                if edge.source_node_id in node_ids or edge.target_node_id in node_ids:
                    edges.append(edge)
                    node_ids.update((edge.source_node_id, edge.target_node_id))
        return GraphSubgraph(
            nodes=[node for node in self.result.nodes if node.id in node_ids],
            edges=list({edge.id: edge for edge in edges}.values()),
            paths=[],
        )

    async def shortest_path(
        self, source_node_id: str, target_node_id: str
    ) -> GraphPath:
        for path in self.result.paths:
            if (
                path.node_ids[0] == source_node_id
                and path.node_ids[-1] == target_node_id
            ):
                return path.model_copy(deep=True)
        raise GraphifyError("not_found", "Graph path was not found")
