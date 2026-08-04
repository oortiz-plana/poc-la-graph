"""FastAPI dependencies and production adapter composition."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import Depends, Request

from app.agent.models import WorkflowLimits
from app.agent.workflow import KnowledgeWorkflow
from app.auth import AuthPrincipal
from app.auth.dependencies import current_principal
from app.config.settings import Settings
from app.integrations.graphify import (
    GraphifyMCPConfig,
    GraphKnowledgeClient,
    MCPGraphKnowledgeClient,
    MockGraphKnowledgeClient,
)
from app.integrations.haystack import HaystackSourceRetriever
from app.integrations.llm import DeterministicModel, LanguageModel, LiteLLMClient
from app.projects import ProjectConflict
from app.store import ConversationStore


def get_store(request: Request) -> ConversationStore:
    return cast(ConversationStore, request.app.state.store)


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def build_model(settings: Settings) -> LanguageModel:
    if settings.llm_adapter == "mock":
        return DeterministicModel()
    return LiteLLMClient(
        _LiteLLMConfig(
            model=settings.llm_model,
            api_base=settings.llm_api_base,
            api_key=settings.llm_api_key,
            timeout=settings.llm_request_timeout_seconds,
            retries=settings.llm_max_retries,
        )
    )


def build_graph_client(
    settings: Settings,
    *,
    graph_version: str | None = None,
    project_id: str | None = None,
    project_path: str | None = None,
) -> GraphKnowledgeClient:
    if settings.graphify_adapter == "mock":
        return MockGraphKnowledgeClient.from_fixture(
            settings.graphify_mock_fixture_path
        )
    return MCPGraphKnowledgeClient(
        GraphifyMCPConfig(
            url=settings.graphify_mcp_url,
            project_id=project_id or settings.graphify_project_id,
            project_path=project_path or settings.graphify_project_path,
            knowledge_root=settings.graphify_knowledge_root,
            timeout_seconds=settings.graphify_request_timeout_seconds,
            tool_names={
                "search": settings.graphify_search_tool,
                "get_node": settings.graphify_get_node_tool,
                "get_neighbors": settings.graphify_get_neighbors_tool,
                "shortest_path": settings.graphify_shortest_path_tool,
            },
            max_tool_calls=settings.agent_max_tool_calls,
            max_depth=settings.agent_max_traversal_depth,
            max_nodes=settings.agent_max_nodes,
            max_edges=settings.agent_max_edges,
            max_evidence_bytes=settings.agent_max_evidence_bytes,
            runtime_mode=settings.graphify_runtime_mode,
            graph_version=graph_version,
        )
    )


async def get_workflow(
    request: Request,
    principal: Annotated[AuthPrincipal, Depends(current_principal)],
) -> KnowledgeWorkflow:
    settings = get_app_settings(request)
    model = cast(LanguageModel, request.app.state.model)
    conversation_id = str(request.path_params.get("conversation_id", ""))
    scope = await get_store(request).get_scope(conversation_id, principal.subject)
    if settings.auth_enabled:
        project = await request.app.state.projects.get_project(
            scope.project_id, include_archived=True
        )
        graph_version = project.active_graph_version
        if not graph_version:
            raise ProjectConflict("The project has no active version")
        project_path = (
            f"{settings.project_storage_root}/{scope.project_id}"
            f"/versions/{graph_version}"
        )
        source_index_path = f"{project_path}/source-index.sqlite"
    elif scope.graph_version:
        graph_version = scope.graph_version
        project_path = (
            f"{settings.project_storage_root}/{scope.project_id}"
            f"/versions/{graph_version}"
        )
        source_index_path = f"{project_path}/source-index.sqlite"
    else:
        knowledge = request.app.state.knowledge
        graph_version = knowledge.graph_status().get("activeGraphVersion")
        project_path = settings.graphify_project_path
        source_index_path = str(knowledge.source_index_path())
    return KnowledgeWorkflow(
        graph_client=build_graph_client(
            settings,
            graph_version=graph_version,
            project_id=scope.project_id,
            project_path=project_path,
        ),
        model=model,
        source_retriever=(
            HaystackSourceRetriever(source_index_path, graph_version)
            if graph_version
            else None
        ),
        limits=WorkflowLimits(
            max_tool_calls=settings.agent_max_tool_calls,
            max_traversal_depth=settings.agent_max_traversal_depth,
            max_nodes=settings.agent_max_nodes,
            max_edges=settings.agent_max_edges,
            max_evidence_bytes=settings.agent_max_evidence_bytes,
            max_model_iterations=settings.agent_max_model_iterations,
            max_history_turns=settings.conversation_history_max_turns,
            max_history_characters=settings.conversation_history_max_chars,
            request_timeout_seconds=settings.agent_request_timeout_seconds,
        ),
    )


class _LiteLLMConfig:
    def __init__(
        self,
        *,
        model: str,
        api_base: str | None,
        api_key: str | None,
        timeout: float,
        retries: int,
    ) -> None:
        self.model = model
        self.api_base = api_base
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries
