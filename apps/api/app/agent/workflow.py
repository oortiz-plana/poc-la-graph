"""Bounded, grounded LangGraph workflow for Graphify question answering."""

from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from collections.abc import AsyncIterator, Mapping
from pathlib import PurePosixPath
from typing import Any, Protocol, cast
from uuid import uuid4

from langgraph.graph import END, START, StateGraph

from app.integrations.haystack import RetrievalScope, SourceRetriever
from app.integrations.llm.client import FollowUpRequest, LanguageModel, ModelRequest
from app.integrations.llm.errors import ModelResponseError
from app.integrations.llm.models import ChatMessage
from app.knowledge.source_index import SourcePassage
from app.prompts import (
    follow_up_system_prompt,
    follow_up_user_prompt,
    system_prompt,
    user_prompt,
)

from .events import LifecycleEvent
from .models import (
    Answer,
    Citation,
    ConversationTurn,
    FollowUpResolution,
    GraphEdge,
    GraphEvidence,
    GraphNode,
    GraphPath,
    ResponseLanguage,
    WorkflowLimits,
    WorkflowState,
)

INSUFFICIENT_ANSWER = (
    "The knowledge graph does not contain sufficient evidence to answer this question."
)
INSUFFICIENT_ANSWER_ES = (
    "El grafo de conocimiento no contiene evidencia suficiente para responder "
    "esta pregunta."
)
UNSUPPORTED_CITATIONS_WARNING = "The model returned unsupported citation identifiers."
UNSUPPORTED_CITATIONS_WARNING_ES = (
    "El modelo devolvió identificadores de citas sin respaldo."
)
SOURCE_PASSAGES_MISSING_WARNING = (
    "Graphify identified the requested article, but no matching source passage "
    "was available; article contents were not inferred from graph labels."
)
SOURCE_PASSAGES_MISSING_WARNING_ES = (
    "Graphify identificó el artículo solicitado, pero no se encontró un pasaje "
    "de la fuente; su contenido no se infirió a partir de etiquetas del grafo."
)
SOURCE_RETRIEVAL_UNAVAILABLE_WARNING = (
    "Source-text retrieval was unavailable; only graph evidence could be used."
)

_SPANISH_WORDS = frozenset(
    {
        "cual",
        "como",
        "cuando",
        "dice",
        "donde",
        "derechos",
        "establece",
        "explica",
        "ley",
        "los",
        "las",
        "para",
        "pension",
        "pensiones",
        "por",
        "que",
        "quien",
        "norma",
        "normas",
        "segun",
        "sobre",
        "una",
        "del",
    }
)
_ENGLISH_WORDS = frozenset(
    {"what", "which", "how", "does", "the", "about", "explain", "according"}
)
_LEGAL_IDENTIFIER = re.compile(
    r"\b(?:acto\s+legislativo|art[ií]culo|circular|decreto|ley|"
    r"resoluci[oó]n|sentencia)\s+(?:n[oº°]\.?\s*)?"
    r"[A-Z0-9][\w.-]*(?:\s+de\s+\d{4})?",
    re.IGNORECASE,
)
_ARTICLE_IDENTIFIER = re.compile(r"\bart[ií]culo\s+(\d+[A-Z]?)\b", re.IGNORECASE)


def detect_response_language(question: str) -> ResponseLanguage:
    """Detect Spanish conservatively without a heavyweight language model."""
    folded = _strip_diacritics(question).lower()
    words = set(re.findall(r"[a-z]+", folded))
    score = len(words & _SPANISH_WORDS)
    english_score = len(words & _ENGLISH_WORDS)
    spanish_marks = bool(re.search(r"[¿¡ñáéíóúü]", question.lower()))
    spanish_identifier = _LEGAL_IDENTIFIER.search(question) is not None
    is_spanish = (
        (score >= 2 and score > english_score)
        or (spanish_marks and score >= 1 and score >= english_score)
        or (spanish_identifier and english_score == 0)
    )
    return "es" if is_spanish else "en"


def normalize_retrieval_query(question: str) -> str:
    """Fold diacritics for retrieval while preserving legal identifiers exactly."""
    pieces: list[str] = []
    start = 0
    for match in _LEGAL_IDENTIFIER.finditer(question):
        pieces.append(_strip_diacritics(question[start : match.start()]))
        pieces.append(match.group(0))
        start = match.end()
    pieces.append(_strip_diacritics(question[start:]))
    return "".join(pieces)


