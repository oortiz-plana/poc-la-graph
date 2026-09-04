"""Versioned conversation routes and system probes."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sse_starlette.sse import EventSourceResponse

from app.agent.events import LifecycleEvent
from app.agent.models import ConversationTurn
from app.agent.workflow import KnowledgeWorkflow
from app.auth import AuthPrincipal, require_viewer
from app.config.settings import Settings
from app.integrations.graphify import GraphifyConfigurationError, GraphifyError
from app.models import (
    Conversation,
    ConversationList,
    CreateConversationRequest,
    Health,
    Readiness,
    SendMessageRequest,
    UpdateConversationRequest,
)
from app.projects import ProjectRepository
from app.projects.repository import ProjectConflict
from app.store import ConversationStore

from .dependencies import build_graph_client, get_app_settings, get_store, get_workflow
from .errors import InvalidRequest

api_router = APIRouter()


@api_router.get("/health", response_model=Health, tags=["system"])
async def health() -> Health:
    return Health()


@api_router.get(
    "/ready",
    response_model=Readiness,
    responses={503: {"model": Readiness}},
    tags=["system"],
)
async def readiness(request: Request, response: Response) -> Readiness:
    initialized = bool(getattr(request.app.state, "initialized", False))
    knowledge = getattr(request.app.state, "knowledge", None)
    graph = knowledge.graph_status() if knowledge else {"status": "unavailable"}
    settings = getattr(request.app.state, "settings", None)
    deterministic = bool(settings and settings.graphify_runtime_mode == "synthetic")
    multi_project = bool(settings and settings.auth_enabled)
    graph_ready = graph["status"] == "ready" or deterministic or multi_project
    knowledge_graph_status = (
        "synthetic"
        if deterministic
        else "project-registry"
        if multi_project
        else str(graph["status"])
    )
    graphify_status = await _graphify_readiness(
        request,
        settings,
        graph_ready=graph_ready,
        graph_version=graph.get("activeGraphVersion"),
    )
    ready = initialized and graph_ready and graphify_status in {"available", "mock"}
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    llm_status = (
        "mock"
        if settings and settings.llm_adapter == "mock"
        else "configured"
        if settings and settings.llm_model
        else "unconfigured"
    )
    analysis_status = (
        {
            "disabled": "disabled",
            "synthetic": "synthetic",
            "neo4j": "connected",
        }.get(settings.plsql_adapter, "disabled")
        if settings
        else "disabled"
    )
    return Readiness(
        ready=ready,
        components={
            "api": {"status": "running" if initialized else "starting"},
            "conversationStore": {
                "status": (
                    "available"
                    if getattr(
                        request.app.state,
                        "conversation_store_initialized",
                        False,
                    )
                    else "unavailable"
                )
            },
            "knowledgeGraph": {"status": knowledge_graph_status},
            "graphifyMcp": {"status": graphify_status},
            "analysis": {"status": analysis_status},
            "llm": {"status": llm_status},
        },
    )


async def _graphify_readiness(
    request: Request,
    settings: Settings | None,
    *,
    graph_ready: bool,
    graph_version: object,
) -> str:
    if settings is None or not getattr(request.app.state, "initialized", False):
        return "waiting"
    if settings.graphify_adapter == "mock":
        return "mock"
    if settings.graphify_runtime_mode == "real" and not graph_ready:
        return "waiting"
    client = build_graph_client(
        settings,
        graph_version=graph_version if isinstance(graph_version, str) else None,
    )
    try:
        await client.check_compatibility()
    except GraphifyConfigurationError:
        request.app.state.logger.error(
            "graphify_mcp_incompatible",
            extra={"error_type": "configuration"},
        )
        return "incompatible"
    except GraphifyError as exc:
        request.app.state.logger.warning(
            "graphify_mcp_unavailable",
            extra={"error_type": exc.category},
        )
        return "unavailable"
    return "available"


@api_router.post(
    "/api/v1/conversations",
    response_model=Conversation,
    status_code=status.HTTP_201_CREATED,
    tags=["conversations"],
)
async def create_conversation(
    store: Annotated[ConversationStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    request: Request,
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    body: CreateConversationRequest | None = None,
) -> Conversation:
    requested = body.project_id if body else None
    if not settings.auth_enabled:
        if requested is not None and requested != settings.graphify_project_id:
            try:
                project = await request.app.state.projects.get_project(
                    requested, include_archived=False
                )
            except Exception as exc:
                raise InvalidRequest("Unknown project") from exc
            if project.state != "ready" or not project.active_graph_version:
                raise ProjectConflict("The project is not ready")
            return await store.create(
                project.id, project.active_graph_version, principal.subject
            )
        return await store.create(
            requested or settings.graphify_project_id,
            created_by=principal.subject,
        )
    if requested is None:
        raise InvalidRequest("projectId is required")
    projects = cast(ProjectRepository, request.app.state.projects)
    project = await projects.get_project(requested, include_archived=False)
    await projects.access_decision(
        requested,
        tenant_id=principal.tenant_id,
        subject=principal.subject,
        group_ids=principal.group_ids,
    )
    if project.state != "ready" or not project.active_graph_version:
        raise ProjectConflict("The project is not ready")
    return await store.create(
        project.id, project.active_graph_version, principal.subject
    )


@api_router.get(
    "/api/v1/projects/{project_id}/conversations",
    response_model=ConversationList,
    tags=["conversations"],
)
async def list_conversations(
    project_id: str,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
    state: Literal["active", "archived"] = Query(default="active"),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None, min_length=1, max_length=1024),
) -> ConversationList:
    await _authorize_project_request(project_id, principal, request)
    try:
        return await store.list_conversations(
            project_id,
            principal.subject,
            state=state,
            limit=limit,
            cursor=cursor,
        )
    except ValueError as exc:
        raise InvalidRequest("Invalid cursor") from exc


@api_router.get(
    "/api/v1/conversations/{conversation_id}",
    response_model=Conversation,
    tags=["conversations"],
)
async def get_conversation(
    conversation_id: str,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> Conversation:
    await _authorize_conversation(conversation_id, principal, store, request)
    return await store.get(conversation_id, principal.subject)


@api_router.patch(
    "/api/v1/conversations/{conversation_id}",
    response_model=Conversation,
    tags=["conversations"],
)
async def rename_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> Conversation:
    await _authorize_conversation(conversation_id, principal, store, request)
    name = body.name.strip()
    if not name:
        raise InvalidRequest("Conversation name is empty")
    return await store.rename(conversation_id, name, principal.subject)


@api_router.delete(
    "/api/v1/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["conversations"],
)
async def delete_conversation(
    conversation_id: str,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> Response:
    await _authorize_conversation(conversation_id, principal, store, request)
    await store.archive(conversation_id, principal.subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api_router.post(
    "/api/v1/conversations/{conversation_id}/restore",
    response_model=Conversation,
    tags=["conversations"],
)
async def restore_conversation(
    conversation_id: str,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> Conversation:
    await _authorize_conversation(conversation_id, principal, store, request)
    return await store.restore(conversation_id, principal.subject)


@api_router.delete(
    "/api/v1/conversations/{conversation_id}/purge",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["conversations"],
)
async def purge_conversation(
    conversation_id: str,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> Response:
    await _authorize_conversation(conversation_id, principal, store, request)
    await store.purge(conversation_id, principal.subject)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api_router.post(
    "/api/v1/conversations/{conversation_id}/messages",
    response_class=EventSourceResponse,
    responses={200: {"content": {"text/event-stream": {"schema": {"type": "string"}}}}},
    tags=["conversations"],
)
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    store: Annotated[ConversationStore, Depends(get_store)],
    workflow: Annotated[KnowledgeWorkflow, Depends(get_workflow)],
    principal: Annotated[AuthPrincipal, Depends(require_viewer)],
) -> EventSourceResponse:
    correlation_id = str(request.state.request_id)
    scope = await store.get_scope(conversation_id, principal.subject)
    if request.app.state.settings.auth_enabled:
        await request.app.state.projects.access_decision(
            scope.project_id,
            tenant_id=principal.tenant_id,
            subject=principal.subject,
            group_ids=principal.group_ids,
        )
        project = await request.app.state.projects.get_project(
            scope.project_id, include_archived=True
        )
        if project.state == "archived":
            raise ProjectConflict("Archived projects cannot receive messages")
    await store.acquire_request(conversation_id, correlation_id, principal.subject)
    try:
        history = await store.get_history(
            conversation_id,
            max_turns=request.app.state.settings.conversation_history_max_turns,
            max_chars=request.app.state.settings.conversation_history_max_chars,
            created_by=principal.subject,
        )
        conversation_history = [
            ConversationTurn(id=item.id, role=item.role, content=item.content)
            for item in history
        ]
        await store.add_user_message(
            conversation_id, body.message.strip(), principal.subject
        )
    except Exception:
        await store.release_request(conversation_id, correlation_id, principal.subject)
        raise

    async def events() -> AsyncIterator[dict[str, str]]:
        terminal = False
        try:
            async for event in workflow.stream(
                body.message.strip(),
                correlation_id,
                conversation_id,
                history=conversation_history,
            ):
                if await request.is_disconnected():
                    break
                await _persist_terminal(
                    store, conversation_id, event, principal.subject
                )
                terminal = event.type in {"message.completed", "message.failed"}
                if event.type == "message.failed":
                    request.app.state.logger.error(
                        "model_request_failed",
                        extra={
                            "request_id": correlation_id,
                            "conversation_id": conversation_id,
                            "error_code": event.error.get("code")
                            if event.error
                            else "internal_error",
                            "retryable": event.error.get("retryable")
                            if event.error
                            else False,
                        },
                    )
                yield {
                    "event": event.type,
                    "data": json.dumps(
                        event.to_payload(),
                        separators=(",", ":"),
                    ),
                }
        finally:
            if not terminal:
                request.app.state.logger.warning(
                    "stream_ended_without_terminal_event",
                    extra={"request_id": correlation_id},
                )
                await store.add_assistant_message(
                    conversation_id,
                    "The response stream was interrupted.",
                    "failed",
                    created_by=principal.subject,
                )
            await store.release_request(
                conversation_id, correlation_id, principal.subject
            )

    return EventSourceResponse(
        events(),
        headers={"X-Request-ID": correlation_id, "Cache-Control": "no-cache"},
        ping=15,
    )


async def _authorize_conversation(
    conversation_id: str,
    principal: AuthPrincipal,
    store: ConversationStore,
    request: Request,
) -> None:
    scope = await store.get_scope(conversation_id, principal.subject)
    await _authorize_project_request(scope.project_id, principal, request)


async def _authorize_project_request(
    project_id: str,
    principal: AuthPrincipal,
    request: Request,
) -> None:
    if not request.app.state.settings.auth_enabled:
        return
    await request.app.state.projects.access_decision(
        project_id,
        tenant_id=principal.tenant_id,
        subject=principal.subject,
        group_ids=principal.group_ids,
    )


async def _persist_terminal(
    store: ConversationStore,
    conversation_id: str,
    event: LifecycleEvent,
    created_by: str,
) -> None:
    if event.type == "message.completed" and event.result is not None:
        await store.add_assistant_message(
            conversation_id,
            event.result.answer,
            "completed",
            event.result,
            created_by,
        )
    elif event.type == "message.failed":
        message = (
            str(event.error.get("message"))
            if event.error
            else "The request could not be completed."
        )
        await store.add_assistant_message(
            conversation_id, message, "failed", created_by=created_by
        )
