"""Typed, Graphify-independent knowledge ingestion domain."""

from .models import (
    ActivePointer,
    ArtifactDescriptor,
    BuildCounts,
    BuildFailure,
    GraphBuildManifest,
    GraphifyFormat,
    IngestionCommand,
    KnowledgeChangeSet,
    KnowledgeDocument,
    KnowledgeSnapshot,
)
from .protocols import KnowledgeDocumentSource

__all__ = [
    "ActivePointer",
    "ArtifactDescriptor",
    "BuildCounts",
    "BuildFailure",
    "GraphBuildManifest",
    "GraphifyFormat",
    "IngestionCommand",
    "KnowledgeChangeSet",
    "KnowledgeDocument",
    "KnowledgeDocumentSource",
    "KnowledgeSnapshot",
]
