"""Async JWT verification with bounded, refreshable Keycloak JWKS caching."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import InvalidTokenError, PyJWK
from jwt.exceptions import PyJWTError


class AuthenticationError(ValueError):
    """A bearer token is missing or cannot be trusted."""


@dataclass(frozen=True)
class VerifiedToken:
    subject: str
    username: str
    roles: frozenset[str]
    claims: dict[str, Any]


class TokenVerifier:
    """Verify RS256 tokens without exposing provider responses to callers."""

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks_url: str,
        cache_seconds: int = 300,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.jwks_url = jwks_url
        self.cache_seconds = cache_seconds
        self._client = client
        self._owned_client: httpx.AsyncClient | None = None
        self._keys: dict[str, PyJWK] = {}
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        if self._owned_client is not None:
            await self._owned_client.aclose()
            self._owned_client = None

    async def verify(self, token: str) -> VerifiedToken:
        try:
            header = jwt.get_unverified_header(token)
        except InvalidTokenError as exc:
            raise AuthenticationError("Invalid bearer token") from exc
        kid = header.get("kid")
        algorithm = header.get("alg")
        if not isinstance(kid, str) or algorithm != "RS256":
            raise AuthenticationError("Invalid bearer token")

        key = await self._key(kid, force=False)
        if key is None:
            key = await self._key(kid, force=True)
        if key is None:
            raise AuthenticationError("Invalid bearer token")
        try:
            claims = jwt.decode(
                token,
                key=key.key,
                algorithms=["RS256"],
                audience=self.audience,
                issuer=self.issuer,
                options={"require": ["exp", "iat", "iss", "sub"]},
            )
        except InvalidTokenError as exc:
            raise AuthenticationError("Invalid bearer token") from exc

        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise AuthenticationError("Invalid bearer token")
        username_value = claims.get("preferred_username", subject)
        username = username_value if isinstance(username_value, str) else subject
        realm_access = claims.get("realm_access")
        raw_roles = (
            realm_access.get("roles", []) if isinstance(realm_access, dict) else []
        )
        roles = {role for role in raw_roles if isinstance(role, str)}
        if "admin" in roles:
            roles.update(("editor", "viewer"))
        if "editor" in roles:
            roles.add("viewer")
        return VerifiedToken(subject, username, frozenset(roles), claims)

    async def _key(self, kid: str, *, force: bool) -> PyJWK | None:
        now = time.monotonic()
        if not force and now < self._expires_at:
            return self._keys.get(kid)
        async with self._lock:
            now = time.monotonic()
            if not force and now < self._expires_at:
                return self._keys.get(kid)
            client = self._client
            if client is None:
                if self._owned_client is None:
                    self._owned_client = httpx.AsyncClient(timeout=10.0)
                client = self._owned_client
            try:
                response = await client.get(self.jwks_url)
                response.raise_for_status()
                payload = response.json()
                raw_keys = payload.get("keys", []) if isinstance(payload, dict) else []
                keys: dict[str, PyJWK] = {}
                for item in raw_keys:
                    if not isinstance(item, dict):
                        continue
                    key_id = item.get("kid")
                    if not isinstance(key_id, str):
                        continue
                    if item.get("use") not in {None, "sig"}:
                        continue
                    if item.get("alg") not in {None, "RS256"}:
                        continue
                    try:
                        keys[key_id] = PyJWK.from_dict(item, algorithm="RS256")
                    except (PyJWTError, ValueError):
                        continue
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                raise AuthenticationError("Authentication service unavailable") from exc
            self._keys = keys
            self._expires_at = now + self.cache_seconds
            return keys.get(kid)
