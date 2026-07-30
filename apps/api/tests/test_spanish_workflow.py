from __future__ import annotations

from typing import Any

import pytest

from app.agent.models import WorkflowLimits
from app.agent.workflow import (
    INSUFFICIENT_ANSWER_ES,
    UNSUPPORTED_CITATIONS_WARNING_ES,
    KnowledgeWorkflow,
    detect_response_language,
    normalize_retrieval_query,
)
from app.integrations.llm.mock import DeterministicModel
from app.integrations.llm.models import AnswerDraft


class RecordingGraph:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.searches: list[str] = []

    async def search(self, query: str) -> dict[str, Any]:
        self.searches.append(query)
        return self.result

    async def get_neighbors(self, node_id: str, depth: int = 1) -> dict[str, Any]:
        return {"nodes": [], "edges": [], "paths": []}


def test_language_detection_is_lightweight_and_conservative() -> None:
    assert detect_response_language("¿Qué establece la ley sobre pensiones?") == "es"
    assert detect_response_language("Cómo se relacionan estas normas") == "es"
    assert detect_response_language("Ley 100 de 1993") == "es"
    assert detect_response_language("What does the pension law establish?") == "en"
    assert detect_response_language("What does Ley 100 de 1993 establish?") == "en"
    assert detect_response_language("Graphify API") == "en"


@pytest.mark.parametrize(
    ("question", "expected", "identifier"),
    [
        (
            "¿Qué señala la Resolución 1271 de 2023 sobre pensión?",
            "¿Que senala la Resolución 1271 de 2023 sobre pension?",
            "Resolución 1271 de 2023",
        ),
        (
            "QUE DICE EL ARTICULO 13 DE LA LEY 100 DE 1993?",
            "QUE DICE EL ARTICULO 13 DE LA LEY 100 DE 1993?",
            "ARTICULO 13",
        ),
        (
            "Cómo aplica el Artículo 13 de la Ley 100 de 1993?",
            "Como aplica el Artículo 13 de la Ley 100 de 1993?",
            "Artículo 13",
        ),
        (
            "Explique la sentencia C-123 sobre protección.",
            "Explique la sentencia C-123 sobre proteccion.",
            "sentencia C-123",
        ),
    ],
)
def test_retrieval_query_folds_accents_and_preserves_identifiers(
    question: str, expected: str, identifier: str
) -> None:
    normalized = normalize_retrieval_query(question)

    assert normalized == expected
    assert identifier in normalized


async def test_spanish_question_preserves_prompt_and_normalizes_search() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {
                    "id": "ley-100",
                    "label": "Ley 100 de 1993",
                    "type": "law",
                    "source": "ley-100-de-1993.md",
                    "excerpt": "La ley organiza el sistema de seguridad social.",
                    "provenance": "explicit",
                }
            ],
            "edges": [],
            "paths": [],
            "citations": [
                {
                    "id": "c-ley-100",
                    "title": "Ley 100 de 1993",
                    "source": "ley-100-de-1993.md",
                    "nodeId": "ley-100",
                    "provenance": "explicit",
                    "excerpt": "La ley organiza el sistema de seguridad social.",
                }
            ],
        }
    )
    model = DeterministicModel()
    workflow = KnowledgeWorkflow(graph, model)
    question = "¿Qué establece la Ley 100 de 1993 sobre pensión?"

    answer = await workflow.invoke(question, "request-1", "conversation-1")

    assert graph.searches == ["¿Que establece la Ley 100 de 1993 sobre pension?"]
    model_prompt = "\n".join(message.content for message in model.requests[0].messages)
    assert question in model_prompt
    assert "respóndela en español" in model_prompt
    assert answer.answer.startswith("Según Ley 100 de 1993")
    assert answer.citations[0].id == "c-ley-100"


async def test_spanish_empty_evidence_returns_spanish_without_calling_model() -> None:
    graph = RecordingGraph({"nodes": [], "edges": [], "paths": [], "citations": []})
    model = DeterministicModel()
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "¿Qué establece la Ley 2381 de 2024?",
        "request-2",
        "conversation-2",
    )

    assert answer.confidence == "insufficient"
    assert answer.answer == INSUFFICIENT_ANSWER_ES
    assert answer.citations == []
    assert model.requests == []


async def test_unaccented_uppercase_article_question_gets_spanish_answer() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {
                    "id": "graphify:internal-article-13",
                    "label": "Artículo 13 de la Ley 100 de 1993",
                    "type": "legal_article",
                    "source": "ley-100-de-1993.md",
                    "excerpt": "El artículo establece características del sistema.",
                    "provenance": "explicit",
                }
            ],
            "edges": [],
            "paths": [],
            "citations": [
                {
                    "id": "node:graphify:internal-article-13",
                    "title": "Artículo 13 de la Ley 100 de 1993",
                    "source": "ley-100-de-1993.md",
                    "nodeId": "graphify:internal-article-13",
                    "provenance": "explicit",
                }
            ],
        }
    )
    workflow = KnowledgeWorkflow(graph, DeterministicModel())
    question = "QUE DICE EL ARTICULO 13 DE LA LEY 100 DE 1993?"

    answer = await workflow.invoke(question, "request-article", "conversation-article")

    assert graph.searches == [question]
    assert answer.answer.startswith("Según Artículo 13 de la Ley 100 de 1993")
    assert answer.citations[0].id == "node:graphify:internal-article-13"


