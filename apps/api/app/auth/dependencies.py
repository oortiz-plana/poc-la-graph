"""FastAPI authentication dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal, cast

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config.settings import Settings

from .verifier import AuthenticationError, TokenVerifier

Role = Literal["viewer", "editor", "admin"]
_bearer = HTTPBearer(auto_error=False)


class AuthorizationError(PermissionError):
    """The authenticated principal lacks a required realm role."""


@dataclass(frozen=True)
class AuthPrincipal:
    subject: str
    username: str
    roles: frozenset[str]


async def current_principal(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuthPrincipal:
    settings = cast(Settings, request.app.state.settings)
    if not settings.auth_enabled:
        return AuthPrincipal(
            "development-user",
            "development-user",
            frozenset({"admin", "editor", "viewer"}),
        )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError("Bearer authentication is required")
    verifier = cast(TokenVerifier, request.app.state.token_verifier)
    verified = await verifier.verify(credentials.credentials)
    return AuthPrincipal(verified.subject, verified.username, verified.roles)


def require_role(role: Role):  # type: ignore[no-untyped-def]
    async def dependency(
        principal: Annotated[AuthPrincipal, Depends(current_principal)],
    ) -> AuthPrincipal:
        if role not in principal.roles:
            raise AuthorizationError(f"The {role} role is required")
        return principal

    return dependency


require_viewer = require_role("viewer")
require_editor = require_role("editor")
require_admin = require_role("admin")
