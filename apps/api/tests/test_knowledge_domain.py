from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.knowledge.domain import (
    ActivePointer,
    ArtifactDescriptor,
    BuildCounts,
    BuildFailure,
    GraphBuildManifest,
    GraphifyFormat,
    IngestionCommand,
    KnowledgeChangeSet,
)
from app.knowledge.sources import (
    FilesystemDocumentSource,
    SourceLimitError,
    SourceValidationError,
)
from app.knowledge.state import (
    GenerationConflictError,
    ImmutableManifestError,
    KnowledgeStateRepository,
    LockTimeoutError,
    ProcessFileLock,
)


def write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def manifest(version: str = "v1") -> GraphBuildManifest:
    return GraphBuildManifest(
        projectId="sample-project",
        graphVersion=version,
        sourceVersion="source-v1",
        createdAt=datetime.now(UTC),
        graphifyFormat=GraphifyFormat(producerVersion="1.0"),
        artifact=ArtifactDescriptor(
            relativePath="graph.json", sha256="a" * 64, bytes=10
        ),
        counts=BuildCounts(nodes=1, edges=0, sources=1),
    )


def test_filesystem_discovery_is_recursive_filtered_and_deterministic(
    tmp_path: Path,
) -> None:
    write(tmp_path / "z.md", b"Z")
    write(tmp_path / "nested" / "a.MD", "héllo".encode())
    write(tmp_path / ".hidden.md", b"hidden")
    write(tmp_path / "draft.md~", b"temp")
    write(tmp_path / "included.txt", b"text")
    os.symlink(tmp_path / "z.md", tmp_path / "linked.md")

    first = FilesystemDocumentSource(tmp_path).discover()
    second = FilesystemDocumentSource(tmp_path).discover()
    assert [item.relative_path for item in first.documents] == [
        "included.txt",
        "nested/a.MD",
        "z.md",
    ]
    assert first.source_version == second.source_version
    assert first.documents[1].content == "héllo"
    assert all(len(item.sha256) == 64 for item in first.documents)


def test_content_change_changes_source_version(tmp_path: Path) -> None:
    write(tmp_path / "a.md", b"one")
    first = FilesystemDocumentSource(tmp_path).discover()
    write(tmp_path / "a.md", b"two")
    second = FilesystemDocumentSource(tmp_path).discover()
    assert first.source_version != second.source_version


@pytest.mark.parametrize(
    ("content", "kwargs", "error"),
    [
        (b"\xff", {}, SourceValidationError),
        (b"large", {"max_document_bytes": 4}, SourceLimitError),
    ],
)
def test_invalid_or_large_document_is_rejected(
    tmp_path: Path,
    content: bytes,
    kwargs: dict[str, int],
    error: type[Exception],
) -> None:
    write(tmp_path / "bad.md", content)
    with pytest.raises(error):
        FilesystemDocumentSource(tmp_path, **kwargs).discover()


def test_document_count_and_total_size_limits(tmp_path: Path) -> None:
    write(tmp_path / "a.md", b"123")
    write(tmp_path / "b.md", b"456")
    with pytest.raises(SourceLimitError):
        FilesystemDocumentSource(tmp_path, max_documents=1).discover()
    with pytest.raises(SourceLimitError):
        FilesystemDocumentSource(tmp_path, max_total_bytes=5).discover()


def test_manifest_is_immutable_and_idempotent(tmp_path: Path) -> None:
    repository = KnowledgeStateRepository(tmp_path)
    original = manifest()
    target = repository.save_manifest(original)
    assert target.exists()
    assert repository.load_manifest("v1") == original
    assert repository.save_manifest(original) == target
    with pytest.raises(ImmutableManifestError):
        repository.save_manifest(
            original.model_copy(update={"source_version": "different"})
        )


def test_active_pointer_uses_generation_comparison(tmp_path: Path) -> None:
    repository = KnowledgeStateRepository(tmp_path)
    repository.save_manifest(manifest())
    pointer = ActivePointer(
        projectId="sample-project",
        graphVersion="v1",
        generation=1,
        activatedAt=datetime.now(UTC),
        activatedBy="test",
    )
    repository.compare_and_set_active(pointer, expected_generation=0)
    assert repository.load_active() == pointer
    with pytest.raises(GenerationConflictError):
        repository.compare_and_set_active(
            pointer.model_copy(update={"generation": 2}), expected_generation=0
        )


def test_failure_state_round_trip_and_clear(tmp_path: Path) -> None:
    repository = KnowledgeStateRepository(tmp_path)
    failure = BuildFailure(
        projectId="sample-project",
        category="validation_failed",
        message="  safe   summary\nonly ",
        failedAt=datetime.now(UTC),
    )
    repository.save_failure(failure)
    loaded = repository.load_failure()
    assert loaded is not None
    assert loaded.message == "safe summary only"
    repository.clear_failure()
    assert repository.load_failure() is None


def test_process_lock_times_out_when_held(tmp_path: Path) -> None:
    path = tmp_path / "state.lock"
    with ProcessFileLock(path):
        with pytest.raises(LockTimeoutError):
            with ProcessFileLock(path, timeout_seconds=0):
                pass


def test_ingestion_command_carries_bounded_future_context() -> None:
    command = IngestionCommand(
        requestedBy="operator@example.test",
        tenantId="tenant-1",
        projectId="laws-co",
        permissions=("knowledge:ingest", "knowledge:publish"),
        sourceType="object_storage",
    )

    assert command.requested_by == "operator@example.test"
    assert command.tenant_id == "tenant-1"
    assert command.project_id == "laws-co"
    assert command.permissions == ("knowledge:ingest", "knowledge:publish")
    assert command.source_type == "object_storage"


@pytest.mark.parametrize(
    "values",
    [
        {"projectId": "../other"},
        {"tenantId": "tenant/other"},
        {"permissions": ("knowledge:ingest", "knowledge:ingest")},
        {"permissions": ("knowledge ingest",)},
        {"requestedBy": "operator\nforged"},
        {"sourceType": "shell"},
        {"unknown": "not-allowed"},
    ],
)
def test_ingestion_command_rejects_unsafe_or_unknown_context(
    values: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        IngestionCommand.model_validate(values)


def test_change_set_requires_sorted_disjoint_source_relative_paths() -> None:
    changes = KnowledgeChangeSet(
        added=("new.md",),
        changed=("changed.md",),
        unchanged=("same.md",),
        removed=("removed.md",),
    )
    assert changes.removed == ("removed.md",)

    with pytest.raises(ValueError):
        KnowledgeChangeSet(added=("b.md", "a.md"))
    with pytest.raises(ValueError):
        KnowledgeChangeSet(added=("same.md",), removed=("same.md",))
    with pytest.raises(ValueError):
        KnowledgeChangeSet(removed=("/host/private.md",))
