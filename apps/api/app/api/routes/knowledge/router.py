"""Configuration-guarded development knowledge administration routes."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, HTTPException, Request, status

from app.knowledge.service import IngestionConflict, KnowledgeIngestionService
from app.models import (
    IngestionAccepted,
    IngestionRequest,
    IngestionStatus,
    KnowledgeGraphStatus,
)

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge administration"])


def _service(request: Request) -> KnowledgeIngestionService:
    return cast(KnowledgeIngestionService, request.app.state.knowledge)


@router.post(
    "/ingestions",
    response_model=IngestionAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start a development-only graph rebuild",
)
async def create_ingestion(
    request: Request, body: IngestionRequest
) -> IngestionAccepted:
    try:
        identifier = await _service(request).start(force=body.force)
    except IngestionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return IngestionAccepted(ingestionId=identifier)


@router.get("/ingestions/current", response_model=IngestionStatus)
async def current_ingestion(request: Request) -> IngestionStatus:
    return IngestionStatus.model_validate(_service(request).current())


@router.get("/graph", response_model=KnowledgeGraphStatus)
async def graph_status(request: Request) -> KnowledgeGraphStatus:
    return KnowledgeGraphStatus.model_validate(_service(request).graph_status())
