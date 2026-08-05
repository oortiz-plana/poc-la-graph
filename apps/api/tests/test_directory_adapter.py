from __future__ import annotations

import json

import httpx

from app.integrations.directory import KeycloakDirectoryClient


async def test_keycloak_directory_search_and_stable_group_ids() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/token":
            return httpx.Response(
                200, json={"access_token": "directory-token", "expires_in": 60}
            )
        if request.url.path.endswith("/users"):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "user-id",
                        "username": "ana",
                        "firstName": "Ana",
                        "lastName": "Legal",
                        "email": "ana@example.test",
                    }
                ],
            )
        if request.url.path.endswith("/groups") and "/users/" not in request.url.path:
            return httpx.Response(200, json=[{"id": "group-id", "name": "Legal"}])
        if request.url.path.endswith("/users/user-id/groups"):
            return httpx.Response(200, json=[{"id": "group-id", "name": "Legal"}])
        return httpx.Response(404, content=json.dumps({}).encode())

    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    directory = KeycloakDirectoryClient(
        admin_url="https://id.example.test/admin/realms/acme",
        token_url="https://id.example.test/token",
        client_id="directory-client",
        client_secret="secret",
        client=http,
    )
    entries = await directory.search("legal", "tenant-a")
    assert [(entry.type, entry.id) for entry in entries] == [
        ("user", "user-id"),
        ("group", "group-id"),
    ]
    assert await directory.groups_for_user("user-id") == frozenset({"group-id"})
    assert await directory.groups_for_user("user-id") == frozenset({"group-id"})
    assert calls.count("/admin/realms/acme/users/user-id/groups") == 1
    await http.aclose()
