"""Orchestrate immutable real-Graphify builds and atomic activation."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

from app.config.settings import Settings
from app.knowledge.domain import (
    IngestionCommand,
    KnowledgeChangeSet,
    KnowledgeDocumentSource,
    KnowledgeSnapshot,
)
from app.knowledge.source_index import SourceIndex
from app.knowledge.sources import (
    FilesystemDocumentSource,
    SourceLimitError,
    SourceValidationError,
)
from app.knowledge.state.lock import LockTimeoutError, ProcessFileLock


class IngestionConflict(RuntimeError):
    pass


class KnowledgeIngestionService:
    def __init__(
        self,
        settings: Settings,
        logger: Any,
        source: KnowledgeDocumentSource | None = None,
    ) -> None:
        self.settings = settings
        self.logger = logger
        self.document_source = source or FilesystemDocumentSource(
            self.settings.knowledge_input_dir,
            max_documents=self.settings.knowledge_max_document_count,
            max_document_bytes=self.settings.knowledge_max_document_size_bytes,
        )
        self._task: asyncio.Task[None] | None = None
        self._guard = asyncio.Lock()
        self._commands: dict[str, IngestionCommand] = {}

    async def start(
        self,
        *,
        force: bool = False,
        command: IngestionCommand | None = None,
    ) -> str:
        async with self._guard:
            if self._task and not self._task.done():
                raise IngestionConflict("A knowledge ingestion is already running")
            lock = self._acquire_process_lock()
            ingestion_id = f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
            self._commands[ingestion_id] = command or IngestionCommand()
            self._task = asyncio.create_task(
                self._run_locked(ingestion_id, force=force, lock=lock)
            )
            self._task.add_done_callback(self._consume_background_result)
            return ingestion_id

    async def run_now(
        self,
        *,
        force: bool = False,
        command: IngestionCommand | None = None,
    ) -> str:
        async with self._guard:
            if self._task and not self._task.done():
                raise IngestionConflict("A knowledge ingestion is already running")
            lock = self._acquire_process_lock()
            ingestion_id = f"{datetime.now(UTC):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
            self._commands[ingestion_id] = command or IngestionCommand()
            await self._run_locked(ingestion_id, force=force, lock=lock)
            if self.current().get("status") != "completed":
                raise RuntimeError("Knowledge ingestion failed")
            return ingestion_id

    async def maybe_startup(self) -> None:
        if not self.settings.knowledge_ingest_on_startup:
            return
        try:
            snapshot = await self._load_snapshot(IngestionCommand())
        except (SourceValidationError, OSError):
            await self.start(force=self.settings.knowledge_force_rebuild)
            return
        manifest = self.manifest()
        changed = (
            manifest is None
            or manifest.get("sourceVersion") != snapshot.source_version
            or manifest.get("graphifyVersion") != self.settings.graphify_package_version
            or not self._has_valid_active_graph()
            or not self._has_valid_active_source_index()
        )
        if changed or self.settings.knowledge_force_rebuild:
            await self.start(force=self.settings.knowledge_force_rebuild)

    def current(self) -> dict[str, Any]:
        manifest = self.manifest()
        if manifest:
            return dict(manifest["lastIngestion"])
        return {"ingestionId": None, "status": "idle"}

    def graph_status(self) -> dict[str, Any]:
        manifest = self.manifest()
        if not manifest or not self._has_valid_active_graph():
            running = self._task is not None and not self._task.done()
            return {
                "status": "building" if running else "unavailable",
                "activeGraphVersion": None,
                "graphifyVersion": self.settings.graphify_package_version,
                "generatedAt": None,
                "documentCount": 0,
            }
        return {
            "status": "ready",
            "activeGraphVersion": manifest["activeGraphVersion"],
            "graphifyVersion": manifest["graphifyVersion"],
            "generatedAt": manifest["generatedAt"],
            "documentCount": len(manifest["documents"]),
        }

    def manifest(self) -> dict[str, Any] | None:
        path = Path(self.settings.knowledge_manifest_path)
        try:
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                metadata = os.fstat(descriptor)
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1024 * 1024:
                    return None
                encoded = os.read(descriptor, metadata.st_size + 1)
            finally:
                os.close(descriptor)
            data = json.loads(encoded.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict) or data.get("schemaVersion") != 1:
            return None
        return data

    def active_graph_path(self) -> Path:
        return Path(self.settings.knowledge_graph_dir) / "active" / "graph.json"

    def source_index_path(self) -> Path:
        configured = Path(self.settings.knowledge_source_index_path)
        default_manifest = Path("/knowledge/state/manifest.json")
        if (
            configured == Path("/knowledge/state/source-index.sqlite")
            and Path(self.settings.knowledge_manifest_path) != default_manifest
        ):
            return Path(self.settings.knowledge_manifest_path).with_name(
                "source-index.sqlite"
            )
        return configured

    def rollback(self) -> str:
        rollback_started = time.monotonic()
        lock = self._acquire_process_lock()
        try:
            manifest = self.manifest()
            if not manifest or not manifest.get("previousGraphVersion"):
                raise RuntimeError("No previous graph version is available")
            previous = str(manifest["previousGraphVersion"])
            target = Path(self.settings.knowledge_graph_dir) / "versions" / previous
            self._validate_graph(target / "graph.json")
            current = manifest.get("activeGraphVersion")
            prior_target = self._active_target()
            self._activate(target)
            try:
                manifest["activeGraphVersion"] = previous
                manifest["previousGraphVersion"] = current
                self._write_manifest(manifest)
            except Exception:
                self._restore_active(prior_target)
                raise
            self.logger.info(
                "knowledge_rollback_completed",
                extra={
                    "graph_version": previous,
                    "document_count": len(manifest.get("documents", [])),
                    "duration_ms": self._duration_ms(rollback_started),
                },
            )
            return previous
        finally:
            lock.__exit__(None, None, None)

    def _source(self) -> KnowledgeDocumentSource:
        """Compatibility hook for tests; production dependencies are injected."""
        return self.document_source

    async def _load_snapshot(self, command: IngestionCommand) -> KnowledgeSnapshot:
        source = self._source()
        snapshot_method = getattr(source, "snapshot", None)
        if snapshot_method is not None:
            return cast(KnowledgeSnapshot, await snapshot_method(command))

        # Temporary compatibility for older in-process test doubles. New source
        # implementations must implement the asynchronous snapshot protocol.
        discover = getattr(source, "discover", None)
        if discover is None:
            raise TypeError("Knowledge document source does not implement snapshot")
        return cast(KnowledgeSnapshot, await asyncio.to_thread(discover))

    def _acquire_process_lock(self) -> ProcessFileLock:
        lock = ProcessFileLock(
            Path(self.settings.knowledge_manifest_path).with_suffix(".lock"),
            timeout_seconds=0,
        )
        try:
            return lock.__enter__()
        except LockTimeoutError as exc:
            raise IngestionConflict(
                "A knowledge ingestion or rollback is already running"
            ) from exc

    async def _run(self, ingestion_id: str, *, force: bool) -> None:
        """Overridable execution hook; public entry points acquire the state lock."""
        command = self._commands.get(ingestion_id, IngestionCommand())
        await self._execute(ingestion_id, force=force, command=command)

    async def _run_locked(
        self,
        ingestion_id: str,
        *,
        force: bool,
        lock: ProcessFileLock,
    ) -> None:
        try:
            await self._run(ingestion_id, force=force)
        finally:
            self._commands.pop(ingestion_id, None)
            lock.__exit__(None, None, None)

    async def _execute(
        self,
        ingestion_id: str,
        *,
        force: bool,
        command: IngestionCommand,
    ) -> None:
        monotonic_started = time.monotonic()
        started = datetime.now(UTC)
        old = self.manifest()
        self.logger.info(
            "knowledge_ingestion_started",
            extra={"ingestion_id": ingestion_id},
        )
        try:
            snapshot = await self._load_snapshot(command)
        except Exception as exc:
            failure = self._source_failure_manifest(ingestion_id, started, exc, old)
            self.logger.error(
                "knowledge_ingestion_failed",
                extra={
                    "ingestion_id": ingestion_id,
                    "error_type": failure["lastIngestion"]["errorCode"],
                    "document_count": 0,
                    "duration_ms": self._duration_ms(monotonic_started),
                },
            )
            self._write_manifest(failure)
            return
        if (
            not force
            and old
            and old.get("sourceVersion") == snapshot.source_version
            and old.get("graphifyVersion") == self.settings.graphify_package_version
            and self._has_valid_active_graph()
        ):
            active_version = str(old["activeGraphVersion"])
            if not SourceIndex(self.source_index_path()).has_version(active_version):
                try:
                    passage_count = SourceIndex(
                        self.source_index_path()
                    ).rebuild_version(active_version, snapshot.documents)
                except Exception:
                    failure = self._manifest(
                        snapshot,
                        ingestion_id,
                        "failed",
                        started,
                        datetime.now(UTC),
                        "source_index_build_failed",
                        old,
                    )
                    self._write_manifest(failure)
                    self.logger.error(
                        "knowledge_source_index_reconciliation_failed",
                        extra={
                            "ingestion_id": ingestion_id,
                            "graph_version": active_version,
                            "document_count": len(snapshot.documents),
                            "error_type": "source_index_build_failed",
                            "duration_ms": self._duration_ms(monotonic_started),
                        },
                    )
                    return
                self.logger.info(
                    "knowledge_source_index_reconciled",
                    extra={
                        "ingestion_id": ingestion_id,
                        "graph_version": active_version,
                        "document_count": len(snapshot.documents),
                        "source_passage_count": passage_count,
                        "duration_ms": self._duration_ms(monotonic_started),
                    },
                )
            unchanged = self._manifest(
                snapshot,
                ingestion_id,
                "completed",
                started,
                datetime.now(UTC),
                None,
                old,
                active_version=active_version,
            )
            unchanged["previousGraphVersion"] = old.get("previousGraphVersion")
            unchanged["generatedAt"] = old.get("generatedAt")
            self._write_manifest(unchanged)
            self.logger.info(
                "knowledge_ingestion_skipped",
                extra={
                    "ingestion_id": ingestion_id,
                    "graph_version": old["activeGraphVersion"],
                    "document_count": len(snapshot.documents),
                    "duration_ms": self._duration_ms(monotonic_started),
                },
            )
            return
        running = self._manifest(
            snapshot, ingestion_id, "running", started, None, None, old
        )
        self._write_manifest(running)
        staging = Path(self.settings.knowledge_staging_dir) / ingestion_id
        try:
            source = staging / "source"
            output = staging / "output"
            source.mkdir(parents=True)
            output.mkdir(parents=True)
            for document in snapshot.documents:
                destination = source / document.relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(document.content, encoding="utf-8")
                destination.chmod(0o400)
            subprocess_command = [
                "graphify",
                "extract",
                str(source),
                "--backend",
                self.settings.graphify_extract_backend,
                "--out",
                str(output),
                "--no-cluster",
            ]
            if self.settings.graphify_extract_model:
                subprocess_command.extend(
                    ["--model", self.settings.graphify_extract_model]
                )
            process = await asyncio.create_subprocess_exec(
                *subprocess_command,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=staging,
                close_fds=True,
                start_new_session=True,
                env=self._graphify_environment(),
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    self.settings.knowledge_build_timeout_seconds,
                )
            except TimeoutError:
                await self._terminate_process_group(process)
                raise RuntimeError("graphify_build_timeout") from None
            except asyncio.CancelledError:
                await asyncio.shield(self._terminate_process_group(process))
                raise
            if process.returncode:
                error_code = self._classify_graphify_failure(stdout, stderr)
                self.logger.error(
                    "knowledge_build_failed",
                    extra={
                        "ingestion_id": ingestion_id,
                        "error_type": error_code,
                    },
                )
                raise RuntimeError(error_code)
            generated = output / "graphify-out" / "graph.json"
            counts = self._validate_graph(generated)
            version = ingestion_id
            target = Path(self.settings.knowledge_graph_dir) / "versions" / version
            target.parent.mkdir(parents=True, exist_ok=True)
            publish = staging / "publish"
            publish.mkdir()
            shutil.copy2(generated, publish / "graph.json")
            artifact_sha = hashlib.sha256(
                (publish / "graph.json").read_bytes()
            ).hexdigest()
            try:
                passage_count = SourceIndex(self.source_index_path()).rebuild_version(
                    version, snapshot.documents
                )
            except Exception as exc:
                raise RuntimeError("source_index_build_failed") from exc
            (publish / "build.json").write_text(
                json.dumps(
                    {
                        "graphVersion": version,
                        "sha256": artifact_sha,
                        "nodes": counts[0],
                        "edges": counts[1],
                        "sourcePassages": passage_count,
                    },
                    separators=(",", ":"),
                ),
                encoding="utf-8",
            )
            self._fsync_tree(publish)
            if target.exists():
                raise RuntimeError("graph_version_already_exists")
            os.replace(publish, target)
            self._fsync_directory(target.parent)
            completed = self._manifest(
                snapshot,
                ingestion_id,
                "completed",
                started,
                datetime.now(UTC),
                None,
                old,
                active_version=version,
            )
            prior_target = self._active_target()
            self._activate(target)
            try:
                self._write_manifest(completed)
            except Exception:
                self._restore_active(prior_target)
                raise
            self._prune_versions()
            shutil.rmtree(staging, ignore_errors=True)
            self.logger.info(
                "knowledge_ingestion_completed",
                extra={
                    "ingestion_id": ingestion_id,
                    "graph_version": version,
                    "document_count": len(snapshot.documents),
                    "node_count": counts[0],
                    "edge_count": counts[1],
                    "duration_ms": self._duration_ms(monotonic_started),
                },
            )
        except Exception as exc:
            failed_dir = Path(self.settings.knowledge_failed_dir) / ingestion_id
            failed_dir.parent.mkdir(parents=True, exist_ok=True)
            if staging.exists():
                os.replace(staging, failed_dir)
            known_codes = {
                "graphify_build_timeout",
                "graphify_build_failed",
                "graphify_provider_authentication_failed",
                "graphify_provider_credential_missing",
                "graphify_provider_quota_or_rate_limit",
                "graphify_provider_model_or_endpoint_not_found",
                "graphify_provider_base_url_invalid",
                "graphify_provider_timeout",
                "graphify_provider_connection_failed",
                "graph_artifact_missing",
                "graph_artifact_invalid",
                "graph_version_already_exists",
                "source_index_build_failed",
            }
            error_code = str(exc) if str(exc) in known_codes else type(exc).__name__
            failure = self._manifest(
                snapshot,
                ingestion_id,
                "failed",
                started,
                datetime.now(UTC),
                error_code,
                old,
            )
            self._write_manifest(failure)
            self.logger.error(
                "knowledge_ingestion_failed",
                extra={
                    "ingestion_id": ingestion_id,
                    "graph_version": old.get("activeGraphVersion") if old else None,
                    "document_count": len(snapshot.documents),
                    "error_type": error_code,
                    "duration_ms": self._duration_ms(monotonic_started),
                },
            )

    @staticmethod
    def _graphify_environment() -> dict[str, str]:
        """Return the minimum reviewed environment for Graphify extraction."""
        allowed = (
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_MODEL",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "REQUESTS_CA_BUNDLE",
            "CURL_CA_BUNDLE",
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "no_proxy",
        )
        environment = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
        }
        environment.update(
            {name: os.environ[name] for name in allowed if os.environ.get(name)}
        )
        return environment

    @staticmethod
    def _classify_graphify_failure(stdout: bytes, stderr: bytes) -> str:
        """Map bounded provider diagnostics to a stable, non-sensitive code.

        Graphify and provider output is never logged or persisted. Only the
        tail is inspected so a provider failure is actionable without exposing
        document text, credentials, endpoints, or raw exception messages.
        """
        diagnostic = b"\n".join((stdout[-32_768:], stderr[-32_768:])).decode(
            "utf-8", errors="replace"
        )
        normalized = diagnostic.casefold()
        if (
            "invalid_api_key" in normalized
            or "incorrect api key" in normalized
            or "authenticationerror" in normalized
            or "status code: 401" in normalized
            or "error code: 401" in normalized
        ):
            return "graphify_provider_authentication_failed"
        if "api key" in normalized and any(
            marker in normalized for marker in ("missing", "not set", "required")
        ):
            return "graphify_provider_credential_missing"
        if any(
            marker in normalized
            for marker in ("status code: 429", "error code: 429", "rate_limit")
        ):
            return "graphify_provider_quota_or_rate_limit"
        if any(
            marker in normalized
            for marker in (
                "status code: 404",
                "error code: 404",
                "model_not_found",
            )
        ):
            return "graphify_provider_model_or_endpoint_not_found"
        if "unsupportedprotocol" in normalized:
            return "graphify_provider_base_url_invalid"
        if "timeout" in normalized:
            return "graphify_provider_timeout"
        if any(
            marker in normalized
            for marker in (
                "apiconnectionerror",
                "connection error",
                "name resolution",
            )
        ):
            return "graphify_provider_connection_failed"
        return "graphify_build_failed"

    @staticmethod
    async def _terminate_process_group(
        process: asyncio.subprocess.Process,
        *,
        grace_seconds: float = 1.0,
    ) -> None:
        """Terminate and reap the isolated Graphify process group.

        Graphify is always launched with ``start_new_session=True``, so its PID is
        also the process-group ID. Signalling that group prevents extraction
        helpers from surviving an ingestion timeout or application shutdown.
        """
        if process.returncode is not None:
            await process.wait()
            return

        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            await process.wait()
            return

        try:
            await asyncio.wait_for(process.wait(), timeout=grace_seconds)
            return
        except TimeoutError:
            pass

        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        await process.wait()

    @staticmethod
    def _validate_graph(path: Path) -> tuple[int, int]:
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("graph_artifact_missing")
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise RuntimeError("graph_artifact_invalid")
        nodes, edges = raw.get("nodes"), raw.get("links", raw.get("edges"))
        if not isinstance(nodes, list) or not isinstance(edges, list) or not nodes:
            raise RuntimeError("graph_artifact_invalid")
        return len(nodes), len(edges)

    def _activate(self, version_dir: Path) -> None:
        graph_root = Path(self.settings.knowledge_graph_dir)
        versions_root = (graph_root / "versions").resolve()
        resolved_version = version_dir.resolve(strict=True)
        if resolved_version.parent != versions_root or version_dir.is_symlink():
            raise RuntimeError("graph_version_path_invalid")
        self._validate_graph(resolved_version / "graph.json")
        graph_root.mkdir(parents=True, exist_ok=True)
        active = graph_root / "active"
        if active.exists() and not active.is_symlink():
            raise RuntimeError("active_graph_path_invalid")
        temporary = graph_root / f".active-{uuid4().hex}"
        try:
            temporary.symlink_to(
                Path("versions") / version_dir.name, target_is_directory=True
            )
            os.replace(temporary, active)
            self._fsync_directory(graph_root)
        finally:
            temporary.unlink(missing_ok=True)

    def _active_target(self) -> str | None:
        active = Path(self.settings.knowledge_graph_dir) / "active"
        if not active.is_symlink():
            return None
        raw = os.readlink(active)
        relative = Path(raw)
        parts = relative.parts
        if (
            relative.is_absolute()
            or len(parts) != 2
            or parts[0] != "versions"
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", parts[1])
            or parts[1] in {".", ".."}
        ):
            return None
        graph_root = Path(self.settings.knowledge_graph_dir).resolve()
        resolved = (graph_root / relative).resolve(strict=False)
        versions = (graph_root / "versions").resolve(strict=False)
        if resolved.parent != versions:
            return None
        try:
            self._validate_graph(resolved / "graph.json")
        except (OSError, RuntimeError, ValueError, json.JSONDecodeError):
            return None
        return relative.as_posix()

    def _has_valid_active_graph(self) -> bool:
        return self._active_target() is not None

    def _has_valid_active_source_index(self) -> bool:
        manifest = self.manifest()
        version = manifest.get("activeGraphVersion") if manifest else None
        return bool(
            version and SourceIndex(self.source_index_path()).has_version(str(version))
        )

    def _restore_active(self, target: str | None) -> None:
        graph_root = Path(self.settings.knowledge_graph_dir)
        active = graph_root / "active"
        if target is None:
            active.unlink(missing_ok=True)
            self._fsync_directory(graph_root)
            return
        temporary = graph_root / f".active-restore-{uuid4().hex}"
        try:
            temporary.symlink_to(target, target_is_directory=True)
            os.replace(temporary, active)
            self._fsync_directory(graph_root)
        finally:
            temporary.unlink(missing_ok=True)

    def _source_failure_manifest(
        self,
        ingestion_id: str,
        started: datetime,
        exc: Exception,
        old: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if isinstance(exc, SourceLimitError):
            code = "source_limit_exceeded"
        elif isinstance(exc, (SourceValidationError, UnicodeError, OSError)):
            code = "source_invalid"
        else:
            code = "source_discovery_failed"
        value = (
            dict(old)
            if old
            else {
                "schemaVersion": 1,
                "sourceVersion": None,
                "activeGraphVersion": None,
                "previousGraphVersion": None,
                "graphifyVersion": self.settings.graphify_package_version,
                "generatedAt": None,
                "documents": [],
                "changes": KnowledgeChangeSet().model_dump(mode="json"),
            }
        )
        value["lastIngestion"] = {
            "ingestionId": ingestion_id,
            "status": "failed",
            "startedAt": started.isoformat(),
            "completedAt": datetime.now(UTC).isoformat(),
            "errorCode": code,
        }
        return value

    def _consume_background_result(self, task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        try:
            exception = task.exception()
        except asyncio.CancelledError:
            return
        if exception is not None:
            self.logger.error(
                "knowledge_ingestion_task_failed",
                extra={"error_type": type(exception).__name__},
            )

    @staticmethod
    def _duration_ms(started: float) -> int:
        return max(0, round((time.monotonic() - started) * 1000))

    def _manifest(
        self,
        snapshot: Any,
        ingestion_id: str,
        status: str,
        started: datetime,
        completed: datetime | None,
        error: str | None,
        old: dict[str, Any] | None,
        *,
        active_version: str | None = None,
    ) -> dict[str, Any]:
        previous = old.get("activeGraphVersion") if old else None
        changes = self._change_set(snapshot, old)
        return {
            "schemaVersion": 1,
            "sourceVersion": snapshot.source_version,
            "activeGraphVersion": active_version or previous,
            "previousGraphVersion": previous
            if active_version
            else (old.get("previousGraphVersion") if old else None),
            "graphifyVersion": self.settings.graphify_package_version,
            "generatedAt": (
                completed.isoformat()
                if active_version and completed
                else (old.get("generatedAt") if old else None)
            ),
            "documents": [
                {
                    "relativePath": item.relative_path,
                    "sha256": item.sha256,
                    "sizeBytes": item.bytes,
                    "modifiedAt": item.modified_at.isoformat(),
                }
                for item in snapshot.documents
            ],
            "changes": changes.model_dump(mode="json"),
            "lastIngestion": {
                "ingestionId": ingestion_id,
                "status": status,
                "startedAt": started.isoformat(),
                "completedAt": completed.isoformat() if completed else None,
                "errorCode": error,
            },
        }

    @staticmethod
    def _change_set(snapshot: Any, old: dict[str, Any] | None) -> KnowledgeChangeSet:
        previous = {
            str(item["relativePath"]): str(item["sha256"])
            for item in (old.get("documents", []) if old else [])
            if isinstance(item, dict)
            and isinstance(item.get("relativePath"), str)
            and isinstance(item.get("sha256"), str)
        }
        current = {
            str(item.relative_path): str(item.sha256) for item in snapshot.documents
        }
        previous_paths = set(previous)
        current_paths = set(current)
        shared = previous_paths & current_paths
        return KnowledgeChangeSet(
            added=tuple(sorted(current_paths - previous_paths)),
            changed=tuple(
                sorted(path for path in shared if current[path] != previous[path])
            ),
            unchanged=tuple(
                sorted(path for path in shared if current[path] == previous[path])
            ),
            removed=tuple(sorted(previous_paths - current_paths)),
        )

    def _write_manifest(self, value: dict[str, Any]) -> None:
        target = Path(self.settings.knowledge_manifest_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(dir=target.parent, prefix=".manifest-")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(name, 0o600)
            os.replace(name, target)
            self._fsync_directory(target.parent)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def _prune_versions(self) -> None:
        versions = Path(self.settings.knowledge_graph_dir) / "versions"
        keep = self.settings.knowledge_graph_versions_to_keep
        for path in sorted(
            (item for item in versions.iterdir() if item.is_dir()),
            reverse=True,
        )[keep:]:
            shutil.rmtree(path)

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @classmethod
    def _fsync_tree(cls, directory: Path) -> None:
        for path in directory.rglob("*"):
            if path.is_symlink():
                raise RuntimeError("graph_publish_symlink_invalid")
            if path.is_file():
                descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
        cls._fsync_directory(directory)
