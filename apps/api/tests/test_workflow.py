from __future__ import annotations

import asyncio

import pytest
from conftest import FakeGraph, FakeModel

from app.agent.models import Citation, WorkflowLimits
from app.agent.workflow import (
    INSUFFICIENT_ANSWER,
    KnowledgeWorkflow,
    _numbered_citation_answer,
    retrieval_query_variants,
)
from app.integrations.llm.errors import ModelResponseError


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("What is Graphify?", "knowledge"),
        ("How are these related?", "relationship"),
        ("Find a path between them", "relationship"),
    ],
)
async def test_classification_and_query_plan_are_deterministic(
    workflow: KnowledgeWorkflow, question: str, expected: str
) -> None:
    classified = await workflow.classify_question({"question": question})
    planned = await workflow.plan_graph_query({"question": question})
    assert classified == {"category": expected}
    assert planned == {"original_query": question, "planned_query": question}


async def test_workflow_queries_and_expands_with_configured_bounds() -> None:
    graph = FakeGraph(
        {
            "nodes": [
                {"id": f"n{i}", "label": f"Node {i}", "type": "entity"}
                for i in range(5)
            ],
            "edges": [],
            "citations": [],
        }
    )
    workflow = KnowledgeWorkflow(
        graph,
        FakeModel(citation_ids=["node:n0"]),
        WorkflowLimits(max_tool_calls=3, max_traversal_depth=1, max_nodes=10),
    )
    answer = await workflow.invoke("question", "r1", "conv1")
    assert graph.searches == ["question"]
    assert graph.neighbor_calls == [("n0", 1), ("n1", 1)]
    assert answer.citations[0].id == "node:n0"


def test_retrieval_query_variants_keep_law_identifiers_intact() -> None:
    variants = retrieval_query_variants(
        "¿Qué establece la Ley 100 de 1993 sobre pensiones?"
    )
    assert variants[0] == "¿Que establece la Ley 100 de 1993 sobre pensiones?"
    assert "Ley 100 de 1993" in variants


def test_internal_source_ids_become_stable_numbered_references() -> None:
    citations = [
        Citation(
            id="source:article-49-d",
            title="Artículo 49, literal d)",
            source="ley-2381-de-2024.md",
            provenance="explicit",
        ),
        Citation(
            id="source:article-49-e",
            title="Artículo 49, literal e)",
            source="ley-2381-de-2024.md",
            provenance="explicit",
        ),
    ]

    displayed = _numbered_citation_answer(
        "Hijos [source:article-49-d]. Padres (source:article-49-e). "
        "Hijos source:article-49-d.",
        citations,
        "es",
    )

    assert displayed == "Hijos [1]. Padres [2]. Hijos [1]."
    assert "source:" not in displayed


def test_unmatched_source_id_is_never_exposed_in_answer_text() -> None:
    assert (
        _numbered_citation_answer("Contenido (source:not-allowlisted).", [], "es")
        == "Contenido fuente de respaldo."
    )


async def test_empty_primary_search_retries_with_focused_law_query() -> None:
    class RetryGraph(FakeGraph):
        async def search(self, query: str) -> object:
            self.searches.append(query)
            if len(self.searches) == 1:
                return {"nodes": [], "edges": [], "citations": []}
            return {
                "nodes": [
                    {
                        "id": "law-100",
                        "label": "Ley 100 de 1993",
                        "type": "law",
                        "source": "ley-100-de-1993.md",
                    }
                ],
                "edges": [],
                "citations": [],
            }

    graph = RetryGraph({"nodes": [], "edges": [], "citations": []})
    workflow = KnowledgeWorkflow(
        graph,
        FakeModel(citation_ids=["node:law-100"]),
        WorkflowLimits(max_tool_calls=3, max_traversal_depth=1),
    )
    answer = await workflow.invoke(
        "¿Qué establece la Ley 100 de 1993 sobre pensiones?", "r-retry", "c-retry"
    )
    assert graph.searches[:2] == [
        "¿Que establece la Ley 100 de 1993 sobre pensiones?",
        "Ley 100 de 1993",
    ]
    assert answer.citations[0].node_id == "law-100"


async def test_invalid_model_citation_becomes_insufficient(
    graph: FakeGraph,
) -> None:
    workflow = KnowledgeWorkflow(graph, FakeModel(citation_ids=["fabricated"]))
    answer = await workflow.invoke("question", "r1", "conv1")
    assert answer.confidence == "insufficient"
    assert answer.answer == INSUFFICIENT_ANSWER
    assert answer.citations == []
    assert "unsupported citation" in " ".join(answer.warnings).lower()


