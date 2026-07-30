from __future__ import annotations

import re
from typing import Any

from app.agent.workflow import KnowledgeWorkflow
from app.integrations.haystack import RetrievalScope
from app.integrations.llm.models import AnswerDraft, ModelResult, TokenUsage
from app.knowledge.source_index import SourcePassage


class ArticleGraph:
    async def search(self, query: str) -> dict[str, Any]:
        return {
            "nodes": [
                {
                    "id": "article-49",
                    "label": "Artículo 49 de la Ley 2381 de 2024",
                    "type": "legal_article",
                    "source": "ley-2381-de-2024.md",
                    "provenance": "explicit",
                }
            ],
            "edges": [],
            "paths": [],
            "graphVersion": "v1",
        }

    async def get_neighbors(self, node_id: str, depth: int = 1) -> dict[str, Any]:
        return {"nodes": [], "edges": [], "paths": []}


class RecordingSourceRetriever:
    def __init__(self, passages: list[SourcePassage]) -> None:
        self.passages = passages
        self.scopes: list[RetrievalScope] = []

    async def retrieve(
        self, query: str, scope: RetrievalScope, *, top_k: int = 8
    ) -> list[SourcePassage]:
        self.scopes.append(scope)
        return self.passages


class SourceCitingModel:
    async def generate(self, request: Any) -> ModelResult:
        prompt = request.messages[-1].content
        source_ids = re.findall(
            r'"kind":"source_passage","evidenceId":"([^"]+)"', prompt
        )
        return ModelResult(
            output=AnswerDraft(
                answer=(
                    "El Artículo 49 incluye al cónyuge o compañero permanente, "
                    "hijos, padres y hermanos inválidos o menores dependientes."
                ),
                confidence="high",
                citation_ids=source_ids,
            ),
            model="test",
            usage=TokenUsage(),
        )


def passage(identifier: str, paragraph: str, text: str) -> SourcePassage:
    return SourcePassage(
        id=identifier,
        document="ley-2381-de-2024.md",
        article="49",
        paragraph=paragraph,
        text=text,
        start_line=840,
        end_line=841,
        checksum="a" * 64,
        graph_version="v1",
    )


async def test_article_answer_uses_bounded_source_citations() -> None:
    source = RecordingSourceRetriever(
        [
            passage("source:spouse", "d)", "El cónyuge o compañero permanente."),
            passage("source:children", "f)", "Los hijos menores o dependientes."),
            passage("source:parents", "g)", "Los padres dependientes."),
            passage("source:siblings", "h)", "Los hermanos inválidos o menores."),
        ]
    )
    workflow = KnowledgeWorkflow(
        ArticleGraph(), SourceCitingModel(), source_retriever=source
    )

    answer = await workflow.invoke(
        "¿Qué establece el Artículo 49 sobre los beneficiarios?",
        "request",
        "conversation",
    )

    assert answer.response_type == "answer"
    assert source.scopes == [
        RetrievalScope(documents=["ley-2381-de-2024.md"], articles=["49"])
    ]
    assert {citation.id for citation in answer.citations} == {
        "source:spouse",
        "source:children",
        "source:parents",
        "source:siblings",
    }
    assert all(citation.provenance == "explicit" for citation in answer.citations)
    assert all(
        citation.document == "ley-2381-de-2024.md" for citation in answer.citations
    )


async def test_article_without_source_excerpt_is_insufficient() -> None:
    workflow = KnowledgeWorkflow(
        ArticleGraph(),
        SourceCitingModel(),
        source_retriever=RecordingSourceRetriever([]),
    )

    answer = await workflow.invoke(
        "Según el Artículo 49, ¿quiénes son los posibles beneficiarios?",
        "request",
        "conversation",
    )

    assert answer.response_type == "insufficient"
    assert answer.citations == []
    assert any("pasaje" in warning for warning in answer.warnings)


async def test_sse_emits_normalized_source_citations_only() -> None:
    source = RecordingSourceRetriever(
        [passage("source:spouse", "d)", "El cónyuge o compañero permanente.")]
    )
    workflow = KnowledgeWorkflow(
        ArticleGraph(), SourceCitingModel(), source_retriever=source
    )

    events = [
        event
        async for event in workflow.stream(
            "¿Qué establece el Artículo 49 sobre beneficiarios?",
            "request",
            "conversation",
        )
    ]
    citations = [event for event in events if event.type == "citation.available"]

    assert len(citations) == 1
    payload = citations[0].to_payload()["citation"]
    assert payload["id"] == "source:spouse"
    assert payload["document"] == "ley-2381-de-2024.md"
    assert payload["article"] == "49"
    assert "score" not in payload
    assert "meta" not in payload
