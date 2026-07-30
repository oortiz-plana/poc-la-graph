from __future__ import annotations

import asyncio
import json
import logging
import signal
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.config.settings import Settings
from app.knowledge.service import IngestionConflict, KnowledgeIngestionService


def settings(tmp_path: Path) -> Settings:
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


def snapshot(version: str = "source-v1") -> Any:
    document = SimpleNamespace(
        relative_path="nested/fact.md",
        content="# Fact\nGrounded.",
        sha256="a" * 64,
        bytes=18,
        modified_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    return SimpleNamespace(source_version=version, documents=(document,))


def create_input_document(root: Path) -> None:
    root.mkdir(parents=True)
    (root / "fact.md").write_text("# Fact\nGrounded.", encoding="utf-8")


class FakeSource:
    def __init__(self, value: Any) -> None:
        self.value = value

    def discover(self) -> Any:
        return self.value


class FakeProcess:
    returncode = 0

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"ok", b""


class FailedProcess:
    returncode = 1

    async def communicate(self) -> tuple[bytes, bytes]:
        return (
            b"",
            b"AuthenticationError: Error code: 401 - invalid_api_key "
            b"diagnostic-that-must-not-be-logged",
        )


def install_successful_graphify(
    service: KnowledgeIngestionService,
    monkeypatch: pytest.MonkeyPatch,
    *,
    graph: object | None = None,
) -> list[tuple[object, ...]]:
    calls: list[tuple[object, ...]] = []
    graph_value = (
        graph
        if graph is not None
        else {
            "nodes": [{"id": "n1"}],
            "links": [],
        }
    )
    monkeypatch.setattr(service, "_source", lambda: FakeSource(snapshot()))

    async def subprocess(*command: object, **kwargs: object) -> FakeProcess:
        del kwargs
        calls.append(command)
        output = Path(str(command[command.index("--out") + 1]))
        generated = output / "graphify-out"
        generated.mkdir(parents=True)
        (generated / "graph.json").write_text(json.dumps(graph_value), encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)
    return calls


async def test_successful_build_stages_invokes_validates_and_publishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    calls = install_successful_graphify(service, monkeypatch)

    identifier = await service.run_now()

    current = service.current()
    status = service.graph_status()
    assert current["ingestionId"] == identifier
    assert current["status"] == "completed"
    assert status["status"] == "ready"
    assert status["activeGraphVersion"] == identifier
    assert service.active_graph_path().is_file()
    assert json.loads(service.active_graph_path().read_text())["nodes"][0]["id"] == "n1"
    assert calls[0][:3] == ("graphify", "extract", calls[0][2])
    assert "--backend" in calls[0]
    version = Path(service.settings.knowledge_graph_dir) / "versions" / identifier
    build = json.loads((version / "build.json").read_text())
    assert build["nodes"] == 1
    assert build["edges"] == 0
    assert len(build["sha256"]) == 64
    assert not (Path(service.settings.knowledge_staging_dir) / identifier).exists()


async def test_real_filesystem_source_can_reach_manifest_and_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured = settings(tmp_path)
    input_dir = Path(configured.knowledge_input_dir)
    create_input_document(input_dir)
    service = KnowledgeIngestionService(configured, logging.getLogger("test"))

    async def subprocess(*command: object, **kwargs: object) -> FakeProcess:
        del kwargs
        output = Path(str(command[command.index("--out") + 1]))
        generated = output / "graphify-out"
        generated.mkdir(parents=True)
        (generated / "graph.json").write_text(
            '{"nodes":[{"id":"n1"}],"links":[]}', encoding="utf-8"
        )
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)
    await service.run_now()
    assert service.graph_status()["status"] == "ready"


