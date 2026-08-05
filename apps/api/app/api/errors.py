"""Stable error responses with correlation identifiers."""

from __future__ import annotations

import logging

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.auth.dependencies import AuthorizationError
from app.auth.verifier import AuthenticationError
from app.models import Problem
from app.projects import ProjectConflict, ProjectNotFound
from app.projects.repository import UploadNotFound
from app.projects.storage import UploadValidationError
from app.store import (
    ConversationNotFound,
    ConversationRequestConflict,
    ConversationStateConflict,
)


class InvalidRequest(ValueError):
    pass


def _problem(
    request: Request, status_code: int, code: str, message: str
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "requestId": request_id(request),
            "code": code,
            "message": message,
        },
    )


async def authentication_error_handler(
    request: Request, exc: AuthenticationError
) -> JSONResponse:
    logger = getattr(
        request.app.state, "logger", logging.getLogger("graphify_agent.api")
    )
    reason = getattr(exc, "reason", "invalid_token")
    extra = {
        "request_id": request_id(request),
        "method": request.method,
        "path": request.url.path,
        "status_code": 401,
        "auth_reason": reason,
    }
    logger.warning("authentication_failed", extra=extra)
    if logger.isEnabledFor(logging.DEBUG):
        cause = exc.__cause__
        logger.debug(
            "authentication_failure_debug",
            extra={**extra, "auth_cause": type(cause).__name__ if cause else None},
        )
    response = _problem(request, 401, "unauthorized", "Authentication is required.")
    response.headers["WWW-Authenticate"] = "Bearer"
    return response


async def authorization_error_handler(
    request: Request, exc: AuthorizationError
) -> JSONResponse:
    del exc
    return _problem(
        request, 403, "forbidden", "You are not allowed to perform this action."
    )


async def project_not_found_handler(
    request: Request, exc: ProjectNotFound | UploadNotFound
) -> JSONResponse:
    del exc
    return _problem(
        request, 404, "project_not_found", "The project resource was not found."
    )


async def project_conflict_handler(
    request: Request, exc: ProjectConflict
) -> JSONResponse:
    del exc
    return _problem(
        request,
        409,
        "project_conflict",
        "The project state does not allow this action.",
    )


async def upload_validation_handler(
    request: Request, exc: UploadValidationError
) -> JSONResponse:
    del exc
    return _problem(request, 422, "upload_invalid", "The upload is invalid.")


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


async def conversation_state_conflict_handler(
    request: Request, exc: ConversationStateConflict
) -> JSONResponse:
    del exc
    return _problem(
        request,
        409,
        "conversation_state_conflict",
        "The conversation state does not allow this action.",
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