async def test_unsupported_spanish_citation_is_rejected_without_reasoning() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {
                    "id": "ley-100",
                    "label": "Ley 100 de 1993",
                    "type": "law",
                    "source": "ley-100-de-1993.md",
                    "excerpt": "La ley regula el sistema.",
                    "provenance": "explicit",
                }
            ],
            "edges": [],
            "paths": [],
            "citations": [
                {
                    "id": "c-ley-100",
                    "title": "Ley 100 de 1993",
                    "source": "ley-100-de-1993.md",
                    "nodeId": "ley-100",
                    "provenance": "explicit",
                }
            ],
        }
    )
    model = DeterministicModel(
        answer=AnswerDraft(
            answer="Razonamiento privado y afirmación sin respaldo.",
            confidence="high",
            citation_ids=["citation:fabricada"],
        )
    )
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "¿Qué establece la Ley 100 de 1993?",
        "request-unsupported",
        "conversation-unsupported",
    )

    assert answer.answer == INSUFFICIENT_ANSWER_ES
    assert "Razonamiento privado" not in answer.answer
    assert answer.confidence == "insufficient"
    assert answer.citations == []
    assert UNSUPPORTED_CITATIONS_WARNING_ES in answer.warnings


async def test_spanish_relationship_answer_cites_normalized_edge() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {
                    "id": "ley-100",
                    "label": "Ley 100 de 1993",
                    "type": "law",
                    "source": "ley-100.md",
                },
                {
                    "id": "pensiones",
                    "label": "Sistema General de Pensiones",
                    "type": "system",
                    "source": "ley-100.md",
                },
            ],
            "edges": [
                {
                    "id": "regula",
                    "sourceNodeId": "ley-100",
                    "targetNodeId": "pensiones",
                    "relationship": "REGULA",
                    "properties": {
                        "context": "La Ley 100 regula el sistema de pensiones."
                    },
                    "provenance": "explicit",
                }
            ],
            "paths": [],
            "citations": [],
        }
    )
    workflow = KnowledgeWorkflow(graph, DeterministicModel())

    answer = await workflow.invoke(
        "¿Cómo se relaciona la Ley 100 de 1993 con el sistema de pensiones?",
        "request-relationship",
        "conversation-relationship",
    )

    assert answer.answer.startswith(
        "Ley 100 de 1993 se relaciona con Sistema General de Pensiones mediante REGULA."
    )
    assert 2 <= len(answer.answer.split("\n\n")) <= 4
    assert answer.citations[0].id == "edge:regula"
    assert answer.citations[0].relationship == "REGULA"
    assert answer.citations[0].provenance == "explicit"


async def test_citation_for_node_outside_evidence_limit_is_not_allowlisted() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {"id": "n1", "label": "Ley 100", "type": "law"},
                {"id": "n2", "label": "Ley 2381", "type": "law"},
            ],
            "edges": [],
            "paths": [],
            "citations": [
                {
                    "id": "c-truncated",
                    "title": "Ley 2381",
                    "source": "ley-2381.md",
                    "nodeId": "n2",
                    "provenance": "explicit",
                }
            ],
        }
    )
    model = DeterministicModel(
        answer=AnswerDraft(
            answer="La Ley 2381 dispone algo.",
            confidence="high",
            citation_ids=["c-truncated"],
        )
    )
    workflow = KnowledgeWorkflow(graph, model, WorkflowLimits(max_nodes=1))

    answer = await workflow.invoke(
        "¿Qué dice la Ley 2381?", "request-limit", "conversation-limit"
    )

    assert answer.confidence == "insufficient"
    assert answer.citations == []
    assert {node.id for node in answer.graph_evidence.nodes} == {"n1"}


async def test_english_mock_answer_remains_english() -> None:
    graph = RecordingGraph(
        {
            "nodes": [
                {
                    "id": "n1",
                    "label": "Pension law",
                    "type": "law",
                    "source": "law.md",
                    "excerpt": "The law defines the pension system.",
                    "provenance": "explicit",
                }
            ],
            "edges": [],
            "paths": [],
            "citations": [
                {
                    "id": "c1",
                    "title": "Pension law",
                    "source": "law.md",
                    "nodeId": "n1",
                    "provenance": "explicit",
                }
            ],
        }
    )
    workflow = KnowledgeWorkflow(graph, DeterministicModel())

    answer = await workflow.invoke(
        "What does the pension law establish?",
        "request-3",
        "conversation-3",
    )

    assert answer.answer.startswith("According to Pension law")
