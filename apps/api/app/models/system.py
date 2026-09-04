"""Health and normalized error models."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", serialize_by_alias=True)


class Health(StrictModel):
    status: Literal["ok"] = "ok"


class Readiness(StrictModel):
    ready: bool
    components: dict[str, dict[str, str]]


class Problem(StrictModel):
    requestId: str
    code: Literal[
        "invalid_request",
        "unauthorized",
        "forbidden",
        "conversation_not_found",
        "conversation_busy",
        "project_not_found",
        "project_conflict",
        "upload_invalid",
        "analysis_not_configured",
        "analysis_not_found",
        "analysis_unavailable",
        "analysis_limit_exceeded",
        "internal_error",
    ]
    message: str
