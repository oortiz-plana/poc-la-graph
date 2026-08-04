"""Keycloak bearer authentication and realm-role authorization."""

from .dependencies import AuthPrincipal, require_admin, require_editor, require_viewer
from .verifier import TokenVerifier

__all__ = [
    "AuthPrincipal",
    "TokenVerifier",
    "require_admin",
    "require_editor",
    "require_viewer",
]
