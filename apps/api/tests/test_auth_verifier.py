from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.verifier import AuthenticationError, TokenVerifier


def _encoded(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _key(kid: str) -> tuple[rsa.RSAPrivateKey, dict[str, str]]:
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private.public_key().public_numbers()
    return private, {
        "kty": "RSA",
        "kid": kid,
        "use": "sig",
        "alg": "RS256",
        "n": _encoded(numbers.n),
        "e": _encoded(numbers.e),
    }


def _token(
    private: rsa.RSAPrivateKey,
    kid: str,
    *,
    issuer: str = "http://issuer/realms/graphify",
    audience: str = "graphify-api",
    expires: timedelta = timedelta(minutes=5),
    roles: list[str] | None = None,
) -> str:
    now = datetime.now(UTC)
    claims: dict[str, Any] = {
        "sub": "subject-1",
        "preferred_username": "editor-user",
        "iss": issuer,
        "aud": audience,
        "iat": now,
        "exp": now + expires,
        "realm_access": {"roles": roles or ["editor"]},
    }
    return jwt.encode(claims, private, algorithm="RS256", headers={"kid": kid})


async def test_valid_token_and_composite_roles() -> None:
    private, public = _key("key-1")
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [public]})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        verifier = TokenVerifier(
            issuer="http://issuer/realms/graphify",
            audience="graphify-api",
            jwks_url="http://keycloak/certs",
            client=client,
        )
        verified = await verifier.verify(_token(private, "key-1"))

    assert verified.subject == "subject-1"
    assert verified.roles.issuperset({"editor", "viewer"})


async def test_ignores_keycloak_encryption_keys() -> None:
    private, public = _key("signing-key")
    encryption = {
        **public,
        "kid": "encryption-key",
        "use": "enc",
        "alg": "RSA-OAEP",
    }
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [encryption, public]})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        verifier = TokenVerifier(
            issuer="http://issuer/realms/graphify",
            audience="graphify-api",
            jwks_url="http://keycloak/certs",
            client=client,
        )
        verified = await verifier.verify(_token(private, "signing-key"))

    assert verified.subject == "subject-1"


async def test_malformed_signing_key_is_a_normalized_authentication_error() -> None:
    private, _ = _key("broken-key")
    broken = {"kid": "broken-key", "kty": "RSA", "use": "sig", "alg": "RS256"}
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [broken]})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        verifier = TokenVerifier(
            issuer="http://issuer/realms/graphify",
            audience="graphify-api",
            jwks_url="http://keycloak/certs",
            client=client,
        )
        with pytest.raises(AuthenticationError, match="Invalid bearer token"):
            await verifier.verify(_token(private, "broken-key"))


@pytest.mark.parametrize(
    ("issuer", "audience", "expires"),
    [
        ("http://wrong/realms/graphify", "graphify-api", timedelta(minutes=5)),
        ("http://issuer/realms/graphify", "wrong-api", timedelta(minutes=5)),
        ("http://issuer/realms/graphify", "graphify-api", timedelta(seconds=-1)),
    ],
)
async def test_rejects_untrusted_claims(
    issuer: str, audience: str, expires: timedelta
) -> None:
    private, public = _key("key-1")
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"keys": [public]})
    )
    async with httpx.AsyncClient(transport=transport) as client:
        verifier = TokenVerifier(
            issuer="http://issuer/realms/graphify",
            audience="graphify-api",
            jwks_url="http://keycloak/certs",
            client=client,
        )
        with pytest.raises(AuthenticationError):
            await verifier.verify(
                _token(
                    private, "key-1", issuer=issuer, audience=audience, expires=expires
                )
            )


async def test_refreshes_jwks_once_for_an_unknown_kid() -> None:
    old_private, old_public = _key("old")
    new_private, new_public = _key("new")
    calls = 0

    def response(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        del request
        calls += 1
        keys = [old_public] if calls == 1 else [old_public, new_public]
        return httpx.Response(200, json={"keys": keys})

    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as client:
        verifier = TokenVerifier(
            issuer="http://issuer/realms/graphify",
            audience="graphify-api",
            jwks_url="http://keycloak/certs",
            client=client,
        )
        await verifier.verify(_token(old_private, "old"))
        verified = await verifier.verify(_token(new_private, "new"))

    assert verified.subject == "subject-1"
    assert calls == 2
