"""FastAPI application composition root."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, cast
from uuid import uuid4

from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.dependencies import build_analysis_client, build_model
from app.api.errors import (
    InvalidRequest,
    analysis_not_configured_handler,
    analysis_not_found_handler,
    analysis_unavailable_handler,
    authentication_error_handler,
    authorization_error_handler,
    conflict_handler,
    conversation_state_conflict_handler,
    invalid_request_handler,
    not_found_handler,
    project_conflict_handler,
    project_not_found_handler,
    unhandled_error_handler,
    upload_validation_handler,
    validation_error_handler,
)
from app.api.routes.knowledge import router as knowledge_router
from app.api.routes.plsql import router as plsql_router
from app.api.routes.projects import router as projects_router
from app.auth import TokenVerifier, require_admin
from app.auth.dependencies import AuthorizationError
from app.auth.verifier import AuthenticationError
from app.config.settings import Settings, get_settings
from app.integrations.directory import KeycloakDirectoryClient
from app.integrations.plsql import PlsqlError, PlsqlNotConfigured, PlsqlObjectNotFound
from app.knowledge.service import KnowledgeIngestionService
from app.observability import configure_logging
from app.projects import ProjectConflict, ProjectNotFound, ProjectRepository
from app.projects.repository import UploadNotFound
from app.projects.storage import ProjectStorage, UploadValidationError
from app.store import (
    ConversationNotFound,
    ConversationRequestConflict,
    ConversationStateConflict,
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
        application.state.projects = ProjectRepository(
            configured.conversation_database_url,
            upload_ttl_hours=configured.upload_session_ttl_hours,
        )
        await application.state.projects.initialize()
        await application.state.projects.ensure_tenants(configured.allowed_tenant_ids)
        application.state.project_storage = ProjectStorage(
            configured.project_storage_root,
            max_file_bytes=configured.knowledge_max_document_size_bytes,
            max_extracted_bytes=configured.knowledge_max_extracted_document_bytes,
            max_files=configured.knowledge_max_document_count,
            max_total_bytes=configured.knowledge_max_total_source_bytes,
        )
        application.state.project_storage.initialize()
        application.state.token_verifier = TokenVerifier(
            issuer=configured.auth_issuer,
            audience=configured.auth_audience,
            jwks_url=configured.auth_jwks_url,
            cache_seconds=configured.auth_jwks_cache_seconds,
        )
        application.state.directory = KeycloakDirectoryClient(
            admin_url=configured.keycloak_admin_url,
            token_url=configured.keycloak_directory_token_url,
            client_id=configured.keycloak_directory_client_id,
            client_secret=configured.keycloak_directory_client_secret,
        )
        application.state.conversation_store_initialized = True
        cleanup_task = asyncio.create_task(
            _cleanup_conversations(application),
            name="conversation-retention-cleanup",
        )
        application.state.model = build_model(configured)
        application.state.knowledge = KnowledgeIngestionService(configured, logger)
        application.state.plsql_analysis = build_analysis_client(configured)
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
            await application.state.projects.close()
            await application.state.token_verifier.close()
            await application.state.directory.close()
            analysis_client = getattr(application.state, "plsql_analysis", None)
            analysis_close = getattr(analysis_client, "close", None)
            if callable(analysis_close):
                await asyncio.to_thread(analysis_close)
            application.state.conversation_store_initialized = False

    application = FastAPI(
        title="Graphify Knowledge Agent API",
        version="1.0.0-poc",
        description=(
            "Authenticated multi-project API with named SSE conversation streams."
        ),
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=configured.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "X-Request-ID",
        ],
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
        ConversationStateConflict, cast(Any, conversation_state_conflict_handler)
    )
    application.add_exception_handler(
        InvalidRequest, cast(Any, invalid_request_handler)
    )
    application.add_exception_handler(
        AuthenticationError, cast(Any, authentication_error_handler)
    )
    application.add_exception_handler(
        AuthorizationError, cast(Any, authorization_error_handler)
    )
    application.add_exception_handler(
        ProjectNotFound, cast(Any, project_not_found_handler)
    )
    application.add_exception_handler(
        UploadNotFound, cast(Any, project_not_found_handler)
    )
    application.add_exception_handler(
        ProjectConflict, cast(Any, project_conflict_handler)
    )
    application.add_exception_handler(
        UploadValidationError, cast(Any, upload_validation_handler)
    )
    application.add_exception_handler(
        PlsqlNotConfigured, cast(Any, analysis_not_configured_handler)
    )
    application.add_exception_handler(
        PlsqlObjectNotFound, cast(Any, analysis_not_found_handler)
    )
    application.add_exception_handler(
        PlsqlError, cast(Any, analysis_unavailable_handler)
    )
    application.add_exception_handler(Exception, unhandled_error_handler)
    application.include_router(api_router)
    application.include_router(projects_router)
    application.include_router(plsql_router)
    if configured.knowledge_admin_endpoints_enabled:
        application.include_router(
            knowledge_router, dependencies=[Depends(require_admin)]
        )
    return application


async def _cleanup_conversations(application: FastAPI) -> None:
    interval = application.state.settings.conversation_cleanup_interval_seconds
    while True:
        await asyncio.sleep(interval)
        removed = await application.state.store.cleanup()
        upload_paths = await application.state.projects.cleanup_expired_uploads()
        await application.state.project_storage.cleanup_paths(upload_paths)
        retention = application.state.settings.project_archive_retention_days
        expired_projects = await application.state.projects.expired_archives(retention)
        for project_id in expired_projects:
            await application.state.projects.purge_expired(
                project_id, "system-retention", retention
            )
            await application.state.store.delete_project(project_id)
            await application.state.project_storage.purge_project(project_id)
        if removed:
            application.state.logger.info(
                "expired_archived_conversations_removed",
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
