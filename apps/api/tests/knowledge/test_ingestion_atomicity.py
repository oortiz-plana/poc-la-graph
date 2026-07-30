from __future__ import annotations

import asyncio
import json
import logging
import multiprocessing
import os
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.config.settings import Settings
from app.knowledge.service import IngestionConflict, KnowledgeIngestionService
from app.knowledge.sources import SourceValidationError
from app.knowledge.state.lock import ProcessFileLock


def configured(tmp_path: Path) -> Settings:
    return Settings(
        llm_adapter="mock",
        graphify_adapter="mock",
        knowledge_input_dir=str(tmp_path / "input"),
        knowledge_staging_dir=str(tmp_path / "staging"),
        knowledge_graph_dir=str(tmp_path / "graph"),
        knowledge_archive_dir=str(tmp_path / "archive"),
        knowledge_failed_dir=str(tmp_path / "failed"),
        knowledge_manifest_path=str(tmp_path / "state" / "manifest.json"),
        knowledge_ingest_on_startup=False,
        knowledge_max_document_size_bytes=1024,
    )


def source_snapshot(version: str = "source-v1") -> Any:
    return SimpleNamespace(
        source_version=version,
        documents=(
            SimpleNamespace(
                relative_path="fact.md",
                content="Fact",
                sha256="a" * 64,
                bytes=4,
                modified_at=datetime(2026, 1, 1, tzinfo=UTC),
            ),
        ),
    )


class Source:
    def __init__(self, value: Any) -> None:
        self.value = value

    def discover(self) -> Any:
        return self.value


class Process:
    def __init__(self, returncode: int = 0) -> None:
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"", b""


def hold_lock(path: str, ready: Any, release: Any) -> None:
    with ProcessFileLock(path):
        ready.set()
        release.wait(10)


