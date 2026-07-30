"""Internal Graphify interface."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .models import GraphNode, GraphPath, GraphSearchResult, GraphSubgraph


@runtime_checkable
class GraphKnowledgeClient(Protocol):
    async def check_compatibility(self) -> None:
        """Validate transport and required tool schemas without querying a graph."""
        ...

    async def search(self, query: str) -> GraphSearchResult: ...

    async def get_node(self, node_id: str) -> GraphNode: ...

    async def get_neighbors(self, node_id: str, depth: int = 1) -> GraphSubgraph: ...

    async def shortest_path(
        self, source_node_id: str, target_node_id: str
    ) -> GraphPath: ...
