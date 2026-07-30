"""Graphify adapter backed by the official MCP Python SDK."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Mapping
from contextlib import AsyncExitStack
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ValidationError

from .errors import GraphifyConfigurationError, GraphifyError
from .models import GraphNode, GraphPath, GraphSearchResult, GraphSubgraph

Operation = Literal["search", "get_node", "get_neighbors", "shortest_path"]
ModelT = TypeVar("ModelT", bound=BaseModel)
ALLOWED_OPERATIONS: frozenset[str] = frozenset(
    {"search", "get_node", "get_neighbors", "shortest_path"}
)


@dataclass(frozen=True)
class GraphifyMCPConfig:
    url: str
    project_id: str
    project_path: str
    knowledge_root: str = "/knowledge"
    timeout_seconds: float = 20.0
    tool_names: Mapping[Operation, str] = field(
        default_factory=lambda: {
            "search": "search",
            "get_node": "get_node",
            "get_neighbors": "get_neighbors",
            "shortest_path": "shortest_path",
        }
    )
    max_tool_calls: int = 4
    max_depth: int = 2
    max_nodes: int = 100
    max_edges: int = 200
    max_evidence_bytes: int = 65_536
    max_query_length: int = 2_000
    max_node_id_length: int = 512
    runtime_mode: Literal["real", "synthetic"] = "real"
    graph_version: str | None = None

    def __post_init__(self) -> None:
        if not self.url.startswith(("http://", "https://")):
            raise GraphifyConfigurationError("Graphify MCP URL must use HTTP(S)")
        if not self.project_id.strip():
            raise GraphifyConfigurationError("Graphify project ID is required")
        if set(self.tool_names) != ALLOWED_OPERATIONS:
            raise GraphifyConfigurationError(
                "Exactly four allowlisted tool mappings are required"
            )
        if len(set(self.tool_names.values())) != 4 or any(
            not name.strip() for name in self.tool_names.values()
        ):
            raise GraphifyConfigurationError(
                "MCP tool names must be unique and non-empty"
            )
        root = Path(self.knowledge_root).resolve()
        project = Path(self.project_path).resolve()
        if project != root and root not in project.parents:
            raise GraphifyConfigurationError(
                "Graphify project path must be beneath the knowledge root"
            )
        if self.timeout_seconds <= 0 or self.max_tool_calls < 1:
            raise GraphifyConfigurationError("Timeout and limits must be positive")


class MCPGraphKnowledgeClient:
    """A bounded adapter. Create one instance for each agent request."""

    def __init__(self, config: GraphifyMCPConfig) -> None:
        self.config = config
        self._calls = 0
        self._verified_tools: frozenset[str] | None = None
        # Public node IDs are stable hashes so native labels never become an
        # implicit transport contract. Keep the reverse mapping request-local.
        self._native_labels: dict[str, str] = {}

    async def check_compatibility(self) -> None:
        """Initialize MCP and validate allowlisted tool schemas without tool calls."""
        try:
            async with asyncio.timeout(self.config.timeout_seconds):
                tools = await self._list_official_tools()
                available = frozenset(tool.name for tool in tools)
                configured = frozenset(self.config.tool_names.values())
                if not configured.issubset(available):
                    raise GraphifyConfigurationError(
                        "Graphify MCP server is missing configured allowlisted tools"
                    )
                self._validate_tool_schemas(tools)
                self._verified_tools = available
        except TimeoutError as exc:
            raise GraphifyError(
                "timeout", "Graphify MCP compatibility check timed out"
            ) from exc
        except (GraphifyError, GraphifyConfigurationError):
            raise
        except (ImportError, OSError, ConnectionError) as exc:
            raise GraphifyError("unavailable", "Graphify MCP is unavailable") from exc
        except Exception as exc:
            raise GraphifyError(
                "unavailable", "Graphify MCP compatibility check failed"
            ) from exc

    async def search(self, query: str) -> GraphSearchResult:
        query = self._bounded_text(query, "query", self.config.max_query_length)
        if self.config.runtime_mode == "real":
            payload = await self._invoke(
                "search",
                {
                    "question": query,
                    "mode": "bfs",
                    "depth": self.config.max_depth,
                    "token_budget": max(256, self.config.max_evidence_bytes // 3),
                    **self._project_arguments(),
                },
            )
            return self._normalize_real_search(payload)
        payload = await self._invoke(
            "search", {"query": query, **self._project_arguments()}
        )
        return self._normalize_search(payload)

    async def get_node(self, node_id: str) -> GraphNode:
        node_id = self._bounded_text(node_id, "node ID", self.config.max_node_id_length)
        native_label = self._native_label(node_id)
        key = "label" if self.config.runtime_mode == "real" else "node_id"
        payload = await self._invoke(
            "get_node", {key: native_label, **self._project_arguments()}
        )
        if self.config.runtime_mode == "real":
            return self._normalize_real_node(payload)
        raw = payload.get("node", payload)
        return self._parse(GraphNode, raw, "node")

    async def get_neighbors(self, node_id: str, depth: int = 1) -> GraphSubgraph:
        node_id = self._bounded_text(node_id, "node ID", self.config.max_node_id_length)
        native_label = self._native_label(node_id)
        if depth < 1 or depth > self.config.max_depth:
            raise GraphifyError(
                "limit_exceeded", "Traversal depth is outside configured limits"
            )
        arguments: dict[str, Any]
        if self.config.runtime_mode == "real":
            arguments = {"label": native_label, **self._project_arguments()}
        else:
            arguments = {
                "node_id": node_id,
                "depth": depth,
                **self._project_arguments(),
            }
        payload = await self._invoke("get_neighbors", arguments)
        if self.config.runtime_mode == "real":
            return self._normalize_real_neighbors(native_label, payload)
        return self._normalize_subgraph(payload)

    async def shortest_path(
        self, source_node_id: str, target_node_id: str
    ) -> GraphPath:
        source = self._bounded_text(
            source_node_id, "source node ID", self.config.max_node_id_length
        )
        target = self._bounded_text(
            target_node_id, "target node ID", self.config.max_node_id_length
        )
        native_source = self._native_label(source)
        native_target = self._native_label(target)
        payload = await self._invoke(
            "shortest_path",
            (
                {
                    "source": native_source,
                    "target": native_target,
                    "max_hops": self.config.max_depth,
                }
                if self.config.runtime_mode == "real"
                else {"source_node_id": source, "target_node_id": target}
            )
            | self._project_arguments(),
        )
        if self.config.runtime_mode == "real":
            return self._normalize_real_path(payload)
        raw = payload.get("path", payload)
        return self._parse(GraphPath, raw, "path")

    def _project_arguments(self) -> dict[str, str]:
        # These values can only originate in trusted process configuration.
        if self.config.runtime_mode == "real":
            # The real runtime is started with one immutable active graph. Omitting
            # project_path prevents callers from switching corpus paths.
            return {}
        return {
            "project_id": self.config.project_id,
            "project_path": self.config.project_path,
        }

    async def _invoke(
        self, operation: Operation, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        if operation not in ALLOWED_OPERATIONS:
            raise GraphifyError("configuration", "Operation is not allowlisted")
        self._calls += 1
        if self._calls > self.config.max_tool_calls:
            raise GraphifyError("limit_exceeded", "Graphify tool-call limit exceeded")
        try:
            async with asyncio.timeout(self.config.timeout_seconds):
                return await self._call_official_sdk(operation, arguments)
        except TimeoutError as exc:
            raise GraphifyError("timeout", "Graphify MCP request timed out") from exc
        except GraphifyError:
            raise
        except (ImportError, OSError, ConnectionError) as exc:
            raise GraphifyError("unavailable", "Graphify MCP is unavailable") from exc
        except Exception as exc:
            # Native/provider messages can contain endpoints or retrieved content.
            raise GraphifyError("unavailable", "Graphify MCP request failed") from exc

    async def _call_official_sdk(
        self, operation: Operation, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError as exc:
            raise GraphifyConfigurationError(
                "The official MCP Python SDK is not installed"
            ) from exc

        async with AsyncExitStack() as stack:
            streams = await stack.enter_async_context(
                streamablehttp_client(self.config.url)
            )
            read_stream, write_stream = streams[0], streams[1]
            session = await stack.enter_async_context(
                ClientSession(read_stream, write_stream)
            )
            await session.initialize()
            tools_result = await session.list_tools()
            available = frozenset(tool.name for tool in tools_result.tools)
            configured = frozenset(self.config.tool_names.values())
            if not configured.issubset(available):
                raise GraphifyConfigurationError(
                    "Graphify MCP server is missing configured allowlisted tools"
                )
            self._validate_tool_schemas(tools_result.tools)
            self._verified_tools = available
            result = await session.call_tool(
                self.config.tool_names[operation], arguments=arguments
            )
        if getattr(result, "isError", False) or getattr(result, "is_error", False):
            raise GraphifyError(
                "invalid_response", "Graphify MCP tool returned an error"
            )
        return self._decode_content(getattr(result, "content", None))

    async def _list_official_tools(self) -> list[Any]:
        try:
            from mcp import ClientSession
            from mcp.client.streamable_http import streamablehttp_client
        except ImportError as exc:
            raise GraphifyConfigurationError(
                "The official MCP Python SDK is not installed"
            ) from exc
        async with AsyncExitStack() as stack:
            streams = await stack.enter_async_context(
                streamablehttp_client(self.config.url)
            )
            session = await stack.enter_async_context(
                ClientSession(streams[0], streams[1])
            )
            await session.initialize()
            result = await session.list_tools()
            return list(result.tools)

    def _decode_content(self, content: Any) -> dict[str, Any]:
        texts: list[str] = []
        if not isinstance(content, list):
            raise GraphifyError("invalid_response", "MCP response content is malformed")
        for block in content:
            text = getattr(block, "text", None)
            if isinstance(text, str):
                texts.append(text)
            else:
                raise GraphifyError(
                    "invalid_response", "MCP response contains unsupported content"
                )
        encoded = "".join(texts).encode()
        if len(encoded) > self.config.max_evidence_bytes:
            raise GraphifyError("limit_exceeded", "Graphify response is too large")
        try:
            decoded = json.loads(encoded)
        except (UnicodeDecodeError, json.JSONDecodeError):
            if self.config.runtime_mode == "real":
                return {"_text": encoded.decode("utf-8")}
            raise GraphifyError(
                "invalid_response", "MCP response is not valid JSON"
            ) from None
        if not isinstance(decoded, dict):
            raise GraphifyError(
                "invalid_response", "MCP response must be a JSON object"
            )
        nested = decoded.get("result", decoded.get("data", decoded))
        if not isinstance(nested, dict):
            raise GraphifyError("invalid_response", "MCP result must be a JSON object")
        return nested

    @staticmethod
    def _node_id(label: str) -> str:
        return "graphify:" + hashlib.sha256(label.encode("utf-8")).hexdigest()[:24]

    def _register_native_label(self, label: str) -> str:
        clean = label.strip()
        identifier = self._node_id(clean)
        existing = self._native_labels.get(identifier)
        if existing is not None and existing != clean:
            raise GraphifyError(
                "invalid_response", "Graphify node identifier collision detected"
            )
        self._native_labels[identifier] = clean
        return identifier

    def _native_label(self, value: str) -> str:
        if self.config.runtime_mode != "real":
            return value
        if not value.startswith("graphify:"):
            return value
        label = self._native_labels.get(value)
        if label is None:
            raise GraphifyError(
                "invalid_response",
                "Graphify node ID is unknown in this request; "
                "search must resolve it first",
            )
        return label

    def _validate_tool_schemas(self, tools: list[Any]) -> None:
        """Fail closed when native tool names exist with incompatible inputs."""
        by_name = {getattr(tool, "name", None): tool for tool in tools}
        if self.config.runtime_mode == "real":
            expected: dict[Operation, dict[str, str]] = {
                "search": {"question": "string", "depth": "integer"},
                "get_node": {"label": "string"},
                "get_neighbors": {"label": "string"},
                "shortest_path": {
                    "source": "string",
                    "target": "string",
                    "max_hops": "integer",
                },
            }
        else:
            expected = {
                "search": {"query": "string"},
                "get_node": {"node_id": "string"},
                "get_neighbors": {"node_id": "string", "depth": "integer"},
                "shortest_path": {
                    "source_node_id": "string",
                    "target_node_id": "string",
                },
            }
        for operation, properties in expected.items():
            name = self.config.tool_names[operation]
            tool = by_name.get(name)
            schema = getattr(tool, "inputSchema", None)
            if schema is None:
                schema = getattr(tool, "input_schema", None)
            if not isinstance(schema, Mapping):
                raise GraphifyConfigurationError(
                    f"Graphify MCP tool {name!r} has a malformed input schema"
                )
            raw_properties = schema.get("properties")
            required = schema.get("required", [])
            if not isinstance(raw_properties, Mapping) or not isinstance(
                required, list
            ):
                raise GraphifyConfigurationError(
                    f"Graphify MCP tool {name!r} has a malformed input schema"
                )
            for property_name, property_type in properties.items():
                raw_property = raw_properties.get(property_name)
                if (
                    not isinstance(raw_property, Mapping)
                    or raw_property.get("type") != property_type
                ):
                    raise GraphifyConfigurationError(
                        f"Graphify MCP tool {name!r} has an incompatible "
                        f"{property_name!r} input"
                    )
            required_names = {
                "search": (
                    {"question"} if self.config.runtime_mode == "real" else {"query"}
                ),
                "get_node": (
                    {"label"} if self.config.runtime_mode == "real" else {"node_id"}
                ),
                "get_neighbors": (
                    {"label"} if self.config.runtime_mode == "real" else {"node_id"}
                ),
                "shortest_path": (
                    {"source", "target"}
                    if self.config.runtime_mode == "real"
                    else {"source_node_id", "target_node_id"}
                ),
            }[operation]
            if not required_names.issubset(set(required)):
                raise GraphifyConfigurationError(
                    f"Graphify MCP tool {name!r} does not require its identity inputs"
                )

    def _real_text(self, payload: dict[str, Any]) -> str:
        text = payload.get("_text")
        if not isinstance(text, str) or not text.strip():
            raise GraphifyError("invalid_response", "Graphify text result is empty")
        return text

    def _normalize_real_search(self, payload: dict[str, Any]) -> GraphSearchResult:
        text = self._real_text(payload)
        if text.strip() == "No matching nodes found.":
            return GraphSearchResult()
        nodes: dict[str, dict[str, Any]] = {}
        edges: list[dict[str, Any]] = []
        node_pattern = re.compile(
            r"^NODE (?P<label>.+?) \[src=(?P<src>.*?) loc=(?P<loc>.*?) "
            r"community=(?P<community>.*?)\]$"
        )
        edge_pattern = re.compile(
            r"^EDGE (?P<src>.+?) --(?P<rel>.*?) "
            r"\[(?P<confidence>[^\] ]+)"
            r"(?: context=(?P<context>.*?))?\]--> (?P<dst>.+)$"
        )
        for line in text.splitlines():
            node_match = node_pattern.match(line)
            if node_match:
                values = node_match.groupdict()
                identifier = self._register_native_label(values["label"])
                nodes[values["label"]] = {
                    "id": identifier,
                    "label": values["label"],
                    "type": "graphify_node",
                    "properties": {
                        "location": values["loc"],
                        "community": values["community"],
                    },
                    "source": values["src"] or "Graphify knowledge graph",
                    "excerpt": None,
                    "provenance": "extracted",
                }
                continue
            edge_match = edge_pattern.match(line)
            if edge_match:
                values = edge_match.groupdict()
                for label in (values["src"], values["dst"]):
                    nodes.setdefault(
                        label,
                        {
                            "id": self._register_native_label(label),
                            "label": label,
                            "type": "graphify_node",
                            "properties": {},
                            "source": "Graphify knowledge graph",
                            "provenance": "unknown",
                        },
                    )
                edge_key = f"{values['src']}\0{values['rel']}\0{values['dst']}"
                edges.append(
                    {
                        "id": "edge:"
                        + hashlib.sha256(edge_key.encode()).hexdigest()[:24],
                        "sourceNodeId": nodes[values["src"]]["id"],
                        "targetNodeId": nodes[values["dst"]]["id"],
                        "relationship": values["rel"] or "related_to",
                        "properties": {
                            "confidence": values["confidence"],
                            **(
                                {"context": values["context"]}
                                if values["context"]
                                else {}
                            ),
                        },
                        "provenance": (
                            "inferred"
                            if values["confidence"].upper() == "INFERRED"
                            else "extracted"
                        ),
                    }
                )
        if not nodes:
            raise GraphifyError(
                "invalid_response", "Graphify query response had no parseable nodes"
            )
        raw_nodes = list(nodes.values())
        self._validate_graph_limits(raw_nodes, edges)
        citations = [
            {
                "id": f"node:{node['id']}",
                "title": node["label"],
                "source": node["source"],
                "nodeId": node["id"],
                "provenance": node["provenance"],
            }
            for node in raw_nodes
        ]
        return self._parse(
            GraphSearchResult,
            {
                "nodes": raw_nodes,
                "edges": edges,
                "citations": citations,
                "graphVersion": self.config.graph_version,
                "truncated": "... (truncated —" in text,
                "warnings": (
                    ["Graphify truncated evidence to its token budget."]
                    if "... (truncated —" in text
                    else []
                ),
            },
            "search result",
        )

    def _normalize_real_node(self, payload: dict[str, Any]) -> GraphNode:
        text = self._real_text(payload)
        lines = dict(
            line.strip().split(": ", 1)
            for line in text.splitlines()[1:]
            if ": " in line
        )
        label = text.splitlines()[0].removeprefix("Node: ").strip()
        if not label or text.startswith("No node matching"):
            raise GraphifyError("invalid_response", "Graphify node was not found")
        identifier = self._register_native_label(label)
        return GraphNode(
            id=identifier,
            label=label,
            type=lines.get("Type") or "graphify_node",
            source=lines.get("Source") or "Graphify knowledge graph",
            properties={"community": lines.get("Community")},
            provenance="extracted",
        )

    def _normalize_real_neighbors(
        self, requested: str, payload: dict[str, Any]
    ) -> GraphSubgraph:
        text = self._real_text(payload)
        if text.startswith("No node matching"):
            return GraphSubgraph()
        header = text.splitlines()[0]
        center = header.removeprefix("Neighbors of ").removesuffix(":")
        nodes: dict[str, GraphNode] = {
            center: GraphNode(
                id=self._register_native_label(center),
                label=center,
                type="graphify_node",
                source="Graphify knowledge graph",
            )
        }
        edges: list[dict[str, Any]] = []
        pattern = re.compile(
            r"^\s+(?P<direction>-->|<--)\s+(?P<label>.+?) "
            r"\[(?P<rel>.*?)\] \[(?P<confidence>.*?)\]$"
        )
        for line in text.splitlines()[1:]:
            match = pattern.match(line)
            if not match:
                continue
            values = match.groupdict()
            label = values["label"]
            nodes[label] = GraphNode(
                id=self._register_native_label(label),
                label=label,
                type="graphify_node",
                source="Graphify knowledge graph",
            )
            source, target = (
                (center, label) if values["direction"] == "-->" else (label, center)
            )
            edges.append(
                {
                    "id": self._node_id(f"{source}:{values['rel']}:{target}"),
                    "sourceNodeId": nodes[source].id,
                    "targetNodeId": nodes[target].id,
                    "relationship": values["rel"] or "related_to",
                    "properties": {"confidence": values["confidence"]},
                }
            )
        self._validate_graph_limits(list(nodes.values()), edges)
        return self._parse(
            GraphSubgraph,
            {"nodes": list(nodes.values()), "edges": edges},
            "neighbors",
        )

    def _normalize_real_path(self, payload: dict[str, Any]) -> GraphPath:
        text = self._real_text(payload)
        if not text.startswith("Shortest path"):
            raise GraphifyError("invalid_response", "Graphify path was not found")
        labels = [
            item.strip()
            for item in re.split(
                r"\s+(?:--.*?-->|<--.*?--)\s+",
                text.splitlines()[-1].strip(),
            )
            if item.strip()
        ]
        if not labels:
            raise GraphifyError(
                "invalid_response", "Graphify path response had no parseable nodes"
            )
        return GraphPath(
            id=self._node_id(text),
            nodeIds=[self._register_native_label(label) for label in labels],
            edgeIds=[],
        )

    def _normalize_search(self, payload: dict[str, Any]) -> GraphSearchResult:
        subgraph = self._normalize_subgraph(payload)
        raw = {
            **subgraph.model_dump(),
            "citations": payload.get("citations", []),
            "graphVersion": payload.get("graphVersion", payload.get("graph_version")),
        }
        return self._parse(GraphSearchResult, raw, "search result")

    def _normalize_subgraph(self, payload: dict[str, Any]) -> GraphSubgraph:
        graph = payload.get("graphEvidence", payload.get("graph", payload))
        if not isinstance(graph, dict):
            raise GraphifyError("invalid_response", "Graph evidence must be an object")
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise GraphifyError(
                "invalid_response", "Graph nodes and edges must be arrays"
            )
        self._validate_graph_limits(nodes, edges)
        raw = {
            "nodes": nodes,
            "edges": edges,
            "paths": graph.get("paths", []),
            "warnings": payload.get("warnings", graph.get("warnings", [])),
            "truncated": bool(payload.get("truncated", graph.get("truncated", False))),
        }
        return self._parse(GraphSubgraph, raw, "subgraph")

    def _validate_graph_limits(self, nodes: list[Any], edges: list[Any]) -> None:
        if len(nodes) > self.config.max_nodes or len(edges) > self.config.max_edges:
            raise GraphifyError(
                "limit_exceeded", "Graph evidence exceeds configured limits"
            )

    @staticmethod
    def _parse(model: type[ModelT], raw: Any, label: str) -> ModelT:
        try:
            return model.model_validate(raw)
        except (ValidationError, TypeError) as exc:
            raise GraphifyError(
                "invalid_response", f"Graphify returned an invalid {label}"
            ) from exc

    @staticmethod
    def _bounded_text(value: str, label: str, maximum: int) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GraphifyError("invalid_response", f"{label} must not be empty")
        if len(value) > maximum:
            raise GraphifyError("limit_exceeded", f"{label} is too long")
        return value.strip()