async def test_relationship_and_path_evidence_are_context_and_citable() -> None:
    graph = FakeGraph(
        {
            "nodes": [
                {
                    "id": "law",
                    "label": "Law",
                    "type": "law",
                    "source": "law.md",
                },
                {
                    "id": "system",
                    "label": "Pension system",
                    "type": "concept",
                    "source": "law.md",
                },
            ],
            "edges": [
                {
                    "id": "e1",
                    "sourceNodeId": "law",
                    "targetNodeId": "system",
                    "relationship": "REGULATES",
                    "properties": {"context": "The law regulates the system."},
                    "provenance": "explicit",
                }
            ],
            "paths": [
                {
                    "id": "p1",
                    "nodeIds": ["law", "system"],
                    "edgeIds": ["e1"],
                }
            ],
            "citations": [],
        }
    )
    model = FakeModel(citation_ids=["edge:e1"])
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "How are the law and system related?", "r-edge", "conv-edge"
    )

    prompt = model.requests[0].messages[-1].content
    assert '"kind":"node"' in prompt
    assert '"kind":"relationship","evidenceId":"edge:e1"' in prompt
    assert '"provenance":"explicit"' in prompt
    assert '"context":"The law regulates the system."' in prompt
    assert '"kind":"path","evidenceId":"path:p1"' in prompt
    assert '"id":"law"' not in prompt
    assert '"id":"e1"' not in prompt
    assert '"sourceNodeId"' not in prompt
    assert '"targetNodeId"' not in prompt
    assert '"nodeIds"' not in prompt
    assert '"edgeIds"' not in prompt
    assert answer.citations[0].id == "edge:e1"
    assert answer.citations[0].relationship == "REGULATES"
    assert answer.citations[0].provenance == "explicit"
    assert answer.citations[0].excerpt == "The law regulates the system."


async def test_normalized_path_evidence_can_be_cited() -> None:
    graph = FakeGraph(
        {
            "nodes": [
                {"id": "a", "label": "A", "type": "entity"},
                {"id": "b", "label": "B", "type": "entity"},
            ],
            "edges": [],
            "paths": [{"id": "p1", "nodeIds": ["a", "b"], "edgeIds": []}],
        }
    )
    workflow = KnowledgeWorkflow(graph, FakeModel(citation_ids=["path:p1"]))

    answer = await workflow.invoke("Find a path", "r-path", "conv-path")

    assert answer.citations[0].id == "path:p1"
    assert answer.citations[0].relationship == "graph_path"


async def test_empty_graph_skips_model_and_returns_insufficient() -> None:
    model = FakeModel()
    workflow = KnowledgeWorkflow(
        FakeGraph({"nodes": [], "edges": [], "citations": []}), model
    )
    answer = await workflow.invoke("unknown", "r1", "conv1")
    assert answer.confidence == "insufficient"
    assert answer.graph_evidence.nodes == []
    assert model.requests == []


async def test_evidence_and_tool_limits_truncate_results() -> None:
    graph = FakeGraph(
        {
            "nodes": [
                {"id": "n1", "label": "One", "type": "entity"},
                {"id": "n2", "label": "Two", "type": "entity"},
            ],
            "edges": [
                {
                    "id": "e1",
                    "sourceNodeId": "n1",
                    "targetNodeId": "n2",
                    "relationship": "LINKS",
                }
            ],
        }
    )
    workflow = KnowledgeWorkflow(
        graph,
        FakeModel(citation_ids=["node:n1"]),
        WorkflowLimits(max_tool_calls=1, max_nodes=1, max_edges=0),
    )
    answer = await workflow.invoke("question", "r1", "conv1")
    assert len(answer.graph_evidence.nodes) == 1
    assert graph.neighbor_calls == []
    assert any("truncated" in warning.lower() for warning in answer.warnings)


async def test_overall_timeout_is_a_sanitized_terminal_event() -> None:
    class SlowGraph(FakeGraph):
        async def search(self, query: str) -> object:
            await asyncio.sleep(0.05)
            return self.search_result

    workflow = KnowledgeWorkflow(
        SlowGraph(),
        FakeModel(),
        WorkflowLimits(request_timeout_seconds=0.001),
    )
    events = [event async for event in workflow.stream("question", "r1", "conv1")]
    assert events[0].type == "message.started"
    assert events[-1].type == "message.failed"
    assert events[-1].error == {
        "code": "request_timeout",
        "message": "The request exceeded its configured time limit.",
        "retryable": True,
    }


async def test_provider_error_details_are_not_exposed(graph: FakeGraph) -> None:
    secret = "api-key-super-secret"
    workflow = KnowledgeWorkflow(
        graph, FakeModel(error=ModelResponseError(f"provider leaked {secret}"))
    )
    events = [event async for event in workflow.stream("question", "r1", "conv1")]
    failure = events[-1]
    assert failure.type == "message.failed"
    assert failure.error["code"] == "invalid_model_response"
    assert secret not in str(failure.error)
