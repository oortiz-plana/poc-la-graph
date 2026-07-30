"""Provider-independent types used by the knowledge workflow."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field

Provenance = Literal["explicit", "extracted", "inferred", "unknown"]
Confidence = Literal["high", "medium", "low", "insufficient"]
ResponseLanguage = Literal["en", "es"]
ResponseType = Literal["answer", "clarification", "insufficient"]
FollowUpKind = Literal["standalone", "resolved_follow_up", "clarification"]


class ConversationTurn(BaseModel):
    """Sanitized conversational context; never a source of graph evidence."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(min_length=1, max_length=128)
    role: Literal["user", "assistant"]
    # Persistence may contain a long assistant answer. The workflow applies its
    # stricter aggregate character budget before any model call.
    content: str = Field(min_length=1, max_length=100_000)


class FollowUpResolution(BaseModel):
    """Provider-neutral result of resolving a question against prior turns."""

    model_config = ConfigDict(extra="forbid")

    kind: FollowUpKind
    standalone_query: str | None = Field(default=None, max_length=4000)
    clarification_question: str | None = Field(default=None, max_length=1000)
    referenced_turn_ids: list[str] = Field(default_factory=list, max_length=6)


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    title: str
    source: str
    node_id: str | None = Field(
        default=None, serialization_alias="nodeId", validation_alias="nodeId"
    )
    relationship: str | None = None
    provenance: Provenance = "unknown"
    excerpt: str | None = None
    document: str | None = None
    article: str | None = None
    paragraph: str | None = None
    start_line: int | None = Field(
        default=None, serialization_alias="startLine", validation_alias="startLine"
    )
    end_line: int | None = Field(
        default=None, serialization_alias="endLine", validation_alias="endLine"
    )


class GraphNode(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    label: str
    type: str = "entity"
    properties: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    source: str | None = None
    excerpt: str | None = None
    provenance: Provenance = "unknown"


class GraphEdge(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    source_node_id: str = Field(
        serialization_alias="sourceNodeId", validation_alias="sourceNodeId"
    )
    target_node_id: str = Field(
        serialization_alias="targetNodeId", validation_alias="targetNodeId"
    )
    relationship: str
    properties: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    provenance: Provenance = "unknown"


class GraphPath(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    node_ids: list[str] = Field(
        serialization_alias="nodeIds", validation_alias="nodeIds"
    )
    edge_ids: list[str] = Field(
        default_factory=list, serialization_alias="edgeIds", validation_alias="edgeIds"
    )


class GraphEvidence(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    paths: list[GraphPath] = Field(default_factory=list)


class Answer(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    request_id: str = Field(serialization_alias="requestId")
    conversation_id: str = Field(serialization_alias="conversationId")
    answer: str
    status: Literal["completed"] = "completed"
    response_type: ResponseType = Field(
        default="answer",
        serialization_alias="responseType",
        validation_alias="responseType",
    )
    confidence: Confidence
    graph_version: str | None = Field(default=None, serialization_alias="graphVersion")
    citations: list[Citation] = Field(default_factory=list)
    graph_evidence: GraphEvidence = Field(serialization_alias="graphEvidence")
    warnings: list[str] = Field(default_factory=list)


class WorkflowLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_tool_calls: int = Field(default=4, ge=1, le=16)
    max_traversal_depth: int = Field(default=2, ge=0, le=5)
    max_nodes: int = Field(default=100, ge=1, le=1000)
    max_edges: int = Field(default=200, ge=0, le=2000)
    max_evidence_bytes: int = Field(default=65_536, ge=1024)
    max_model_iterations: int = Field(default=1, ge=1, le=3)
    max_history_turns: int = Field(default=6, ge=0, le=20)
    max_history_characters: int = Field(default=8000, ge=0, le=32_000)
    request_timeout_seconds: float = Field(default=45.0, gt=0, le=300)


class WorkflowState(TypedDict, total=False):
    request_id: str
    conversation_id: str
    question: str
    conversation_history: list[ConversationTurn]
    response_language: ResponseLanguage
    follow_up_resolution: FollowUpResolution
    resolved_query: str
    response_type: ResponseType
    category: str
    original_query: str
    planned_query: str
    search_result: Any
    retrieval_scope: Any
    source_passages: list[Any]
    source_available: bool
    evidence: GraphEvidence
    evidence_citations: list[Citation]
    graph_version: str | None
    context: str
    draft_answer: str
    draft_confidence: Confidence
    draft_citation_ids: list[str]
    warnings: list[str]
    tool_calls: int
    model_iterations: int
    answer: Answer
