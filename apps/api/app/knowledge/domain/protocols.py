"""Ports exposed by the knowledge ingestion domain."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .models import IngestionCommand, KnowledgeSnapshot


@runtime_checkable
class KnowledgeDocumentSource(Protocol):
    """Produce one validated immutable snapshot without exposing storage details."""

    async def snapshot(self, command: IngestionCommand) -> KnowledgeSnapshot: ...
