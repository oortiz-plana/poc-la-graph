"""Bounded Keycloak Admin REST directory search."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx


@dataclass(frozen=True)
class DirectoryEntry:
    id: str
    type: Literal["user", "group"]
    display_name: str
    secondary_text: str | None = None


class KeycloakDirectoryClient:
    def __init__(
        self,
        *,
        admin_url: str | None,
        token_url: str | None,
        client_id: str | None,
        client_secret: str | None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._admin_url = admin_url.rstrip("/") if admin_url else None
        self._token_url = token_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._client = client or httpx.AsyncClient(timeout=10.0)
        self._owns_client = client is None
        self._token: str | None = None
        self._expires_at = 0.0
        self._lock = asyncio.Lock()
        self._group_cache: dict[str, tuple[float, frozenset[str]]] = {}

    @property
    def configured(self) -> bool:
        return all(
            (self._admin_url, self._token_url, self._client_id, self._client_secret)
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def search(
        self, query: str, tenant_id: str, limit: int = 20
    ) -> list[DirectoryEntry]:
        if not self.configured:
            return []
        token = await self._access_token()
        headers = {"Authorization": f"Bearer {token}"}
        users, groups = await asyncio.gather(
            self._client.get(
                f"{self._admin_url}/users",
                headers=headers,
                params={"search": query, "q": f"tenant_id:{tenant_id}", "max": limit},
            ),
            self._client.get(
                f"{self._admin_url}/groups",
                headers=headers,
                params={"search": query, "q": f"tenant_id:{tenant_id}", "max": limit},
            ),
        )
        users.raise_for_status()
        groups.raise_for_status()
        entries: list[DirectoryEntry] = []
        for item in users.json():
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            username = item.get("username")
            email = item.get("email")
            display = " ".join(
                part
                for part in (item.get("firstName"), item.get("lastName"))
                if isinstance(part, str) and part
            ) or (username if isinstance(username, str) else item["id"])
            entries.append(
                DirectoryEntry(
                    item["id"],
                    "user",
                    display,
                    email
                    if isinstance(email, str)
                    else username
                    if isinstance(username, str)
                    else None,
                )
            )
        for item in groups.json():
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                continue
            name = item.get("name")
            entries.append(
                DirectoryEntry(
                    item["id"],
                    "group",
                    name if isinstance(name, str) else item["id"],
                    "Directory group",
                )
            )
        return entries[:limit]

    async def groups_for_user(self, subject: str) -> frozenset[str]:
        if not self.configured:
            return frozenset()
        cached = self._group_cache.get(subject)
        if cached and time.monotonic() < cached[0]:
            return cached[1]
        token = await self._access_token()
        response = await self._client.get(
            f"{self._admin_url}/users/{subject}/groups",
            headers={"Authorization": f"Bearer {token}"},
            params={"briefRepresentation": "true", "max": 1000},
        )
        response.raise_for_status()
        payload = response.json()
        groups = frozenset(
            item["id"]
            for item in payload
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )
        self._group_cache[subject] = (time.monotonic() + 60, groups)
        return groups

    async def _access_token(self) -> str:
        if self._token and time.monotonic() < self._expires_at:
            return self._token
        async with self._lock:
            if self._token and time.monotonic() < self._expires_at:
                return self._token
            response = await self._client.post(
                str(self._token_url),
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
            )
            response.raise_for_status()
            payload: Any = response.json()
            token = payload.get("access_token") if isinstance(payload, dict) else None
            if not isinstance(token, str) or not token:
                raise ValueError("Directory token response is invalid")
            expires = payload.get("expires_in", 60)
            self._token = token
            self._expires_at = time.monotonic() + max(int(expires) - 15, 15)
            return token