def seed_manifest(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def read_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


async def test_cross_process_conflict_does_not_mutate_manifest(
    tmp_path: Path,
) -> None:
    settings = configured(tmp_path)
    manifest_path = Path(settings.knowledge_manifest_path)
    original = {"schemaVersion": 1, "lastIngestion": {"status": "completed"}}
    seed_manifest(manifest_path, original)
    context = multiprocessing.get_context("fork")
    ready = context.Event()
    release = context.Event()
    process = context.Process(
        target=hold_lock,
        args=(str(manifest_path.with_suffix(".lock")), ready, release),
    )
    process.start()
    try:
        assert ready.wait(5)
        service = KnowledgeIngestionService(settings, logging.getLogger("test"))
        with pytest.raises(IngestionConflict):
            await service.start()
        assert read_manifest(manifest_path) == original
    finally:
        release.set()
        process.join(5)
        if process.is_alive():
            process.terminate()
            process.join()


async def test_in_process_conflict_is_detected_before_second_state_write(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(configured(tmp_path), logging.getLogger("test"))
    entered = asyncio.Event()
    release = asyncio.Event()

    async def run(identifier: str, *, force: bool) -> None:
        del identifier, force
        entered.set()
        await release.wait()

    monkeypatch.setattr(service, "_run", run)
    await service.start()
    await entered.wait()
    with pytest.raises(IngestionConflict):
        await service.start()
    release.set()
    assert service._task is not None
    await service._task


def create_version(root: Path, version: str) -> Path:
    target = root / "versions" / version
    target.mkdir(parents=True)
    (target / "graph.json").write_text(
        '{"nodes":[{"id":"n"}],"links":[]}', encoding="utf-8"
    )
    return target


def test_rollback_uses_same_process_lock(tmp_path: Path) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    graph_root = Path(settings.knowledge_graph_dir)
    current = create_version(graph_root, "v2")
    create_version(graph_root, "v1")
    service._activate(current)
    manifest = {
        "schemaVersion": 1,
        "activeGraphVersion": "v2",
        "previousGraphVersion": "v1",
        "lastIngestion": {"status": "completed"},
    }
    service._write_manifest(manifest)
    with ProcessFileLock(Path(settings.knowledge_manifest_path).with_suffix(".lock")):
        with pytest.raises(IngestionConflict):
            service.rollback()
    assert os.readlink(graph_root / "active") == "versions/v2"
    assert service.manifest()["activeGraphVersion"] == "v2"


async def test_failed_build_preserves_active_graph_and_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    graph_root = Path(settings.knowledge_graph_dir)
    current = create_version(graph_root, "v1")
    service._activate(current)
    prior = service._manifest(
        source_snapshot("old"),
        "old-job",
        "completed",
        datetime.now(UTC),
        datetime.now(UTC),
        None,
        None,
        active_version="v1",
    )
    service._write_manifest(prior)
    monkeypatch.setattr(service, "_source", lambda: Source(source_snapshot("new")))

    async def failed(*command: object, **kwargs: object) -> Process:
        del command, kwargs
        return Process(returncode=2)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", failed)
    with pytest.raises(RuntimeError, match="Knowledge ingestion failed"):
        await service.run_now(force=True)
    assert os.readlink(graph_root / "active") == "versions/v1"
    assert service.active_graph_path().is_file()
    assert service.manifest()["activeGraphVersion"] == "v1"
    assert service.current()["status"] == "failed"


async def test_unchanged_inputs_skip_build_under_lock(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    graph_root = Path(settings.knowledge_graph_dir)
    current = create_version(graph_root, "v1")
    service._activate(current)
    snap = source_snapshot()
    prior = service._manifest(
        snap,
        "old-job",
        "completed",
        datetime.now(UTC),
        datetime.now(UTC),
        None,
        None,
        active_version="v1",
    )
    service._write_manifest(prior)
    monkeypatch.setattr(service, "_source", lambda: Source(snap))

    async def forbidden(*args: object, **kwargs: object) -> Process:
        raise AssertionError("Graphify must not run for unchanged input")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", forbidden)
    with caplog.at_level(logging.INFO):
        await service.run_now()
    assert service.current()["status"] == "completed"
    assert service.manifest()["activeGraphVersion"] == "v1"
    assert os.readlink(graph_root / "active") == "versions/v1"
    skipped = next(
        record
        for record in caplog.records
        if record.message == "knowledge_ingestion_skipped"
    )
    assert skipped.graph_version == "v1"
    assert skipped.document_count == 1
    assert isinstance(skipped.duration_ms, int)


def test_atomic_manifest_readers_never_observe_partial_json(tmp_path: Path) -> None:
    service = KnowledgeIngestionService(configured(tmp_path), logging.getLogger("test"))
    failures: list[Exception] = []
    stopped = threading.Event()

    def reader() -> None:
        while not stopped.is_set():
            try:
                value = service.manifest()
                if value is not None:
                    assert value["schemaVersion"] == 1
            except Exception as exc:
                failures.append(exc)
                stopped.set()

    thread = threading.Thread(target=reader)
    thread.start()
    try:
        for generation in range(100):
            service._write_manifest(
                {
                    "schemaVersion": 1,
                    "generation": generation,
                    "lastIngestion": {"status": "completed"},
                }
            )
    finally:
        stopped.set()
        thread.join(5)
    assert failures == []


def test_manifest_reader_rejects_symlink_state(tmp_path: Path) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    external = tmp_path / "external.json"
    external.write_text(
        '{"schemaVersion":1,"lastIngestion":{"status":"completed"}}',
        encoding="utf-8",
    )
    manifest = Path(settings.knowledge_manifest_path)
    manifest.parent.mkdir(parents=True)
    manifest.symlink_to(external)
    assert service.manifest() is None


async def test_background_source_failure_is_durable_and_preserves_active(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    graph_root = Path(settings.knowledge_graph_dir)
    active_version = create_version(graph_root, "v1")
    service._activate(active_version)
    previous = service._manifest(
        source_snapshot("old"),
        "old-job",
        "completed",
        datetime.now(UTC),
        datetime.now(UTC),
        None,
        None,
        active_version="v1",
    )
    service._write_manifest(previous)

    class InvalidSource:
        def discover(self) -> Any:
            raise SourceValidationError("private filename must not escape")

    monkeypatch.setattr(service, "_source", InvalidSource)
    with caplog.at_level(logging.INFO):
        await service.start(force=True)
        assert service._task is not None
        await service._task
    assert service.current()["status"] == "failed"
    assert service.current()["errorCode"] == "source_invalid"
    assert "private filename" not in json.dumps(service.current())
    assert service.manifest()["activeGraphVersion"] == "v1"
    assert os.readlink(graph_root / "active") == "versions/v1"
    assert service.graph_status()["status"] == "ready"
    failure = next(
        record
        for record in caplog.records
        if record.message == "knowledge_ingestion_failed"
    )
    assert failure.error_type == "source_invalid"
    assert failure.document_count == 0
    assert "private filename" not in failure.getMessage()


def test_manifest_write_allocates_one_temporary_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(configured(tmp_path), logging.getLogger("test"))
    original = tempfile.mkstemp
    allocations: list[str] = []

    def tracked(*args: Any, **kwargs: Any) -> tuple[int, str]:
        descriptor, name = original(*args, **kwargs)
        allocations.append(name)
        return descriptor, name

    monkeypatch.setattr(tempfile, "mkstemp", tracked)
    service._write_manifest(
        {"schemaVersion": 1, "lastIngestion": {"status": "completed"}}
    )
    assert len(allocations) == 1
    assert not Path(allocations[0]).exists()


def test_external_active_symlink_is_not_considered_or_preserved(
    tmp_path: Path,
) -> None:
    settings = configured(tmp_path)
    service = KnowledgeIngestionService(settings, logging.getLogger("test"))
    external = tmp_path / "outside"
    external.mkdir()
    (external / "graph.json").write_text(
        '{"nodes":[{"id":"outside"}],"links":[]}', encoding="utf-8"
    )
    graph_root = Path(settings.knowledge_graph_dir)
    graph_root.mkdir()
    (graph_root / "active").symlink_to(external, target_is_directory=True)
    service._write_manifest(
        {
            "schemaVersion": 1,
            "activeGraphVersion": "outside",
            "graphifyVersion": "test",
            "generatedAt": None,
            "documents": [],
            "lastIngestion": {"status": "completed"},
        }
    )
    assert service._active_target() is None
    assert service.graph_status()["status"] == "unavailable"
