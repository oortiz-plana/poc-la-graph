"""Bridge between durable scoped leaves and Haystack BM25/auto-merging."""

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
        from haystack.components.retrievers.auto_merging_retriever import (
            AutoMergingRetriever,
        )
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
                        "__parent_id": passage.parent_id,
                        "__children_ids": list(passage.children_ids),
                        "__level": passage.level,
                        "__block_size": passage.token_count,
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
        standalone = [passage for passage in selected if passage.standalone]
        hierarchical = [
            passage
            for passage in selected
            if not passage.standalone and passage.parent_id is not None
        ]
        if not hierarchical:
            return standalone[:top_k]

        parent_ids = sorted(
            {passage.parent_id for passage in hierarchical if passage.parent_id}
        )
        parents = self.index.parents(
            graph_version=self.graph_version, parent_ids=parent_ids
        )
        parent_by_id = {passage.id: passage for passage in parents}
        unresolved = [
            passage for passage in hierarchical if passage.parent_id not in parent_by_id
        ]
        leaf_by_id = {passage.id: passage for passage in hierarchical}
        child_scores: dict[str, list[float]] = {}
        for passage in hierarchical:
            if passage.parent_id and passage.score is not None:
                child_scores.setdefault(passage.parent_id, []).append(passage.score)

        merged: list[SourcePassage] = []
        thresholds = sorted({item.auto_merge_threshold for item in hierarchical})
        for threshold in thresholds:
            group = [
                item
                for item in hierarchical
                if item.auto_merge_threshold == threshold
                and item.parent_id in parent_by_id
            ]
            group_parent_ids = {item.parent_id for item in group}
            parent_store = InMemoryDocumentStore()
            parent_store.write_documents(
                [
                    Document(
                        id=parent.id,
                        content=parent.text,
                        meta={
                            "document": parent.document,
                            "__parent_id": parent.parent_id,
                            "__children_ids": list(parent.children_ids),
                            "__level": parent.level,
                            "__block_size": parent.token_count,
                        },
                    )
                    for parent in parents
                    if parent.id in group_parent_ids
                ]
            )
            auto_merger = AutoMergingRetriever(
                document_store=parent_store, threshold=threshold
            )
            result = auto_merger.run(
                documents=[
                    Document(
                        id=item.id,
                        content=item.text,
                        score=item.score,
                        meta={
                            "__parent_id": item.parent_id,
                            "__children_ids": [],
                            "__level": item.level,
                            "__block_size": item.token_count,
                        },
                    )
                    for item in group
                ]
            )
            for document in result["documents"]:
                if document.id in parent_by_id:
                    scores = child_scores.get(document.id, [])
                    merged.append(
                        parent_by_id[document.id].model_copy(
                            update={"score": max(scores) if scores else None}
                        )
                    )
                elif document.id in leaf_by_id:
                    merged.append(leaf_by_id[document.id])

        combined = standalone + unresolved + merged
        deduplicated = {item.id: item for item in combined}
        return sorted(
            deduplicated.values(),
            key=lambda item: (item.score is not None, item.score or 0.0, item.id),
            reverse=True,
        )[:top_k]


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(
        character for character in normalized if not unicodedata.combining(character)
    )
