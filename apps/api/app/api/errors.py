"""Stable error responses with correlation identifiers."""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.models import Problem
from app.store import ConversationNotFound, ConversationRequestConflict


class InvalidRequest(ValueError):
    pass


def request_id(request: Request) -> str:
    return str(getattr(request.state, "request_id", "unknown"))


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    del exc
    return JSONResponse(
        status_code=422,
        content=Problem(
            requestId=request_id(request),
            code="invalid_request",
            message="The request is invalid.",
        ).model_dump(),
    )


async def not_found_handler(
    request: Request, exc: ConversationNotFound
) -> JSONResponse:
    del exc
    return JSONResponse(
        status_code=404,
        content=Problem(
            requestId=request_id(request),
            code="conversation_not_found",
            message="The conversation was not found.",
        ).model_dump(),
    )


async def conflict_handler(
    request: Request, exc: ConversationRequestConflict
) -> JSONResponse:
    del exc
    return JSONResponse(
        status_code=409,
        content=Problem(
            requestId=request_id(request),
            code="conversation_busy",
            message="This conversation is already processing another request.",
        ).model_dump(),
    )


async def invalid_request_handler(
    request: Request, exc: InvalidRequest
) -> JSONResponse:
    del exc
    return JSONResponse(
        status_code=422,
        content=Problem(
            requestId=request_id(request),
            code="invalid_request",
            message="The request is invalid.",
        ).model_dump(),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    request.app.state.logger.exception(
        "unhandled_request_error",
        extra={"request_id": request_id(request), "error_type": type(exc).__name__},
    )
    return JSONResponse(
        status_code=500,
        content=Problem(
            requestId=request_id(request),
            code="internal_error",
            message="The request could not be completed.",
        ).model_dump(),
    )
