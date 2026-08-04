"""Synthetic Graphify-like MCP server for local troubleshooting only.

This process deliberately speaks MCP using the official SDK. It is not Graphify
and must not be used to validate Graphify-specific behavior.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP

KNOWLEDGE_ROOT = Path(os.getenv("GRAPHIFY_KNOWLEDGE_ROOT", "/knowledge")).resolve()

if os.getenv("GRAPHIFY_RUNTIME") != "mock":
    raise RuntimeError("Synthetic server requires explicit GRAPHIFY_RUNTIME=mock")

mcp = FastMCP("Synthetic Graphify troubleshooting server", host="0.0.0.0", port=8001)


def _graph(
    project_path: str | None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[dict[str, Any]]]:
    if not project_path:
        raise ValueError("project_path is required")
    project = Path(project_path).resolve()
    if project == KNOWLEDGE_ROOT or KNOWLEDGE_ROOT not in project.parents:
        raise ValueError("Project path is outside the knowledge root")
    with (project / "graphify-out" / "graph.json").open(encoding="utf-8") as stream:
        graph: dict[str, Any] = json.load(stream)
    return graph, {node["id"]: node for node in graph["nodes"]}, graph["edges"]


def _citation(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"citation-{node['id']}",
        "title": node["label"],
        "source": node["source"],
        "nodeId": node["id"],
        "relationship": None,
        "provenance": node["provenance"],
        "excerpt": node["excerpt"],
    }


@mcp.tool()
def search(query: str, project_id: str, project_path: str) -> dict[str, Any]:
    """Search the configured synthetic graph for matching nodes."""
    del project_id
    graph, nodes, edges_data = _graph(project_path)
    terms = {term.lower() for term in query.split() if len(term) > 2}
    matches = [
        node
        for node in nodes.values()
        if terms
        & set(
            f"{node['label']} {node['excerpt']} "
            f"{json.dumps(node.get('properties', {}))}".lower().split()
        )
    ]
    node_ids = {node["id"] for node in matches}
    edges = [
        edge
        for edge in edges_data
        if edge["sourceNodeId"] in node_ids or edge["targetNodeId"] in node_ids
    ]
    return {
        "graphVersion": graph["graphVersion"],
        "nodes": matches,
        "edges": edges,
        "paths": [],
        "citations": [_citation(node) for node in matches],
        "warnings": ["Synthetic troubleshooting data; not a real Graphify result."],
    }


@mcp.tool()
def get_node(node_id: str, project_id: str, project_path: str) -> dict[str, Any]:
    """Return one node from the configured synthetic graph."""
    del project_id
    _, nodes, _ = _graph(project_path)
    if node_id not in nodes:
        raise ValueError("Node not found")
    return nodes[node_id]


@mcp.tool()
def get_neighbors(
    node_id: str,
    project_id: str,
    project_path: str,
    depth: int = 1,
) -> dict[str, Any]:
    """Return a bounded neighborhood (depth 1 or 2)."""
    del project_id
    _, nodes, edges_data = _graph(project_path)
    if node_id not in nodes:
        raise ValueError("Node not found")
    if depth not in (1, 2):
        raise ValueError("Depth must be 1 or 2")
    seen = {node_id}
    frontier = {node_id}
    selected_edges: list[dict[str, Any]] = []
    for _ in range(depth):
        next_frontier: set[str] = set()
        for edge in edges_data:
            if edge["sourceNodeId"] in frontier or edge["targetNodeId"] in frontier:
                if edge not in selected_edges:
                    selected_edges.append(edge)
                next_frontier.update((edge["sourceNodeId"], edge["targetNodeId"]))
        next_frontier -= seen
        seen |= next_frontier
        frontier = next_frontier
    return {
        "nodes": [nodes[item] for item in seen],
        "edges": selected_edges,
        "paths": [],
    }


@mcp.tool()
def shortest_path(
    source_node_id: str,
    target_node_id: str,
    project_id: str,
    project_path: str,
) -> dict[str, Any]:
    """Return a shortest unweighted path in the tiny synthetic graph."""
    del project_id
    _, nodes, edges_data = _graph(project_path)
    if source_node_id not in nodes or target_node_id not in nodes:
        raise ValueError("Node not found")
    queue: list[tuple[str, list[str], list[str]]] = [(source_node_id, [], [])]
    visited = {source_node_id}
    while queue:
        current, node_path, edge_path = queue.pop(0)
        next_nodes = node_path + [current]
        if current == target_node_id:
            return {"nodeIds": next_nodes, "edgeIds": edge_path}
        for edge in edges_data:
            neighbor = None
            if edge["sourceNodeId"] == current:
                neighbor = edge["targetNodeId"]
            elif edge["targetNodeId"] == current:
                neighbor = edge["sourceNodeId"]
            if neighbor is not None and neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, next_nodes, edge_path + [edge["id"]]))
    return {"nodeIds": [], "edgeIds": []}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
