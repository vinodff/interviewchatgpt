import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from app.cache import coordination
from app.config import settings
from app.db import SessionLocal, engine
from app.main import app
from app.models import Base, LiveSession, User
from app.storage import checked_path, read_private
from app.usage import charge

HEADERS = {"X-InterviewPilot": "1", "Origin": "http://localhost:3000"}


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Test database URLs are set by the shell before imports. Never wipe a deployed database.
    assert settings.database_url.startswith("sqlite"), "Set DATABASE_URL=sqlite+aiosqlite:///./data/test-api.db"
    monkeypatch.setattr(settings, "local_test_mode", False)
    monkeypatch.setattr(settings, "local_test_user_id", "")
    async def reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    asyncio.run(reset())
    coordination.memory.clear()
    monkeypatch.setattr(settings, "upload_dir", tmp_path / "uploads")
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("test-only-provider-key"))
    with TestClient(app, headers=HEADERS) as value:
        yield value


def signup(client, email="person@example.com"):
    response = client.post("/api/auth/register", json={"email": email, "password": "a-secure-test-password", "name": "Test user"})
    assert response.status_code == 201, response.text
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    return response.json()


def test_accounts_and_tenant_isolation(client):
    signup(client)
    project = client.post("/api/projects", json={"name": "Private project"}).json()
    assert client.get("/api/projects").json()[0]["id"] == project["id"]
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/projects").status_code == 401
    signup(client, "other@example.com")
    assert client.get("/api/projects").json() == []
    assert client.delete("/api/projects/" + project["id"]).status_code == 404
    assert client.post("/api/sources/upload", data={"project_id": project["id"]}, files={"file": ("resume.txt", b"Private text")}).status_code == 404


def test_csrf_and_bad_login(client):
    signup(client)
    assert client.post("/api/projects", json={"name": "bad"}, headers={"Origin": "https://attacker.invalid"}).status_code == 403
    assert client.post("/api/auth/login", json={"email": "person@example.com", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "person@example.com", "password": "a-secure-test-password"}).status_code == 200


def test_encrypted_upload_and_duplicates(client):
    signup(client)
    response = client.post("/api/sources/upload", files={"file": ("resume.txt", b"Private personal data")})
    assert response.status_code == 202
    source = response.json()
    assert "storage_path" not in source
    assert source["status"] == "queued"
    assert client.get(f"/api/sources/{source['id']}/download").content == b"Private personal data"
    encrypted = list(settings.upload_dir.glob("*.enc"))[0].read_bytes()
    assert b"Private personal data" not in encrypted
    duplicate = client.post("/api/sources/upload", files={"file": ("resume.txt", b"Private personal data")})
    assert duplicate.json()["id"] == source["id"]
    assert client.post("/api/sources/upload", files={"file": (".env", b"secret")}).status_code == 415
    assert client.post("/api/sources/upload", files={"file": ("file.exe", b"MZ")}).status_code == 415
    assert client.delete(f"/api/sources/{source['id']}").status_code == 200
    assert not list(settings.upload_dir.glob("*.enc"))


def test_consent_ticket_ownership_and_stop(client):
    signup(client)
    assert client.post("/api/sessions", json={"consent": False}).status_code == 422
    session = client.post("/api/sessions", json={"consent": True, "retention": False}).json()
    assert session["retention"] is False
    ticket = client.post(f"/api/sessions/{session['id']}/ticket").json()["ticket"]
    assert asyncio.run(coordination.consume("ticket:" + __import__("hashlib").sha256(ticket.encode()).hexdigest()))
    assert asyncio.run(coordination.consume("ticket:" + __import__("hashlib").sha256(ticket.encode()).hexdigest())) is None
    assert client.post(f"/api/sessions/{session['id']}/stop").json()["status"] == "ended"
    assert client.post(f"/api/sessions/{session['id']}/ticket").status_code == 409


def test_monthly_usage_never_exceeds_allowance(client, monkeypatch):
    user = signup(client)
    monkeypatch.setattr(settings, "free_minutes", 1)
    session = client.post("/api/sessions", json={"consent": True}).json()
    async def bill():
        async with SessionLocal() as db:
            assert await charge(db, user["id"], session["id"], 40) == 40
            assert await charge(db, user["id"], session["id"], 40) == 20
            assert await charge(db, user["id"], session["id"], 5) == 0
            record = await db.get(LiveSession, session["id"])
            assert record.billed_seconds == 60
    asyncio.run(bill())
    assert client.post("/api/sessions", json={"consent": True}).status_code == 403
    assert client.get("/api/auth/me").json()["minutes_used"] == 1


def test_account_delete_removes_private_data(client):
    user = signup(client)
    project = client.post("/api/projects", json={"name": "Delete me"}).json()
    client.post("/api/sources/upload", data={"project_id": project["id"]}, files={"file": ("resume.txt", b"Erase me")})
    assert client.delete("/api/auth/account").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert not list(settings.upload_dir.glob("*.enc"))
    async def deleted():
        async with SessionLocal() as db:
            assert await db.scalar(select(User).where(User.id == user["id"])) is None
    asyncio.run(deleted())


def test_private_storage_path_guard():
    with pytest.raises(ValueError):
        checked_path("../../secrets")
    with pytest.raises(ValueError):
        asyncio.run(read_private("../../secrets"))


def test_billing_unconfigured_and_unsigned_webhook(client):
    signup(client)
    assert client.post("/api/billing/checkout").status_code == 503
    assert client.post("/api/billing/webhook", json={"type": "customer.subscription.updated"}).status_code in {400, 503}
