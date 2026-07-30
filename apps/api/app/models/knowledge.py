"""Development-only knowledge administration contracts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class KnowledgeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IngestionRequest(KnowledgeModel):
    force: bool = False


class IngestionAccepted(KnowledgeModel):
    ingestionId: str
    status: Literal["accepted"] = "accepted"


class IngestionStatus(KnowledgeModel):
    ingestionId: str | None
    status: Literal["idle", "running", "completed", "failed"]
    startedAt: str | None = None
    completedAt: str | None = None
    errorCode: str | None = None


class KnowledgeGraphStatus(KnowledgeModel):
    status: Literal["ready", "building", "unavailable"]
    activeGraphVersion: str | None
    graphifyVersion: str
    generatedAt: str | None
    documentCount: int