async def test_graphify_runs_in_isolated_process_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    observed: dict[str, object] = {}
    monkeypatch.setattr(service, "_source", lambda: FakeSource(snapshot()))

    async def subprocess(*command: object, **kwargs: object) -> FakeProcess:
        observed.update(kwargs)
        output = Path(str(command[command.index("--out") + 1]))
        generated = output / "graphify-out"
        generated.mkdir(parents=True)
        (generated / "graph.json").write_text(
            '{"nodes":[{"id":"n1"}],"links":[]}', encoding="utf-8"
        )
        return FakeProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)
    await service.run_now()

    assert observed["start_new_session"] is True
    assert observed["close_fds"] is True
    assert observed["stdout"] == asyncio.subprocess.PIPE
    assert observed["stderr"] == asyncio.subprocess.PIPE
    assert "shell" not in observed


@pytest.mark.parametrize(
    ("diagnostic", "expected"),
    [
        (
            b"AuthenticationError: Error code: 401 - invalid_api_key",
            "graphify_provider_authentication_failed",
        ),
        (
            b"OPENAI API key is required",
            "graphify_provider_credential_missing",
        ),
        (
            b"RateLimitError: Error code: 429",
            "graphify_provider_quota_or_rate_limit",
        ),
        (
            b"NotFoundError: Error code: 404 - model_not_found",
            "graphify_provider_model_or_endpoint_not_found",
        ),
        (
            b"httpcore.UnsupportedProtocol",
            "graphify_provider_base_url_invalid",
        ),
        (
            b"APITimeoutError: request timeout",
            "graphify_provider_timeout",
        ),
        (
            b"APIConnectionError: Connection error",
            "graphify_provider_connection_failed",
        ),
        (b"unexpected extractor failure", "graphify_build_failed"),
    ],
)
def test_graphify_failure_diagnostics_are_safely_classified(
    diagnostic: bytes, expected: str
) -> None:
    assert (
        KnowledgeIngestionService._classify_graphify_failure(b"", diagnostic)
        == expected
    )


async def test_provider_failure_records_only_sanitized_error_code(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    monkeypatch.setattr(service, "_source", lambda: FakeSource(snapshot()))

    async def subprocess(*command: object, **kwargs: object) -> FailedProcess:
        del command, kwargs
        return FailedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)
    with (
        caplog.at_level(logging.ERROR),
        pytest.raises(RuntimeError, match="Knowledge ingestion failed"),
    ):
        await service.run_now()

    manifest = service.manifest()
    assert (
        manifest["lastIngestion"]["errorCode"]
        == "graphify_provider_authentication_failed"
    )
    assert "diagnostic-that-must-not-be-logged" not in caplog.text


class ControlledProcess:
    def __init__(self, *, pid: int = 4321, returncode: int | None = None) -> None:
        self.pid = pid
        self.returncode = returncode
        self.wait_calls = 0
        self.released = asyncio.Event()
        self.communicate_error: Exception | None = None

    async def communicate(self) -> tuple[bytes, bytes]:
        if self.communicate_error is not None:
            raise self.communicate_error
        return b"", b""

    async def wait(self) -> int:
        self.wait_calls += 1
        await self.released.wait()
        if self.returncode is None:
            self.returncode = -signal.SIGTERM
        return self.returncode


