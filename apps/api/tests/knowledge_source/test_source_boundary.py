from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config.settings import Settings
from app.knowledge.domain import (
    IngestionCommand,
    KnowledgeDocumentSource,
    KnowledgeSnapshot,
)
from app.knowledge.service.ingestion import KnowledgeIngestionService
from app.knowledge.sources import FilesystemDocumentSource, SourceValidationError


class AsyncSource:
    def __init__(self, snapshot: KnowledgeSnapshot) -> None:
        self.value = snapshot
        self.commands: list[IngestionCommand] = []

    async def snapshot(self, command: IngestionCommand) -> KnowledgeSnapshot:
        self.commands.append(command)
        return self.value


class FailedProcess:
    returncode = 1

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"", b""


def create_input(root: Path) -> None:
    root.mkdir(parents=True)
    (root / "law.md").write_text("Law", encoding="utf-8")


def settings(tmp_path: Path) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        knowledge_input_dir=str(tmp_path / "unused-input"),
        knowledge_staging_dir=str(tmp_path / "staging"),
        knowledge_graph_dir=str(tmp_path / "graph"),
        knowledge_archive_dir=str(tmp_path / "archive"),
        knowledge_failed_dir=str(tmp_path / "failed"),
        knowledge_manifest_path=str(tmp_path / "state" / "manifest.json"),
        knowledge_ingest_on_startup=False,
    )


async def test_filesystem_source_implements_async_snapshot_port(
    tmp_path: Path,
) -> None:
    (tmp_path / "ley-100.md").write_text("Contenido válido.", encoding="utf-8")
    source = FilesystemDocumentSource(tmp_path)

    snapshot = await source.snapshot(
        IngestionCommand(projectId="laws", sourceType="filesystem")
    )

    assert isinstance(source, KnowledgeDocumentSource)
    assert snapshot.documents[0].relative_path == "ley-100.md"
    assert snapshot.documents[0].content == "Contenido válido."
    assert snapshot.documents[0].bytes == len("Contenido válido.".encode())
    assert len(snapshot.documents[0].sha256) == 64


async def test_filesystem_source_rejects_mismatched_source_type(
    tmp_path: Path,
) -> None:
    (tmp_path / "law.md").write_text("Law", encoding="utf-8")

    with pytest.raises(SourceValidationError):
        await FilesystemDocumentSource(tmp_path).snapshot(
            IngestionCommand(sourceType="upload")
        )


async def test_service_uses_injected_source_and_forwards_typed_command(
    tmp_path: Path,
) -> None:
    filesystem = FilesystemDocumentSource(tmp_path)
    tmp_path.joinpath("law.md").write_text("Law", encoding="utf-8")
    expected = filesystem.discover()
    source = AsyncSource(expected)
    service = KnowledgeIngestionService(
        settings(tmp_path), logging.getLogger("test"), source=source
    )
    command = IngestionCommand(
        requestedBy="operator@example.test",
        tenantId="tenant-1",
        projectId="laws",
        permissions=("knowledge:ingest",),
        sourceType="object_storage",
    )

    actual = await service._load_snapshot(command)

    assert actual == expected
    assert source.commands == [command]
    assert service._source() is source


def test_graphify_subprocess_environment_excludes_unrelated_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("LLM_API_KEY", "must-not-leak")
    monkeypatch.setenv("GRAPHIFY_ADMIN_TOKEN", "must-not-leak")
    monkeypatch.setenv("OPENAI_API_KEY", "extractor-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://models.example.test/v1")
    monkeypatch.setenv("PATH", "/safe/bin")

    environment = KnowledgeIngestionService._graphify_environment()

    assert environment["OPENAI_API_KEY"] == "extractor-key"
    assert environment["OPENAI_BASE_URL"] == "https://models.example.test/v1"
    assert environment["PATH"] == "/safe/bin"
    assert "LLM_API_KEY" not in environment
    assert "GRAPHIFY_ADMIN_TOKEN" not in environment


