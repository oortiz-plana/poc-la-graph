"""FastAPI application composition root."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, cast
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.dependencies import build_model
from app.api.errors import (
    InvalidRequest,
    conflict_handler,
    invalid_request_handler,
    not_found_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from app.api.routes.knowledge import router as knowledge_router
from app.config.settings import Settings, get_settings
from app.knowledge.service import KnowledgeIngestionService
from app.observability import configure_logging
from app.store import (
    ConversationNotFound,
    ConversationRequestConflict,
    create_conversation_store,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or get_settings()
    logger = configure_logging(configured.log_level, service="api")

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        application.state.settings = configured
        application.state.logger = logger
        application.state.store = create_conversation_store(
            configured.conversation_database_url,
            retention_days=configured.conversation_retention_days,
            max_turns=configured.conversation_max_turns,
            lease_seconds=configured.conversation_request_lease_seconds,
        )
        await application.state.store.initialize()
        application.state.conversation_store_initialized = True
        cleanup_task = asyncio.create_task(
            _cleanup_conversations(application),
            name="conversation-retention-cleanup",
        )
        application.state.model = build_model(configured)
        application.state.knowledge = KnowledgeIngestionService(configured, logger)
        application.state.initialized = True
        if (
            configured.knowledge_ingest_on_startup
            and configured.graphify_runtime_mode == "real"
        ):
            await application.state.knowledge.maybe_startup()
        _instrument(application)
        try:
            yield
        finally:
            application.state.initialized = False
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
            await application.state.store.close()
            application.state.conversation_store_initialized = False

    application = FastAPI(
        title="Graphify Knowledge Agent API",
        version="1.0.0-poc",
        description="Unauthenticated POC API with named SSE conversation streams.",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configured.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )

    @application.middleware("http")
    async def correlation_id(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        identifier = request.headers.get("X-Request-ID") or str(uuid4())
        request.state.request_id = identifier[:128]
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        logger.info(
            "request_completed",
            extra={
                "request_id": request.state.request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
            },
        )
        return response

    application.add_exception_handler(
        RequestValidationError, cast(Any, validation_error_handler)
    )
    application.add_exception_handler(
        ConversationNotFound, cast(Any, not_found_handler)
    )
    application.add_exception_handler(
        ConversationRequestConflict, cast(Any, conflict_handler)
    )
    application.add_exception_handler(
        InvalidRequest, cast(Any, invalid_request_handler)
    )
    application.add_exception_handler(Exception, unhandled_error_handler)
    application.include_router(api_router)
    if configured.knowledge_admin_endpoints_enabled:
        application.include_router(knowledge_router)
    return application


async def _cleanup_conversations(application: FastAPI) -> None:
    interval = application.state.settings.conversation_cleanup_interval_seconds
    while True:
        await asyncio.sleep(interval)
        removed = await application.state.store.cleanup()
        if removed:
            application.state.logger.info(
                "expired_conversations_removed",
                extra={"conversation_count": removed},
            )


def _instrument(application: FastAPI) -> None:
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
    except ImportError:
        return
    FastAPIInstrumentor.instrument_app(application)
    HTTPXClientInstrumentor().instrument()


app = create_app()
