"""Provider-neutral graph knowledge models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

type Scalar = str | int | float | bool | None
Provenance = Literal["explicit", "extracted", "inferred", "unknown"]


class GraphNode(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    type: str = Field(min_length=1)
    properties: dict[str, Scalar] = Field(default_factory=dict)
    source: str | None = None
    excerpt: str | None = None
    provenance: Provenance = "unknown"


class GraphEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    source_node_id: str = Field(alias="sourceNodeId", min_length=1)
    target_node_id: str = Field(alias="targetNodeId", min_length=1)
    relationship: str = Field(min_length=1)
    properties: dict[str, Scalar] = Field(default_factory=dict)
    provenance: Provenance = "unknown"


class GraphPath(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    node_ids: list[str] = Field(alias="nodeIds", min_length=1)
    edge_ids: list[str] = Field(default_factory=list, alias="edgeIds")


class GraphCitation(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    source: str = Field(min_length=1)
    node_id: str | None = Field(default=None, alias="nodeId")
    relationship: str | None = None
    provenance: Provenance = "unknown"
    excerpt: str | None = None


class GraphSubgraph(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    paths: list[GraphPath] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    truncated: bool = False


class GraphSearchResult(GraphSubgraph):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    citations: list[GraphCitation] = Field(default_factory=list)
    graph_version: str | None = Field(default=None, alias="graphVersion")
