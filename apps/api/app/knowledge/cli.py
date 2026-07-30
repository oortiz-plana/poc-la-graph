"""Command-line administrative operations used by Compose and Make."""

from __future__ import annotations

import argparse
import asyncio
import json

from app.config.settings import Settings
from app.knowledge.service import KnowledgeIngestionService
from app.observability import configure_logging


async def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("startup", "ingest", "status", "rollback"))
    parser.add_argument("--force", action="store_true")
    arguments = parser.parse_args()
    settings = Settings()
    logger = configure_logging(
        getattr(settings, "log_level", "INFO"), service="knowledge-ingestion"
    )
    service = KnowledgeIngestionService(settings, logger)
    if arguments.command == "status":
        print(json.dumps(service.graph_status(), ensure_ascii=False))
        return 0 if service.graph_status()["status"] == "ready" else 1
    if arguments.command == "rollback":
        print(json.dumps({"activeGraphVersion": service.rollback()}))
        return 0
    if arguments.command == "startup":
        await service.maybe_startup()
        task = service._task
        if task is not None:
            await task
        graph_status = service.graph_status()
        print(json.dumps(graph_status, ensure_ascii=False))
        return 0 if graph_status["status"] == "ready" else 1
    await service.run_now(force=arguments.force)
    print(json.dumps(service.graph_status(), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
