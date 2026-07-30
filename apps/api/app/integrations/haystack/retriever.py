"""Bridge between the durable SQLite index and Haystack BM25."""

from __future__ import annotations

import os
import unicodedata
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.knowledge.source_index import SourceIndex, SourcePassage


class RetrievalScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: list[str] = Field(default_factory=list)
    articles: list[str] = Field(default_factory=list)


class SourceRetriever(Protocol):
    async def retrieve(
        self, query: str, scope: RetrievalScope, *, top_k: int = 8
    ) -> list[SourcePassage]: ...


class HaystackSourceRetriever:
    """Instantiate an ephemeral BM25 store from a strictly scoped SQLite slice."""

    def __init__(self, index_path: str, graph_version: str) -> None:
        self.index = SourceIndex(index_path)
        self.graph_version = graph_version

    async def retrieve(
        self, query: str, scope: RetrievalScope, *, top_k: int = 8
    ) -> list[SourcePassage]:
        passages = self.index.search(
            query,
            graph_version=self.graph_version,
            documents=scope.documents,
            articles=scope.articles,
        )
        if not passages:
            return []

        # Imports stay inside the adapter so provider objects never cross its
        # boundary and graph-only requests can still run if Haystack is absent.
        os.environ.setdefault("HAYSTACK_TELEMETRY_ENABLED", "False")
        from haystack import Document
        from haystack.components.retrievers.in_memory import InMemoryBM25Retriever
        from haystack.document_stores.in_memory import InMemoryDocumentStore

        by_id = {passage.id: passage for passage in passages}
        store = InMemoryDocumentStore()
        store.write_documents(
            [
                Document(
                    id=passage.id,
                    # Keep the original passage and append a folded lexical form
                    # so accented and unaccented Spanish queries rank alike.
                    content=f"{passage.text}\n{_fold(passage.text)}",
                    meta={
                        "document": passage.document,
                        "article": passage.article,
                        "paragraph": passage.paragraph,
                        "start_line": passage.start_line,
                        "end_line": passage.end_line,
                        "checksum": passage.checksum,
                        "graph_version": passage.graph_version,
                    },
                )
                for passage in passages
            ]
        )
        retriever = InMemoryBM25Retriever(document_store=store, top_k=top_k)
        result = retriever.run(query=_fold(query))
        selected: list[SourcePassage] = []
        for document in result["documents"]:
            passage = by_id.get(document.id)
            if passage is not None:
                selected.append(passage.model_copy(update={"score": document.score}))
        beneficiary_article = _beneficiary_article_passages(
            query, selected, passages, top_k
        )
        if beneficiary_article:
            return beneficiary_article
        return selected


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    )


def _beneficiary_article_passages(
    query: str,
    ranked: list[SourcePassage],
    candidates: list[SourcePassage],
    top_k: int,
) -> list[SourcePassage]:
    """Keep beneficiary lists together after BM25 selects their best article."""
    if "beneficiari" not in _fold(query).casefold():
        return []
    anchor = next(
        (
            passage
            for passage in ranked
            if passage.article
            and "beneficiari" in _fold(passage.text).casefold()
            and "muerte" in _fold(passage.text).casefold()
        ),
        None,
    )
    if anchor is None:
        return []
    article = [
        passage
        for passage in candidates
        if passage.document == anchor.document and passage.article == anchor.article
    ]
    article.sort(key=lambda passage: passage.start_line)
    return article[:top_k]
