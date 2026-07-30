"""FastAPI dependencies and production adapter composition."""

from __future__ import annotations

from typing import cast

from fastapi import Request

from app.agent.models import WorkflowLimits
from app.agent.workflow import KnowledgeWorkflow
from app.config.settings import Settings
from app.integrations.graphify import (
    GraphifyMCPConfig,
    GraphKnowledgeClient,
    MCPGraphKnowledgeClient,
    MockGraphKnowledgeClient,
)
from app.integrations.llm import DeterministicModel, LanguageModel, LiteLLMClient
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
    settings: Settings, *, graph_version: str | None = None
) -> GraphKnowledgeClient:
    if settings.graphify_adapter == "mock":
        return MockGraphKnowledgeClient.from_fixture(
            settings.graphify_mock_fixture_path
        )
    return MCPGraphKnowledgeClient(
        GraphifyMCPConfig(
            url=settings.graphify_mcp_url,
            project_id=settings.graphify_project_id,
            project_path=settings.graphify_project_path,
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


def get_workflow(request: Request) -> KnowledgeWorkflow:
    settings = get_app_settings(request)
    model = cast(LanguageModel, request.app.state.model)
    knowledge = request.app.state.knowledge
    graph_version = knowledge.graph_status().get("activeGraphVersion")
    return KnowledgeWorkflow(
        graph_client=build_graph_client(settings, graph_version=graph_version),
        model=model,
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
