import asyncio
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import AuthSession, User
from app.security import COOKIE
from tests.test_api import client as client
from tests.test_api import signup

IDENTITY_ID = "1b981f5c-c44a-4dd7-a47b-8da988b7f864"
IDENTITY = {
    "id": IDENTITY_ID,
    "email": "person@example.com",
    "email_confirmed_at": "2026-10-24T00:00:00Z",
    "user_metadata": {"full_name": "Verified person"},
}


def provider(monkeypatch, *, data=None, status=200, outage=False):
    monkeypatch.setattr(settings, "supabase_url", "https://auth.example.invalid")
    monkeypatch.setattr(settings, "supabase_anon_key", SecretStr("test-publishable-key"))
    requests = []

    def handle(request):
        requests.append(request)
        if outage:
            raise httpx.ConnectError("provider unavailable", request=request)
        return httpx.Response(status, json=IDENTITY if data is None else data)

    original = httpx.AsyncClient
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr("app.supabase_auth.httpx.AsyncClient", lambda **kwargs: original(transport=transport, **kwargs))
    return requests


def assert_no_authentication(response):
    assert "set-cookie" not in response.headers

    async def count():
        async with SessionLocal() as db:
            return await db.scalar(select(func.count()).select_from(AuthSession))

    assert asyncio.run(count()) == 0


def test_forged_supabase_identity_cannot_sign_in_as_existing_account(client, monkeypatch):
    user = signup(client)
    client.post("/api/auth/logout")
    provider(monkeypatch, status=401)
    response = client.post("/api/auth/supabase-session", json={
        "user_id": user["id"], "email": user["email"], "access_token": "forged-token",
    })
    assert response.status_code == 401
    assert_no_authentication(response)
    assert client.get("/api/auth/me").status_code == 401


def test_supabase_requires_access_token(client):
    response = client.post("/api/auth/supabase-session", json={"user_id": IDENTITY_ID, "email": IDENTITY["email"]})
    assert response.status_code == 422
    assert_no_authentication(response)


def test_verified_supabase_identity_is_derived_from_provider(client, monkeypatch):
    requests = provider(monkeypatch)
    response = client.post("/api/auth/supabase-session", json={"access_token": "verified-token", "name": "Untrusted name"})
    assert response.status_code == 200
    assert response.json()["id"] == IDENTITY_ID
    assert response.json()["email"] == IDENTITY["email"]
    assert response.json()["name"] == "Verified person"
    assert COOKIE in response.cookies
    assert client.get("/api/auth/me").json()["id"] == IDENTITY_ID
    assert str(requests[0].url) == "https://auth.example.invalid/auth/v1/user"
    assert requests[0].headers["authorization"] == "Bearer verified-token"
    assert requests[0].headers["apikey"] == "test-publishable-key"
    # OAuth-only accounts fail a password login cleanly rather than crashing on the marker hash.
    assert client.post("/api/auth/login", json={"email": IDENTITY["email"], "password": "wrong-password"}).status_code == 401


def test_verified_supabase_email_links_existing_password_account(client, monkeypatch):
    user = signup(client)
    client.post("/api/auth/logout")
    provider(monkeypatch)
    response = client.post("/api/auth/supabase-session", json={
        "access_token": "verified-token", "user_id": IDENTITY_ID, "email": IDENTITY["email"],
    })
    assert response.status_code == 200
    assert response.json()["id"] == user["id"]


@pytest.mark.parametrize("claims", [{"email": "victim@example.com"}, {"user_id": str(uuid4())}])
def test_supabase_rejects_identity_claims_that_do_not_match_verified_token(client, monkeypatch, claims):
    provider(monkeypatch)
    response = client.post("/api/auth/supabase-session", json={"access_token": "verified-token", **claims})
    assert response.status_code == 401
    assert_no_authentication(response)


def test_unconfirmed_supabase_email_cannot_link_existing_account(client, monkeypatch):
    signup(client)
    client.post("/api/auth/logout")
    provider(monkeypatch, data={**IDENTITY, "email_confirmed_at": None})
    response = client.post("/api/auth/supabase-session", json={"access_token": "unconfirmed-token"})
    assert response.status_code == 403
    assert_no_authentication(response)


@pytest.mark.parametrize("options", [{"outage": True}, {"status": 503}, {"status": 302}, {"data": {"id": IDENTITY_ID}}])
def test_supabase_provider_errors_fail_closed(client, monkeypatch, options):
    provider(monkeypatch, **options)
    response = client.post("/api/auth/supabase-session", json={"access_token": "unverified-token"})
    assert response.status_code == 503
    assert_no_authentication(response)


def test_missing_supabase_configuration_fails_closed(client, monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", SecretStr(""))
    response = client.post("/api/auth/supabase-session", json={"access_token": "unverified-token"})
    assert response.status_code == 503
    assert_no_authentication(response)


def test_verified_supabase_id_cannot_select_an_account_with_different_email(client, monkeypatch):
    user = signup(client, "different@example.com")
    client.post("/api/auth/logout")
    provider(monkeypatch, data={**IDENTITY, "id": user["id"]})
    response = client.post("/api/auth/supabase-session", json={"access_token": "verified-token"})
    assert response.status_code == 409
    assert_no_authentication(response)

    async def unchanged():
        async with SessionLocal() as db:
            return (await db.get(User, user["id"])).email

    assert asyncio.run(unchanged()) == "different@example.com"
