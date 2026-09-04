"""Durable single-concurrency knowledge build worker."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
from pathlib import Path

from app.config.settings import Settings
from app.knowledge.service import KnowledgeIngestionService
from app.knowledge.source_index import SourceIndex
from app.knowledge.sources import FilesystemDocumentSource
from app.observability import configure_logging

from .repository import BuildRecord, ProjectRepository

_PASSTHROUGH_ERROR_CODES = {
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
    "source_index_build_failed",
}


class KnowledgeWorker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.logger = configure_logging(settings.log_level, service="knowledge-worker")
        self.repository = ProjectRepository(
            settings.conversation_database_url,
            upload_ttl_hours=settings.upload_session_ttl_hours,
        )
        self.worker_id = f"{socket.gethostname()}-{os.getpid()}"

    async def run_forever(self) -> None:
        await self.repository.initialize()
        await self.repository.recover_builds()
        try:
            while True:
                build = await self.repository.claim_build(self.worker_id)
                if build is None:
                    await asyncio.sleep(self.settings.knowledge_worker_poll_seconds)
                    continue
                await self._process(build)
        finally:
            await self.repository.close()

    async def _process(self, build: BuildRecord) -> None:
        try:
            graph_version, count = await self._build(build)
            await self.repository.complete_build(build, graph_version, count)
            self.logger.info(
                "project_build_completed",
                extra={"project_id": build.project_id, "build_id": build.id},
            )
        except Exception as exc:
            code = self._error_code(exc)
            self.logger.exception(
                "project_build_failed",
                extra={
                    "project_id": build.project_id,
                    "build_id": build.id,
                    "error_type": code,
                },
            )
            await self.repository.fail_build(build, code)
            failed_root = (
                Path(self.settings.project_storage_root)
                / build.project_id
                / "builds"
                / build.id
            )
            if failed_root.exists():
                await asyncio.to_thread(shutil.rmtree, failed_root)

    async def _build(self, build: BuildRecord) -> tuple[str, int]:
        files = await self.repository.snapshot_files(build.snapshot_id)
        if not files:
            raise ValueError("empty_snapshot")
        project_root = Path(self.settings.project_storage_root) / build.project_id
        build_root = project_root / "builds" / build.id
        source_root = build_root / "source"
        source_root.mkdir(parents=True, exist_ok=False)
        for item, blob_path in files:
            target = source_root / item.logical_filename
            shutil.copyfile(blob_path, target, follow_symlinks=False)
            target.chmod(0o600)

        async def report_progress(phase: str, percent: int) -> None:
            await self.repository.update_file_lifecycle(
                build.snapshot_id, phase, percent
            )

        if self.settings.graphify_runtime_mode == "synthetic":
            await report_progress("validating", 15)
            graph_version = f"synthetic-{build.id}"
            source = FilesystemDocumentSource(
                source_root,
                max_documents=self.settings.knowledge_max_document_count,
                max_document_bytes=self.settings.knowledge_max_document_size_bytes,
                max_total_bytes=self.settings.knowledge_max_total_source_bytes,
                max_extracted_document_bytes=self.settings.knowledge_max_extracted_document_bytes,
                profiles=self.settings.document_profiles,
            )
            snapshot = source.discover()
            await report_progress("converting", 30)
            staged = build_root / "version"
            await report_progress("buildingGraph", 55)
            (staged / "graphify-out").mkdir(parents=True)
            graph = {
                "graphVersion": graph_version,
                "nodes": [
                    {
                        "id": f"document-{index}",
                        "label": document.relative_path,
                        "type": "document",
                        "source": document.relative_path,
                        "excerpt": document.content[:500],
                        "provenance": "explicit",
                    }
                    for index, document in enumerate(snapshot.documents, start=1)
                ],
                "edges": [],
            }
            (staged / "graphify-out" / "graph.json").write_text(
                json.dumps(graph, ensure_ascii=False), encoding="utf-8"
            )
            await report_progress("indexing", 85)
            SourceIndex(staged / "source-index.sqlite").rebuild_version(
                graph_version,
                snapshot.documents,
                profiles=self.settings.document_profiles,
                processing_fingerprint=self.settings.knowledge_processing_fingerprint,
            )
            count = len(snapshot.documents)
        else:
            configured = self.settings.model_copy(
                update={
                    "graphify_project_id": build.project_id,
                    "knowledge_input_dir": str(source_root),
                    "knowledge_staging_dir": str(build_root / "staging"),
                    "knowledge_graph_dir": str(build_root / "graph"),
                    "knowledge_archive_dir": str(build_root / "archive"),
                    "knowledge_failed_dir": str(build_root / "failed"),
                    "knowledge_manifest_path": str(
                        build_root / "state" / "manifest.json"
                    ),
                    "knowledge_source_index_path": str(
                        build_root / "state" / "source-index.sqlite"
                    ),
                    "knowledge_ingest_on_startup": False,
                }
            )
            service = KnowledgeIngestionService(
                configured,
                self.logger,
                progress_callback=report_progress,
            )
            await service.run_now(force=True)
            ingestion = service.current()
            if ingestion.get("status") == "failed":
                error_code = str(ingestion.get("errorCode") or "graphify_build_failed")
                raise RuntimeError(error_code)
            status = service.graph_status()
            graph_version = str(status["activeGraphVersion"])
            count = int(status["documentCount"])
            staged = build_root / "version"
            (staged / "graphify-out").mkdir(parents=True)
            shutil.copy2(
                service.active_graph_path(), staged / "graphify-out" / "graph.json"
            )
            shutil.copy2(service.source_index_path(), staged / "source-index.sqlite")

        versions = project_root / "versions"
        versions.mkdir(parents=True, exist_ok=True)
        target = versions / graph_version
        if target.exists():
            raise RuntimeError("version_collision")
        os.replace(staged, target)
        shutil.rmtree(build_root)
        return graph_version, count

    @staticmethod
    def _error_code(exc: Exception) -> str:
        message = str(exc)
        if message in _PASSTHROUGH_ERROR_CODES or message.startswith("graphify_"):
            return message
        if "limit" in message:
            return "limit_exceeded"
        if "source" in message or "document" in message or isinstance(exc, ValueError):
            return "source_invalid"
        return "build_failed"


async def main() -> None:
    await KnowledgeWorker(Settings()).run_forever()


if __name__ == "__main__":
    asyncio.run(main())