def retrieval_query_variants(question: str) -> list[str]:
    """Build a small deterministic fallback set for Graphify retrieval.

    Graphify's native search is intentionally bounded and may return no hits
    when a natural-language question contains accents or several legal
    identifiers.  Keep the original normalized query first, then try the
    identifiers alone.  This improves recall without allowing model-generated
    tool arguments or arbitrary paths.
    """
    primary = normalize_retrieval_query(question).strip()
    variants: list[str] = [primary] if primary else []
    identifiers = [
        match.group(0).strip() for match in _LEGAL_IDENTIFIER.finditer(question)
    ]
    if identifiers:
        focused = " ".join(dict.fromkeys(identifiers))
        if focused and focused not in variants:
            variants.append(focused)
    unaccented = _strip_diacritics(question).strip()
    if unaccented and unaccented not in variants:
        variants.append(unaccented)
    return variants[:3]


def _strip_diacritics(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    )


def _insufficient_answer(language: ResponseLanguage) -> str:
    return INSUFFICIENT_ANSWER_ES if language == "es" else INSUFFICIENT_ANSWER


def sanitize_conversation_history(
    history: list[ConversationTurn] | None,
    *,
    max_turns: int = 6,
    max_characters: int = 8000,
) -> list[ConversationTurn]:
    """Return recent exchanges, bounded and safe as untrusted model context."""
    if not history or max_turns <= 0 or max_characters <= 0:
        return []
    bounded: list[ConversationTurn] = []
    remaining = max_characters
    # ``max_turns`` is an exchange count. Each completed exchange contains one
    # user and one assistant role message.
    for turn in reversed(history[-(max_turns * 2) :]):
        content = "".join(
            character
            if character in "\n\t"
            or not unicodedata.category(character).startswith("C")
            else " "
            for character in turn.content
        ).strip()
        if not content:
            continue
        content = content[:remaining]
        if not content:
            break
        bounded.append(turn.model_copy(update={"content": content}))
        remaining -= len(content)
        if remaining <= 0:
            break
    bounded.reverse()
    return bounded


class GraphKnowledgeClient(Protocol):
    async def search(self, query: str) -> Any: ...

    async def get_neighbors(self, node_id: str, depth: int = 1) -> Any: ...


def _mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return cast(dict[str, Any], value.model_dump(mode="json", by_alias=True))
    raise ValueError("Graphify returned an unsupported normalized result")


def _items(data: Mapping[str, Any], key: str) -> list[Any]:
    direct = data.get(key)
    if isinstance(direct, list):
        return direct
    evidence = (
        data.get("evidence") or data.get("graphEvidence") or data.get("graph_evidence")
    )
    if evidence is not None:
        nested = _mapping(evidence)
        value = nested.get(key)
        if isinstance(value, list):
            return value
    return []


def _parse_node(value: Any) -> GraphNode:
    data = _mapping(value)
    return GraphNode.model_validate(data)


def _parse_edge(value: Any) -> GraphEdge:
    data = _mapping(value)
    data["sourceNodeId"] = data.get("sourceNodeId", data.get("source_node_id"))
    data["targetNodeId"] = data.get("targetNodeId", data.get("target_node_id"))
    return GraphEdge.model_validate(data)


def _parse_path(value: Any) -> GraphPath:
    data = _mapping(value)
    data["nodeIds"] = data.get("nodeIds", data.get("node_ids"))
    data["edgeIds"] = data.get("edgeIds", data.get("edge_ids", []))
    return GraphPath.model_validate(data)