async def test_process_group_termination_is_graceful(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = ControlledProcess()
    signals: list[tuple[int, signal.Signals]] = []

    def killpg(pid: int, sent: signal.Signals) -> None:
        signals.append((pid, sent))
        process.released.set()

    monkeypatch.setattr("app.knowledge.service.ingestion.os.killpg", killpg)
    await KnowledgeIngestionService._terminate_process_group(
        cast(asyncio.subprocess.Process, process),
        grace_seconds=0.1,
    )

    assert signals == [(4321, signal.SIGTERM)]
    assert process.wait_calls == 1


async def test_process_group_termination_escalates_after_grace_period(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = ControlledProcess()
    signals: list[tuple[int, signal.Signals]] = []

    def killpg(pid: int, sent: signal.Signals) -> None:
        signals.append((pid, sent))
        if sent == signal.SIGKILL:
            process.returncode = -signal.SIGKILL
            process.released.set()

    monkeypatch.setattr("app.knowledge.service.ingestion.os.killpg", killpg)
    await KnowledgeIngestionService._terminate_process_group(
        cast(asyncio.subprocess.Process, process),
        grace_seconds=0,
    )

    assert signals == [
        (4321, signal.SIGTERM),
        (4321, signal.SIGKILL),
    ]
    assert process.wait_calls == 1


async def test_process_group_termination_tolerates_already_exited_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    process = ControlledProcess()
    process.released.set()

    def missing_group(pid: int, sent: signal.Signals) -> None:
        del pid, sent
        process.returncode = 0
        raise ProcessLookupError

    monkeypatch.setattr("app.knowledge.service.ingestion.os.killpg", missing_group)
    await KnowledgeIngestionService._terminate_process_group(
        cast(asyncio.subprocess.Process, process)
    )

    assert process.wait_calls == 1
    assert process.returncode == 0


async def test_build_timeout_terminates_graphify_process_group(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    process = ControlledProcess()
    process.communicate_error = TimeoutError()
    monkeypatch.setattr(service, "_source", lambda: FakeSource(snapshot()))
    signals: list[tuple[int, signal.Signals]] = []

    async def subprocess(*command: object, **kwargs: object) -> ControlledProcess:
        del command, kwargs
        return process

    def killpg(pid: int, sent: signal.Signals) -> None:
        signals.append((pid, sent))
        process.returncode = -signal.SIGTERM
        process.released.set()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", subprocess)
    monkeypatch.setattr("app.knowledge.service.ingestion.os.killpg", killpg)

    with pytest.raises(RuntimeError, match="Knowledge ingestion failed"):
        await service.run_now()

    assert signals == [(4321, signal.SIGTERM)]
    assert process.wait_calls == 1
    assert service.current()["errorCode"] == "graphify_build_timeout"


@pytest.mark.parametrize(
    "graph",
    [
        [],
        {},
        {"nodes": [], "links": []},
        {"nodes": [{"id": "n1"}], "links": "bad"},
    ],
)
async def test_invalid_graph_is_not_published_or_activated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, graph: object
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    install_successful_graphify(service, monkeypatch, graph=graph)

    with pytest.raises(RuntimeError, match="Knowledge ingestion failed"):
        await service.run_now()

    assert service.current()["status"] == "failed"
    assert service.graph_status()["status"] == "unavailable"
    versions = Path(service.settings.knowledge_graph_dir) / "versions"
    assert not versions.exists() or list(versions.iterdir()) == []


async def test_failed_rebuild_preserves_existing_active_graph(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    install_successful_graphify(service, monkeypatch)
    first = await service.run_now()
    original = service.active_graph_path().read_bytes()

    install_successful_graphify(service, monkeypatch, graph={"nodes": [], "links": []})
    with pytest.raises(RuntimeError):
        await service.run_now(force=True)

    assert service.active_graph_path().read_bytes() == original
    assert service.manifest()["activeGraphVersion"] == first
    assert service.current()["status"] == "failed"
    assert service.graph_status()["status"] == "ready"


async def test_concurrent_start_is_rejected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = KnowledgeIngestionService(settings(tmp_path), logging.getLogger("test"))
    release = asyncio.Event()

    async def blocked(ingestion_id: str, *, force: bool) -> None:
        del ingestion_id, force
        await release.wait()

    monkeypatch.setattr(service, "_run", blocked)
    await service.start()
    with pytest.raises(IngestionConflict):
        await service.start()
    release.set()
    assert service._task is not None
    await service._task


def test_graph_validation_accepts_edges_alias_and_rejects_missing_file(
    tmp_path: Path,
) -> None:
    graph = tmp_path / "graph.json"
    graph.write_text('{"nodes":[{"id":"n"}],"edges":[{"id":"e"}]}')
    assert KnowledgeIngestionService._validate_graph(graph) == (1, 1)
    with pytest.raises(RuntimeError, match="graph_artifact_missing"):
        KnowledgeIngestionService._validate_graph(tmp_path / "missing.json")
