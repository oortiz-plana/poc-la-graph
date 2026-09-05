"""Environment-backed settings for the API process."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.knowledge.profiles import (
    DEFAULT_DOCUMENT_PROFILES_JSON,
    DocumentProfiles,
    parse_document_profiles,
)


class Settings(BaseSettings):
    """Validated configuration; secrets remain server-side."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Graphify Knowledge Agent API"
    environment: str = "development"
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000"

    auth_enabled: bool = False
    auth_issuer: str = "http://localhost:8080/realms/graphify"
    auth_audience: str = "graphify-api"
    auth_jwks_url: str = (
        "http://keycloak:8080/realms/graphify/protocol/openid-connect/certs"
    )
    auth_jwks_cache_seconds: int = Field(default=300, ge=30, le=86_400)
    tenancy_mode: Literal["fixed", "claim"] = "fixed"
    tenant_id: str = "default"
    tenant_ids: str = "default"
    auth_tenant_claim: str = "tenant_id"
    auth_groups_claim: str = "groups"
    keycloak_admin_url: str | None = None
    keycloak_directory_token_url: str | None = None
    keycloak_directory_client_id: str | None = None
    keycloak_directory_client_secret: str | None = None

    llm_adapter: Literal["litellm", "mock"] = "litellm"
    llm_model: str = ""
    llm_api_base: str | None = None
    llm_api_key: str | None = None
    llm_request_timeout_seconds: float = Field(default=45, gt=0, le=300)
    llm_max_retries: int = Field(default=2, ge=0, le=10)

    graphify_adapter: Literal["mcp", "mock"] = "mcp"
    graphify_runtime_mode: Literal["real", "synthetic"] = "real"
    graphify_package_version: str = "0.9.18"
    graphify_mcp_transport: Literal["http"] = "http"
    graphify_mcp_url: str = "http://graphify:8001/mcp"
    graphify_project_id: str = "sample-project"
    graphify_project_path: str = "/knowledge/sample-project"
    graphify_knowledge_root: str = "/knowledge"
    graphify_request_timeout_seconds: float = Field(default=20, gt=0, le=300)
    graphify_mock_fixture_path: str = "/app/tests/fixtures/graphify/search-result.json"
    graphify_search_tool: str = "query_graph"
    graphify_get_node_tool: str = "get_node"
    graphify_get_neighbors_tool: str = "get_neighbors"
    graphify_shortest_path_tool: str = "shortest_path"

    agent_request_timeout_seconds: float = Field(default=60, gt=0, le=300)
    agent_max_tool_calls: int = Field(default=4, ge=1, le=16)
    agent_max_traversal_depth: int = Field(default=2, ge=1, le=5)
    agent_max_nodes: int = Field(default=100, ge=1, le=1000)
    agent_max_edges: int = Field(default=200, ge=0, le=2000)
    agent_max_evidence_bytes: int = Field(default=65_536, ge=1024)
    agent_max_model_iterations: int = Field(default=2, ge=1, le=3)
    agent_response_language_mode: Literal["match-user"] = "match-user"
    agent_default_language: Literal["es", "en"] = "es"
    conversation_database_url: str = "sqlite+aiosqlite:///./conversations.db"
    conversation_retention_days: int = Field(default=30, ge=1, le=3650)
    conversation_max_turns: int = Field(default=100, ge=1, le=1000)
    conversation_history_max_turns: int = Field(default=6, ge=1, le=50)
    conversation_history_max_chars: int = Field(default=8000, ge=256, le=100_000)
    conversation_request_lease_seconds: int = Field(default=300, ge=30, le=3600)
    conversation_cleanup_interval_seconds: int = Field(default=3600, ge=60, le=86_400)

    project_storage_root: str = "/knowledge/projects"
    upload_session_ttl_hours: int = Field(default=24, ge=1, le=168)
    project_archive_retention_days: int = Field(default=30, ge=1, le=3650)
    knowledge_worker_poll_seconds: float = Field(default=1.0, gt=0, le=60)

    knowledge_input_dir: str = "/knowledge/input"
    knowledge_staging_dir: str = "/knowledge/staging"
    knowledge_graph_dir: str = "/knowledge/graph"
    knowledge_archive_dir: str = "/knowledge/archive"
    knowledge_failed_dir: str = "/knowledge/failed"
    knowledge_manifest_path: str = "/knowledge/state/manifest.json"
    knowledge_source_index_path: str = "/knowledge/state/source-index.sqlite"
    knowledge_ingest_on_startup: bool = True
    knowledge_force_rebuild: bool = False
    knowledge_admin_endpoints_enabled: bool = True
    knowledge_max_document_size_bytes: int = Field(
        default=2 * 1024 * 1024, ge=1024, le=100 * 1024 * 1024
    )
    knowledge_max_document_count: int = Field(default=100, ge=1, le=10_000)
    knowledge_max_total_source_bytes: int = Field(
        default=32 * 1024 * 1024, ge=1024, le=1024 * 1024 * 1024
    )
    knowledge_max_extracted_document_bytes: int = Field(
        default=8 * 1024 * 1024, ge=1024, le=256 * 1024 * 1024
    )
    knowledge_document_profiles_json: str = DEFAULT_DOCUMENT_PROFILES_JSON
    knowledge_graph_versions_to_keep: int = Field(default=2, ge=2, le=20)
    graphify_extract_backend: Literal["openai"] = "openai"
    graphify_extract_model: str | None = None
    knowledge_build_timeout_seconds: float = Field(default=1800, gt=0, le=7200)

    # PL/SQL analysis console (read-only gateway; see
    # docs/architecture/plsql-analysis-console.md and ADR 0012).
    plsql_adapter: Literal["disabled", "synthetic", "neo4j"] = "disabled"
    plsql_project_id: str = "sample"
    plsql_source_root: str | None = None
    plsql_neo4j_uri: str | None = None
    plsql_neo4j_user: str | None = None
    plsql_neo4j_password: str | None = None
    plsql_neo4j_read_only: bool = True
    plsql_max_rows: int = Field(default=200, ge=1, le=200)
    plsql_max_hops: int = Field(default=5, ge=1, le=5)
    # Bounds how many typed-edge rows one path/impact traversal may pull from
    # the graph (frontier expansion), replacing the old whole-project edge
    # load cap. Config parameter, not a hardcoded adapter constant.
    plsql_max_traversal_edges: int = Field(default=20_000, ge=1, le=1_000_000)
    plsql_query_timeout_seconds: float = Field(default=10.0, gt=0, le=300)
    plsql_max_source_bytes: int = Field(default=262_144, ge=1024, le=10_485_760)

    @field_validator(
        "llm_api_base",
        "llm_api_key",
        "graphify_extract_model",
        "keycloak_admin_url",
        "keycloak_directory_token_url",
        "keycloak_directory_client_id",
        "keycloak_directory_client_secret",
        "plsql_source_root",
        "plsql_neo4j_uri",
        "plsql_neo4j_user",
        "plsql_neo4j_password",
        mode="before",
    )
    @classmethod
    def empty_to_none(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("knowledge_document_profiles_json", mode="before")
    @classmethod
    def empty_profiles_to_default(cls, value: object) -> object:
        return DEFAULT_DOCUMENT_PROFILES_JSON if value in (None, "") else value

    @model_validator(mode="after")
    def valid_document_profiles(self) -> Settings:
        parse_document_profiles(self.knowledge_document_profiles_json)
        if not self.allowed_tenant_ids:
            raise ValueError("At least one tenant ID must be configured")
        if (
            self.tenancy_mode == "fixed"
            and self.tenant_id not in self.allowed_tenant_ids
        ):
            raise ValueError("The fixed tenant ID must be allowlisted")
        return self

    @property
    def document_profiles(self) -> DocumentProfiles:
        return parse_document_profiles(self.knowledge_document_profiles_json)

    @property
    def knowledge_processing_fingerprint(self) -> str:
        return self.document_profiles.processing_fingerprint()

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def allowed_tenant_ids(self) -> frozenset[str]:
        return frozenset(
            item.strip() for item in self.tenant_ids.split(",") if item.strip()
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