def _merge_evidence(
    results: list[Any], limits: WorkflowLimits
) -> tuple[GraphEvidence, list[Citation], str | None, list[str]]:
    nodes: dict[str, GraphNode] = {}
    edges: dict[str, GraphEdge] = {}
    paths: dict[str, GraphPath] = {}
    citations: dict[str, Citation] = {}
    warnings: list[str] = []
    graph_version: str | None = None

    for result in results:
        data = _mapping(result)
        graph_version = (
            graph_version or data.get("graphVersion") or data.get("graph_version")
        )
        for raw in _items(data, "nodes"):
            node = _parse_node(raw)
            nodes.setdefault(node.id, node)
        for raw in _items(data, "edges"):
            edge = _parse_edge(raw)
            edges.setdefault(edge.id, edge)
        for raw in _items(data, "paths"):
            path = _parse_path(raw)
            paths.setdefault(path.id, path)
        for raw in data.get("citations", []):
            citation_data = _mapping(raw)
            citation_data["nodeId"] = citation_data.get(
                "nodeId", citation_data.get("node_id")
            )
            citation = Citation.model_validate(citation_data)
            citations.setdefault(citation.id, citation)
        warnings.extend(str(item) for item in data.get("warnings", []))

    limited_nodes = list(nodes.values())[: limits.max_nodes]
    allowed_node_ids = {node.id for node in limited_nodes}
    limited_edges = [
        edge
        for edge in edges.values()
        if edge.source_node_id in allowed_node_ids
        and edge.target_node_id in allowed_node_ids
    ][: limits.max_edges]
    allowed_edge_ids = {edge.id for edge in limited_edges}
    limited_paths = [
        path
        for path in paths.values()
        if set(path.node_ids) <= allowed_node_ids
        and set(path.edge_ids) <= allowed_edge_ids
    ]
    if len(nodes) > len(limited_nodes) or len(edges) > len(limited_edges):
        warnings.append("Graph evidence was truncated to configured limits.")

    # A citation is allowlisted only when its normalized node survived the same
    # evidence limits and can therefore be included in the model context.
    citations = {
        citation_id: citation
        for citation_id, citation in citations.items()
        if citation.node_id in allowed_node_ids
    }

    # Nodes are evidence-bearing records even if the adapter did not provide a
    # separate citation list. IDs are deterministic and remain adapter-neutral.
    for node in limited_nodes:
        if any(citation.node_id == node.id for citation in citations.values()):
            continue
        citation_id = f"node:{node.id}"
        citations.setdefault(
            citation_id,
            Citation(
                id=citation_id,
                title=node.label,
                source=node.source or "Graphify knowledge graph",
                node_id=node.id,
                provenance=node.provenance,
                excerpt=node.excerpt,
            ),
        )

    evidence = GraphEvidence(
        nodes=limited_nodes, edges=limited_edges, paths=limited_paths
    )
    encoded = json.dumps(
        evidence.model_dump(mode="json", by_alias=True), separators=(",", ":")
    ).encode()
    while len(encoded) > limits.max_evidence_bytes and evidence.nodes:
        removed = evidence.nodes.pop()
        evidence.edges = [
            edge
            for edge in evidence.edges
            if edge.source_node_id != removed.id and edge.target_node_id != removed.id
        ]
        evidence.paths = [
            path for path in evidence.paths if removed.id not in path.node_ids
        ]
        citations = {
            key: citation
            for key, citation in citations.items()
            if citation.node_id != removed.id
        }
        encoded = json.dumps(
            evidence.model_dump(mode="json", by_alias=True), separators=(",", ":")
        ).encode()
    if len(encoded) > limits.max_evidence_bytes:
        evidence = GraphEvidence()
        citations = {}

    node_labels = {node.id: node.label for node in evidence.nodes}
    for edge in evidence.edges:
        source_label = node_labels[edge.source_node_id]
        target_label = node_labels[edge.target_node_id]
        context = edge.properties.get("context")
        citations[f"edge:{edge.id}"] = Citation(
            id=f"edge:{edge.id}",
            title=f"{source_label} —{edge.relationship}→ {target_label}",
            source="Graphify knowledge graph",
            relationship=edge.relationship,
            provenance=edge.provenance,
            excerpt=context if isinstance(context, str) else None,
        )
    for path in evidence.paths:
        labels = [node_labels[node_id] for node_id in path.node_ids]
        citations[f"path:{path.id}"] = Citation(
            id=f"path:{path.id}",
            title=" → ".join(labels),
            source="Graphify knowledge graph",
            relationship="graph_path",
            provenance="unknown",
        )
    return (
        evidence,
        list(citations.values()),
        graph_version,
        list(dict.fromkeys(warnings)),
    )


