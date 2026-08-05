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
    tenant_id: str = "default"
    group_ids: frozenset[str] = frozenset()


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
            settings.tenant_id,
        )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError(
            "Bearer authentication is required", reason="bearer_missing"
        )
    verifier = cast(TokenVerifier, request.app.state.token_verifier)
    verified = await verifier.verify(credentials.credentials)
    if settings.tenancy_mode == "claim":
        tenant = verified.claims.get(settings.auth_tenant_claim)
        if not isinstance(tenant, str) or not tenant.strip():
            raise AuthenticationError("Invalid bearer token", reason="tenant_missing")
        tenant_id = tenant.strip()
    else:
        tenant_id = settings.tenant_id
    if tenant_id not in settings.allowed_tenant_ids:
        raise AuthenticationError("Invalid bearer token", reason="tenant_not_allowed")
    raw_groups = verified.claims.get(settings.auth_groups_claim, [])
    groups = (
        frozenset(item for item in raw_groups if isinstance(item, str) and item)
        if isinstance(raw_groups, list)
        else frozenset()
    )
    return AuthPrincipal(
        verified.subject,
        verified.username,
        verified.roles,
        tenant_id,
        groups,
    )


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