async def test_subprocess_isolated_from_stdio_cwd_and_process_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = settings(tmp_path)
    input_root = Path(configured.knowledge_input_dir)
    create_input(input_root)
    service = KnowledgeIngestionService(configured, logging.getLogger("test"))
    monkeypatch.setenv("LLM_API_KEY", "must-not-leak")
    captured: dict[str, object] = {}

    async def subprocess(*command: object, **kwargs: object) -> FailedProcess:
        captured["command"] = command
        captured.update(kwargs)
        return FailedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)

    with pytest.raises(RuntimeError, match="Knowledge ingestion failed"):
        await service.run_now()

    assert captured["stdin"] is asyncio.subprocess.DEVNULL
    assert captured["stdout"] is asyncio.subprocess.PIPE
    assert captured["stderr"] is asyncio.subprocess.PIPE
    assert captured["close_fds"] is True
    assert Path(str(captured["cwd"])).name.startswith("20")
    environment = captured["env"]
    assert isinstance(environment, dict)
    assert "LLM_API_KEY" not in environment


async def test_graphify_staging_preserves_original_binary_bytes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured = settings(tmp_path)
    raw = b"%PDF-1.4\r\noriginal\x00bytes"
    snapshot = SimpleNamespace(
        source_version="source-binary",
        total_bytes=len(raw),
        documents=(
            SimpleNamespace(
                relative_path="source.pdf",
                content="Normalized extracted text",
                raw_bytes=raw,
                sha256="a" * 64,
                bytes=len(raw),
                modified_at=datetime(2026, 1, 1, tzinfo=UTC),
                media_type="application/pdf",
                profile="generic",
            ),
        ),
    )
    service = KnowledgeIngestionService(
        configured,
        logging.getLogger("test"),
        source=AsyncSource(snapshot),
    )

    async def failed(*args: object, **kwargs: object) -> FailedProcess:
        del args, kwargs
        return FailedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", failed)
    with pytest.raises(RuntimeError, match="Knowledge ingestion failed"):
        await service.run_now(force=True)

    staged = next(
        Path(configured.knowledge_failed_dir).glob(  # noqa: ASYNC240
            "*/source/source.pdf"
        )
    )
    assert staged.read_bytes() == raw


def test_change_set_classifies_paths_deterministically_without_host_paths() -> None:
    old = {
        "documents": [
            {"relativePath": "removed.md", "sha256": "r" * 64},
            {"relativePath": "same.md", "sha256": "s" * 64},
            {"relativePath": "changed.md", "sha256": "o" * 64},
        ]
    }
    current = SimpleNamespace(
        documents=(
            SimpleNamespace(relative_path="new.md", sha256="n" * 64),
            SimpleNamespace(relative_path="same.md", sha256="s" * 64),
            SimpleNamespace(relative_path="changed.md", sha256="c" * 64),
        )
    )

    changes = KnowledgeIngestionService._change_set(current, old)

    assert changes.added == ("new.md",)
    assert changes.changed == ("changed.md",)
    assert changes.unchanged == ("same.md",)
    assert changes.removed == ("removed.md",)
    assert all(
        not path.startswith("/")
        for paths in changes.model_dump().values()
        for path in paths
    )


def test_manifest_records_removed_path_and_keeps_document_checksums(
    tmp_path: Path,
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    snapshot = SimpleNamespace(
        source_version="new-source",
        documents=(
            SimpleNamespace(
                relative_path="same.md",
                sha256="s" * 64,
                bytes=4,
                modified_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
        ),
    )
    old = {
        "activeGraphVersion": "v1",
        "previousGraphVersion": None,
        "generatedAt": "2026-01-01T00:00:00+00:00",
        "documents": [
            {"relativePath": "same.md", "sha256": "s" * 64},
            {"relativePath": "removed.md", "sha256": "r" * 64},
        ],
    }

    manifest = service._manifest(
        snapshot,
        "ingestion-2",
        "running",
        datetime(2026, 1, 2, tzinfo=UTC),
        None,
        None,
        old,
    )

    assert manifest["changes"] == {
        "added": [],
        "changed": [],
        "unchanged": ["same.md"],
        "removed": ["removed.md"],
    }
    assert manifest["processingFingerprint"] == (
        service.settings.knowledge_processing_fingerprint
    )
    assert manifest["documents"] == [
        {
            "relativePath": "same.md",
            "sha256": "s" * 64,
            "sizeBytes": 4,
            "modifiedAt": "2026-01-01T00:00:00+00:00",
            "mediaType": "text/markdown",
            "profile": "generic",
        }
    ]