def _source_scope(result: Any, question: str) -> RetrievalScope:
    """Derive an immutable text scope only from normalized Graphify evidence."""
    evidence, citations, _, _ = _merge_evidence([result], WorkflowLimits())
    documents: list[str] = []
    articles: list[str] = []
    for source in [
        *(node.source for node in evidence.nodes),
        *(citation.source for citation in citations),
    ]:
        if not source:
            continue
        candidate = PurePosixPath(source).name
        if (
            candidate.lower().endswith(".md")
            and candidate not in {".", ".."}
            and candidate not in documents
        ):
            documents.append(candidate)
    for node in evidence.nodes:
        values = [node.label, *(str(value) for value in node.properties.values())]
        for value in values:
            for match in _ARTICLE_IDENTIFIER.finditer(value):
                article = match.group(1).upper()
                if article not in articles:
                    articles.append(article)
    requested = [
        match.group(1).upper() for match in _ARTICLE_IDENTIFIER.finditer(question)
    ]
    scoped_articles = (
        [article for article in requested if article in articles]
        if requested
        else articles
    )
    return RetrievalScope(
        documents=documents,
        articles=scoped_articles,
    )


def _is_article_detail_question(state: WorkflowState) -> bool:
    return bool(
        _ARTICLE_IDENTIFIER.search(state.get("resolved_query", state["question"]))
    )


def _source_citations(passages: list[SourcePassage]) -> list[Citation]:
    citations: list[Citation] = []
    for passage in passages:
        location = (
            f"Artículo {passage.article}" if passage.article else "pasaje documental"
        )
        if passage.paragraph:
            location += f", {passage.paragraph}"
        citations.append(
            Citation(
                id=passage.id,
                title=f"{passage.document} — {location}",
                source=passage.document,
                document=passage.document,
                article=passage.article,
                paragraph=passage.paragraph,
                start_line=passage.start_line,
                end_line=passage.end_line,
                excerpt=passage.text,
                provenance="explicit",
            )
        )
    return citations


