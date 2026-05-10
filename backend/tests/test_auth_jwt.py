"""Clerk JWT verification — the AUTH-P1-01 rewrite.

Generates a throwaway RSA keypair per test, signs a token, and runs it through
`_verify_clerk_jwt` while monkey-patching the JWKS fetcher so no network happens.

`_verify_clerk_jwt` returns a `(sub, sid)` tuple so the auth dependency can also
enforce the device-cap (sid is the Clerk session id). Failure modes return
`(None, None)` rather than just None, so tests assert on the tuple shape.
"""

import asyncio
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services import auth as auth_module


def _run(coro):
    return asyncio.run(coro)


def _rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_pem, public_pem


def _sign(private_pem: bytes, payload: dict[str, Any], kid: str = "test-kid") -> str:
    return jwt.encode(payload, private_pem, algorithm="RS256", headers={"kid": kid})


def _default_claims(issuer: str = "https://example.clerk.accounts.dev") -> dict[str, Any]:
    now = int(time.time())
    return {
        "sub": "user_abc123",
        "iss": issuer,
        "iat": now,
        "exp": now + 3600,
    }


@pytest.fixture(autouse=True)
def _reset_jwks_cache():
    """Each test starts with an empty JWKS cache so fixtures don't leak keys."""
    auth_module._jwks_cache.clear()
    yield
    auth_module._jwks_cache.clear()


def _install_key(monkeypatch, public_pem: bytes, kid: str = "test-kid"):
    """Stub out _fetch_jwks to return a key derived from the local public PEM."""
    loaded_key = serialization.load_pem_public_key(public_pem)

    async def fake_fetch(_url: str) -> dict[str, Any]:
        return {kid: loaded_key}

    monkeypatch.setattr(auth_module, "_fetch_jwks", fake_fetch)


def test_valid_token_returns_sub(monkeypatch):
    priv, pub = _rsa_keypair()
    _install_key(monkeypatch, pub)
    token = _sign(priv, _default_claims())
    sub, sid = _run(auth_module._verify_clerk_jwt(token))
    assert sub == "user_abc123"
    # No `sid` was set in the default claims, so it should come back as None.
    assert sid is None


def test_valid_token_returns_sid_when_present(monkeypatch):
    priv, pub = _rsa_keypair()
    _install_key(monkeypatch, pub)
    claims = _default_claims()
    claims["sid"] = "sess_xyz789"
    token = _sign(priv, claims)
    sub, sid = _run(auth_module._verify_clerk_jwt(token))
    assert sub == "user_abc123"
    assert sid == "sess_xyz789"


def test_expired_token_returns_none(monkeypatch):
    priv, pub = _rsa_keypair()
    _install_key(monkeypatch, pub)
    claims = _default_claims()
    claims["iat"] = int(time.time()) - 7200
    claims["exp"] = int(time.time()) - 3600
    token = _sign(priv, claims)
    assert _run(auth_module._verify_clerk_jwt(token)) == (None, None)


def test_wrong_signing_key_returns_none(monkeypatch):
    priv_a, _pub_a = _rsa_keypair()
    _priv_b, pub_b = _rsa_keypair()
    # JWKS has B's public key, but the token was signed with A's private key.
    _install_key(monkeypatch, pub_b)
    token = _sign(priv_a, _default_claims())
    assert _run(auth_module._verify_clerk_jwt(token)) == (None, None)


def test_untrusted_issuer_rejected(monkeypatch):
    priv, pub = _rsa_keypair()
    _install_key(monkeypatch, pub)
    # Attacker-controlled host masquerading as Clerk.
    token = _sign(priv, _default_claims(issuer="https://evil.example.com"))
    assert _run(auth_module._verify_clerk_jwt(token)) == (None, None)


def test_missing_kid_returns_none(monkeypatch):
    priv, pub = _rsa_keypair()
    _install_key(monkeypatch, pub)
    # jwt.encode will always add an alg; we omit kid explicitly.
    token = jwt.encode(_default_claims(), priv, algorithm="RS256")
    assert _run(auth_module._verify_clerk_jwt(token)) == (None, None)


def test_malformed_token_returns_none():
    assert _run(auth_module._verify_clerk_jwt("not.a.jwt")) == (None, None)
    assert _run(auth_module._verify_clerk_jwt("")) == (None, None)
