"""Tenant-scoped enterprise identity directory boundary."""

from .keycloak import DirectoryEntry, KeycloakDirectoryClient

__all__ = ["DirectoryEntry", "KeycloakDirectoryClient"]