class KnowledgeWorkflow:
    """Compiled workflow and streaming facade used by the API layer."""

    def __init__(
        self,
        graph_client: GraphKnowledgeClient,
        model: LanguageModel,
        limits: WorkflowLimits | None = None,
        source_retriever: SourceRetriever | None = None,
    ) -> None:
        self.graph_client = graph_client
        self.model = model
        self.limits = limits or WorkflowLimits()
        self.source_retriever = source_retriever
        builder = StateGraph(WorkflowState)
        for name in (
            "validate_request",
            "resolve_follow_up",
            "prepare_clarification",
            "classify_question",
            "plan_graph_query",
            "query_graphify",
            "scope_text_retrieval",
            "retrieve_source_passages_with_haystack",
            "expand_graph_evidence",
            "merge_graph_and_text_evidence",
            "prepare_context",
            "generate_answer",
            "validate_grounding",
            "format_response",
        ):
            builder.add_node(name, getattr(self, name))
        builder.add_edge(START, "validate_request")
        builder.add_edge("validate_request", "resolve_follow_up")
        builder.add_conditional_edges(
            "resolve_follow_up",
            lambda state: (
                "clarification"
                if state["follow_up_resolution"].kind == "clarification"
                else "retrieve"
            ),
            {
                "clarification": "prepare_clarification",
                "retrieve": "classify_question",
            },
        )
        builder.add_edge("prepare_clarification", "format_response")
        names = [
            "classify_question",
            "plan_graph_query",
            "query_graphify",
            "scope_text_retrieval",
            "retrieve_source_passages_with_haystack",
            "expand_graph_evidence",
            "merge_graph_and_text_evidence",
            "prepare_context",
            "generate_answer",
            "validate_grounding",
            "format_response",
        ]
        for current, following in zip(names, names[1:], strict=False):
            builder.add_edge(current, following)
        builder.add_edge("format_response", END)
        self.graph = builder.compile()

    async def validate_request(self, state: WorkflowState) -> dict[str, Any]:
        question = state.get("question", "").strip()
        if not question or len(question) > 4000:
            raise ValueError("Question must contain between 1 and 4000 characters")
        return {
            "question": question,
            "conversation_history": sanitize_conversation_history(
                state.get("conversation_history"),
                max_turns=self.limits.max_history_turns,
                max_characters=self.limits.max_history_characters,
            ),
            "response_language": detect_response_language(question),
            "tool_calls": 0,
            "model_iterations": 0,
        }

    async def resolve_follow_up(self, state: WorkflowState) -> dict[str, Any]:
        history = state.get("conversation_history", [])
        if not history:
            return {
                "follow_up_resolution": FollowUpResolution(
                    kind="standalone", standalone_query=state["question"]
                ),
                "resolved_query": state["question"],
            }
        result = await self.model.resolve_follow_up(
            FollowUpRequest(
                messages=[
                    ChatMessage(role="system", content=follow_up_system_prompt()),
                    ChatMessage(
                        role="user",
                        content=follow_up_user_prompt(
                            state["question"],
                            [
                                turn.model_dump(mode="json")
                                for turn in state["conversation_history"]
                            ],
                            state["response_language"],
                        ),
                    ),
                ],
                temperature=0,
            )
        )
        output = result.output
        known_ids = {turn.id for turn in history}
        if any(turn_id not in known_ids for turn_id in output.referenced_turn_ids):
            raise ModelResponseError("Follow-up referenced an unknown turn")
        if output.kind == "clarification":
            question = (output.clarification_question or "").strip()
            if not question:
                raise ModelResponseError("Clarification response omitted its question")
            resolution = FollowUpResolution(
                kind="clarification",
                clarification_question=question,
                referenced_turn_ids=output.referenced_turn_ids,
            )
            return {
                "follow_up_resolution": resolution,
                "resolved_query": state["question"],
            }
        query = (output.standalone_query or "").strip()
        if not query:
            raise ModelResponseError("Follow-up response omitted its standalone query")
        resolution = FollowUpResolution(
            kind=output.kind,
            standalone_query=query,
            referenced_turn_ids=output.referenced_turn_ids,
        )
        return {"follow_up_resolution": resolution, "resolved_query": query}

    async def prepare_clarification(self, state: WorkflowState) -> dict[str, Any]:
        return {
            "draft_answer": state["follow_up_resolution"].clarification_question,
            "draft_confidence": "insufficient",
            "draft_citation_ids": [],
            "evidence": GraphEvidence(),
            "evidence_citations": [],
            "graph_version": None,
            "warnings": [],
            "response_type": "clarification",
        }

    async def classify_question(self, state: WorkflowState) -> dict[str, Any]:
        # Classification is deliberately deterministic: it cannot expand tool access.
        category = (
            "relationship"
            if any(
                token in state.get("resolved_query", state["question"]).lower()
                for token in (
                    "relationship",
                    "related",
                    "connect",
                    "path",
                    "relacion",
                    "relación",
                    "conecta",
                    "vincula",
                )
            )
            else "knowledge"
        )
        return {"category": category}

    async def plan_graph_query(self, state: WorkflowState) -> dict[str, Any]:
        # Preserve the exact validated question separately. Only the retrieval
        # form folds accents; project paths and tool names are never model input.
        return {
            "original_query": state["question"],
            "planned_query": normalize_retrieval_query(
                state.get("resolved_query", state["question"])
            ),
        }

    async def query_graphify(self, state: WorkflowState) -> dict[str, Any]:
        if state.get("tool_calls", 0) >= self.limits.max_tool_calls:
            raise RuntimeError("Graphify tool-call limit exceeded")
        result = await self.graph_client.search(state["planned_query"])
        calls = state.get("tool_calls", 0) + 1
        retrieval_warnings: list[str] = []
        # A focused retry is useful for native Graphify search, which can miss
        # a law when the question contains accents, punctuation, and several
        # entities.  Retry only when the first response is genuinely empty;
        # never replace non-empty evidence or bypass grounding validation.
        first = _mapping(result)
        if not _items(first, "nodes"):
            for candidate in retrieval_query_variants(
                state.get("resolved_query", state["question"])
            )[1:]:
                if calls >= self.limits.max_tool_calls:
                    break
                retry = await self.graph_client.search(candidate)
                calls += 1
                if _items(_mapping(retry), "nodes"):
                    result = retry
                    retrieval_warnings.append(
                        "Graphify returned no nodes for the primary query; "
                        "a focused retrieval query was used."
                    )
                    break
        return {
            "search_result": result,
            "tool_calls": calls,
            "warnings": retrieval_warnings,
        }

    async def expand_graph_evidence(self, state: WorkflowState) -> dict[str, Any]:
        results = [state["search_result"]]
        initial, _, _, _ = _merge_evidence(results, self.limits)
        remaining = self.limits.max_tool_calls - state.get("tool_calls", 0)
        # Expand only top search hits and only through the fixed adapter operation.
        for node in initial.nodes[:remaining]:
            result = await self.graph_client.get_neighbors(
                node.id, depth=self.limits.max_traversal_depth
            )
            results.append(result)
        evidence, citations, version, warnings = _merge_evidence(results, self.limits)
        return {
            "evidence": evidence,
            "evidence_citations": citations,
            "graph_version": version,
            "warnings": list(dict.fromkeys(state.get("warnings", []) + warnings)),
            "tool_calls": state.get("tool_calls", 0) + len(results) - 1,
        }

    async def scope_text_retrieval(self, state: WorkflowState) -> dict[str, Any]:
        return {
            "retrieval_scope": _source_scope(
                state["search_result"],
                state.get("resolved_query", state["question"]),
            )
        }

    async def retrieve_source_passages_with_haystack(
        self, state: WorkflowState
    ) -> dict[str, Any]:
        scope = cast(RetrievalScope, state["retrieval_scope"])
        article_detail = _is_article_detail_question(state)
        if self.source_retriever is None:
            return {"source_passages": [], "source_available": False}
        if not scope.documents or (article_detail and not scope.articles):
            warnings = list(state.get("warnings", []))
            if article_detail:
                warnings.append(
                    SOURCE_PASSAGES_MISSING_WARNING_ES
                    if state["response_language"] == "es"
                    else SOURCE_PASSAGES_MISSING_WARNING
                )
            return {
                "source_passages": [],
                "source_available": bool(scope.documents),
                "warnings": list(dict.fromkeys(warnings)),
            }
        try:
            passages = await self.source_retriever.retrieve(
                state["planned_query"], scope, top_k=8
            )
        except Exception:
            return {
                "source_passages": [],
                "source_available": False,
                "warnings": list(
                    dict.fromkeys(
                        state.get("warnings", [])
                        + [SOURCE_RETRIEVAL_UNAVAILABLE_WARNING]
                    )
                ),
            }
        warnings = list(state.get("warnings", []))
        if article_detail and not passages:
            warnings.append(
                SOURCE_PASSAGES_MISSING_WARNING_ES
                if state["response_language"] == "es"
                else SOURCE_PASSAGES_MISSING_WARNING
            )
        return {
            "source_passages": passages,
            "source_available": True,
            "warnings": list(dict.fromkeys(warnings)),
        }

    async def merge_graph_and_text_evidence(
        self, state: WorkflowState
    ) -> dict[str, Any]:
        citations = list(state["evidence_citations"])
        citations.extend(_source_citations(state.get("source_passages", [])))
        merged = {item.id: item for item in citations}
        return {"evidence_citations": list(merged.values())}

    async def prepare_context(self, state: WorkflowState) -> dict[str, Any]:
        evidence = state["evidence"]
        citation_by_node = {
            citation.node_id: citation.id
            for citation in state["evidence_citations"]
            if citation.node_id
        }
        node_labels = {node.id: node.label for node in evidence.nodes}
        nodes = [
            {
                "kind": "node",
                "evidenceId": citation_by_node.get(node.id, f"node:{node.id}"),
                **node.model_dump(mode="json", exclude={"id"}),
            }
            for node in evidence.nodes
        ]
        edges = [
            {
                "kind": "relationship",
                "evidenceId": f"edge:{edge.id}",
                "sourceLabel": node_labels[edge.source_node_id],
                "targetLabel": node_labels[edge.target_node_id],
                **edge.model_dump(
                    mode="json",
                    by_alias=True,
                    exclude={"id", "source_node_id", "target_node_id"},
                ),
            }
            for edge in evidence.edges
        ]
        paths = [
            {
                "kind": "path",
                "evidenceId": f"path:{path.id}",
                "nodeLabels": [node_labels[node_id] for node_id in path.node_ids],
                **path.model_dump(
                    mode="json",
                    by_alias=True,
                    exclude={"id", "node_ids", "edge_ids"},
                ),
            }
            for path in evidence.paths
        ]
        source_passages = [
            {
                "kind": "source_passage",
                "evidenceId": passage.id,
                "label": (
                    f"{passage.document} — Artículo {passage.article}"
                    if passage.article
                    else passage.document
                ),
                "document": passage.document,
                "article": passage.article,
                "paragraph": passage.paragraph,
                "startLine": passage.start_line,
                "endLine": passage.end_line,
                "excerpt": passage.text,
                "provenance": "explicit",
            }
            for passage in state.get("source_passages", [])
        ]
        citation_allowlist = [citation.id for citation in state["evidence_citations"]]
        return {
            "context": json.dumps(
                {
                    "questionCategory": state.get("category", "knowledge"),
                    "citationIdAllowlist": citation_allowlist,
                    "sourcePassages": source_passages,
                    "nodes": nodes,
                    "edges": edges,
                    "paths": paths,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        }

    async def generate_answer(self, state: WorkflowState) -> dict[str, Any]:
        if not state["evidence"].nodes or not state["evidence_citations"]:
            return {
                "draft_answer": _insufficient_answer(state["response_language"]),
                "draft_confidence": "insufficient",
                "draft_citation_ids": [],
            }
        if (
            self.source_retriever is not None
            and _is_article_detail_question(state)
            and not state.get("source_passages")
        ):
            return {
                "draft_answer": _insufficient_answer(state["response_language"]),
                "draft_confidence": "insufficient",
                "draft_citation_ids": [],
            }
        if state.get("model_iterations", 0) >= self.limits.max_model_iterations:
            raise RuntimeError("Model iteration limit exceeded")
        result = await self.model.generate(
            ModelRequest(
                messages=[
                    ChatMessage(
                        role="system",
                        content=system_prompt(state["response_language"]),
                    ),
                    ChatMessage(
                        role="user",
                        content=user_prompt(
                            state["question"],
                            state["context"],
                            state["response_language"],
                            [
                                turn.model_dump(mode="json")
                                for turn in state.get("conversation_history", [])
                            ],
                        ),
                    ),
                ],
                temperature=0,
            )
        )
        return {
            "draft_answer": result.output.answer,
            "draft_confidence": result.output.confidence,
            "draft_citation_ids": list(dict.fromkeys(result.output.citation_ids)),
            "warnings": list(
                dict.fromkeys(state.get("warnings", []) + result.output.warnings)
            ),
            "model_iterations": state.get("model_iterations", 0) + 1,
        }

    async def validate_grounding(self, state: WorkflowState) -> dict[str, Any]:
        allowed = {citation.id for citation in state["evidence_citations"]}
        requested = state.get("draft_citation_ids", [])
        article_without_source_citation = (
            self.source_retriever is not None
            and _is_article_detail_question(state)
            and not any(citation_id.startswith("source:") for citation_id in requested)
        )
        knowledge_without_source_citation = (
            state.get("category") != "relationship"
            and bool(state.get("source_passages"))
            and not any(citation_id.startswith("source:") for citation_id in requested)
        )
        if (
            state.get("draft_confidence") == "insufficient"
            or not requested
            or any(citation_id not in allowed for citation_id in requested)
            or article_without_source_citation
            or knowledge_without_source_citation
        ):
            warnings = list(state.get("warnings", []))
            if requested and any(item not in allowed for item in requested):
                warnings.append(
                    UNSUPPORTED_CITATIONS_WARNING_ES
                    if state["response_language"] == "es"
                    else UNSUPPORTED_CITATIONS_WARNING
                )
            return {
                "draft_answer": _insufficient_answer(state["response_language"]),
                "draft_confidence": "insufficient",
                "draft_citation_ids": [],
                "response_type": "insufficient",
                "warnings": list(dict.fromkeys(warnings)),
            }
        return {"response_type": "answer"}

    async def format_response(self, state: WorkflowState) -> dict[str, Any]:
        selected = set(state.get("draft_citation_ids", []))
        citations = [
            citation
            for citation in state["evidence_citations"]
            if citation.id in selected
        ]
        return {
            "answer": Answer(
                request_id=state["request_id"],
                conversation_id=state["conversation_id"],
                answer=state["draft_answer"],
                response_type=state.get(
                    "response_type",
                    "insufficient"
                    if state["draft_confidence"] == "insufficient"
                    else "answer",
                ),
                confidence=state["draft_confidence"],
                graph_version=state.get("graph_version"),
                citations=citations,
                graph_evidence=state["evidence"],
                warnings=state.get("warnings", []),
            )
        }

    async def invoke(
        self,
        question: str,
        request_id: str,
        conversation_id: str,
        history: list[ConversationTurn] | None = None,
    ) -> Answer:
        initial: WorkflowState = {
            "question": question,
            "request_id": request_id,
            "conversation_id": conversation_id,
            "conversation_history": history or [],
        }
        async with asyncio.timeout(self.limits.request_timeout_seconds):
            result = await self.graph.ainvoke(initial)
        return cast(Answer, result["answer"])

    async def stream(
        self,
        question: str,
        request_id: str,
        conversation_id: str,
        history: list[ConversationTurn] | None = None,
    ) -> AsyncIterator[LifecycleEvent]:
        """Yield contract-ready events; the API only needs SSE serialization."""
        message_id = str(uuid4())
        yield LifecycleEvent(
            type="message.started",
            request_id=request_id,
            conversation_id=conversation_id,
            message_id=message_id,
        )
        tool_call_id = str(uuid4())
        initial: WorkflowState = {
            "question": question,
            "request_id": request_id,
            "conversation_id": conversation_id,
            "conversation_history": history or [],
        }
        try:
            async with asyncio.timeout(self.limits.request_timeout_seconds):
                async for update in self.graph.astream(initial, stream_mode="updates"):
                    if "plan_graph_query" in update:
                        yield LifecycleEvent(
                            type="tool.started",
                            request_id=request_id,
                            conversation_id=conversation_id,
                            tool_call_id=tool_call_id,
                            tool="graphify.search",
                        )
                    if "expand_graph_evidence" in update:
                        node_update = update["expand_graph_evidence"]
                        evidence = node_update["evidence"]
                        yield LifecycleEvent(
                            type="tool.completed",
                            request_id=request_id,
                            conversation_id=conversation_id,
                            tool_call_id=tool_call_id,
                            tool="graphify.search",
                            summary={
                                "nodeCount": len(evidence.nodes),
                                "edgeCount": len(evidence.edges),
                                "truncated": any(
                                    "truncated" in item.lower()
                                    for item in node_update.get("warnings", [])
                                ),
                            },
                        )
                    if "format_response" in update:
                        answer: Answer = update["format_response"]["answer"]
                        for start in range(0, len(answer.answer), 80):
                            yield LifecycleEvent(
                                type="answer.delta",
                                request_id=request_id,
                                conversation_id=conversation_id,
                                delta=answer.answer[start : start + 80],
                            )
                        for citation in answer.citations:
                            yield LifecycleEvent(
                                type="citation.available",
                                request_id=request_id,
                                conversation_id=conversation_id,
                                citation=citation,
                            )
                        yield LifecycleEvent(
                            type="message.completed",
                            request_id=request_id,
                            conversation_id=conversation_id,
                            result=answer,
                        )
        except Exception as exc:
            code, retryable = _safe_error(exc)
            yield LifecycleEvent(
                type="message.failed",
                request_id=request_id,
                conversation_id=conversation_id,
                error={
                    "code": code,
                    "message": _error_message(code),
                    "retryable": retryable,
                },
            )


def _safe_error(exc: Exception) -> tuple[str, bool]:
    if isinstance(exc, TimeoutError):
        return "request_timeout", True
    if isinstance(exc, ValueError):
        return "invalid_request", False
    name = type(exc).__name__.lower()
    if "timeout" in name:
        return "mcp_timeout", True
    if "model" in name or "llm" in name:
        return (
            "invalid_model_response" if "response" in name else "llm_unavailable",
            True,
        )
    if "graph" in name or "mcp" in name:
        return "graphify_unavailable", True
    return "internal_error", False


def _error_message(code: str) -> str:
    return {
        "request_timeout": "The request exceeded its configured time limit.",
        "invalid_request": "The question is invalid.",
        "mcp_timeout": "Graphify did not respond in time.",
        "llm_unavailable": "The language model is temporarily unavailable.",
        "invalid_model_response": "The language model returned an invalid response.",
        "graphify_unavailable": "Graphify is temporarily unavailable.",
        "internal_error": "The request could not be completed.",
    }[code]
