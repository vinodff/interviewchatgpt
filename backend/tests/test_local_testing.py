import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.requests import HTTPConnection
from starlette.websockets import WebSocketDisconnect

from app.config import Settings, settings
from app.db import SessionLocal
from app.main import app
from app.models import AuthSession, LiveSession, User
from app.security import COOKIE, local_testing_request, token_hash
from app.server import server_config as container_config
from app.usage import charge, charge_connection, minute_limit
from scripts.run_local import server_config as local_config
from tests.test_api import HEADERS, signup
from tests.test_api import client as client

USER_ID = "fbcd7326-082e-4886-a50c-36234a8d2a0d"


@pytest.fixture
def testing_client(client, monkeypatch):
    user = signup(client)
    monkeypatch.setattr(settings, "local_test_mode", True)
    monkeypatch.setattr(settings, "local_test_user_id", user["id"])
    # Real HTTP and WebSocket transports have an actual loopback peer. Do not trust
    # forwarding headers or special TestClient names in production access checks.
    value = TestClient(app, base_url="http://localhost:3000", headers=HEADERS, client=("127.0.0.1", 50001))
    yield value, user
    value.close()


@pytest.mark.parametrize("environment", ["production", "staging", "Development"])
def test_testing_mode_refuses_non_development_environments(environment):
    with pytest.raises(ValidationError, match="only available in development or test"):
        Settings(_env_file=None, environment=environment, local_test_mode=True, local_test_user_id=USER_ID)


@pytest.mark.parametrize("changes", [
    {"local_test_user_id": ""},
    {"public_url": "https://public.example.com"},
    {"allowed_origins": ["http://192.168.1.10:3001"]},
])
def test_testing_mode_requires_explicit_owner_and_local_origins(changes):
    values = dict(environment="test", local_test_mode=True, local_test_user_id=USER_ID,
                  public_url="http://localhost:3001", allowed_origins=["http://127.0.0.1:3001"])
    values.update(changes)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_normal_authentication_remains_required(client):
    assert client.get("/api/auth/me").status_code == 401
    user = signup(client)
    assert user["testing_mode"] is False
    assert isinstance(user["minute_limit"], int)


def test_anonymous_bootstrap_preserves_owner_and_issues_real_session(testing_client):
    client, owner = testing_client
    response = client.get("/api/auth/me")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == owner["id"]
    assert response.json()["testing_mode"] is True
    assert response.json()["minute_limit"] is None
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    token = client.cookies[COOKIE]

    async def verify():
        async with SessionLocal() as db:
            auth = await db.get(AuthSession, token_hash(token))
            assert auth.user_id == owner["id"]
            assert (await db.get(User, owner["id"])).plan == owner["plan"]
    asyncio.run(verify())
    assert "set-cookie" not in client.get("/api/auth/me").headers


@pytest.mark.parametrize("peer,host,origin", [
    ("192.168.1.25", "localhost", "http://localhost:3000"),
    ("127.0.0.1", "rebound.attacker.invalid", "http://localhost:3000"),
    ("127.0.0.1", "localhost", "https://attacker.invalid"),
])
def test_testing_workspace_rejects_remote_peers_rebinding_and_untrusted_origins(testing_client, peer, host, origin):
    remote = TestClient(app, base_url="http://" + host, client=(peer, 50002))
    try:
        response = remote.get("/api/auth/me", headers={"Origin": origin, "X-Forwarded-For": "127.0.0.1"})
        assert response.status_code == 403
        assert "set-cookie" not in response.headers
        with pytest.raises(WebSocketDisconnect):
            with remote.websocket_connect("/api/live/any/ws?ticket=anything", headers={"Origin": origin}):
                pass
    finally:
        remote.close()


def test_testing_bootstrap_cannot_switch_another_valid_authenticated_tenant(testing_client):
    client, owner = testing_client

    async def other_session():
        async with SessionLocal() as db:
            other = User(email="another-tenant@example.com", name="Other user", password_hash="unusable")
            db.add(other)
            await db.flush()
            db.add(AuthSession(token_hash=token_hash("another-tenant-token"), user_id=other.id,
                               expires_at=datetime.now(UTC) + timedelta(days=1)))
            await db.commit()
    asyncio.run(other_session())
    client.cookies.set(COOKIE, "another-tenant-token")
    response = client.get("/api/auth/me")
    assert response.status_code == 403
    assert "set-cookie" not in response.headers
    assert client.get("/api/projects").status_code == 403


def test_unlimited_testing_keeps_metering_and_does_not_mutate_plan(testing_client, monkeypatch):
    client, owner = testing_client
    assert client.get("/api/auth/me").status_code == 200
    monkeypatch.setattr(settings, "free_minutes", 1)
    session = client.post("/api/sessions", json={"consent": True}).json()

    async def meter():
        async with SessionLocal() as db:
            assert await charge(db, owner["id"], session["id"], 90) == 90
            assert await charge_connection(db, owner["id"], session["id"], "test-connection", 18000) == 18000
            assert await charge_connection(db, owner["id"], session["id"], "test-connection", 18000) == 0
            assert (await db.get(LiveSession, session["id"])).billed_seconds == 18090
            user = await db.get(User, owner["id"])
            assert user.plan == "free"
            assert minute_limit(user) is None
            other = User(id=USER_ID, plan="free")
            assert minute_limit(other) == 1
    asyncio.run(meter())
    assert client.get("/api/auth/me").json()["minutes_used"] == 301.5
    assert client.post("/api/sessions", json={"consent": True}).status_code == 201


def test_testing_ticket_and_socket_require_real_auth_and_ignore_app_time_cap(testing_client, monkeypatch):
    client, owner = testing_client
    assert client.get("/api/auth/me").status_code == 200
    session = client.post("/api/sessions", json={"consent": True}).json()

    async def exceed_normal_cap():
        async with SessionLocal() as db:
            await charge(db, owner["id"], session["id"], settings.max_session_seconds + 1)
    asyncio.run(exceed_normal_cap())
    ticket = client.post(f"/api/sessions/{session['id']}/ticket").json()["ticket"]

    class QuietOrchestrator:
        terminal_error = False

        def __init__(self, _session_id, _user_id, send):
            self.send = send

        async def run(self, _queue, stop):
            await self.send({"type": "status", "state": "listening"})
            await stop.wait()

    monkeypatch.setattr("app.services.live.LiveOrchestrator", QuietOrchestrator)
    client.cookies.clear()
    url = f"ws://localhost:3000/api/live/{session['id']}/ws?ticket={ticket}"
    with client.websocket_connect(url, headers={"Origin": "http://localhost:3000"}) as socket:
        assert socket.receive_json()["state"] == "listening"
        socket.send_json({"type": "stop"})
        assert socket.receive()["type"] == "websocket.close"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(url, headers={"Origin": "http://localhost:3000"}):
            pass


def test_testing_mode_preserves_consent_owner_access_and_saved_account(testing_client):
    client, _ = testing_client
    client.get("/api/auth/me")
    assert client.post("/api/sessions", json={"consent": False}).status_code == 422
    assert client.delete("/api/projects/not-owned").status_code == 404
    assert client.delete("/api/auth/account").status_code == 403
    assert client.post("/api/auth/register", json={}).status_code == 403
    assert client.post("/api/auth/login", json={}).status_code == 403
    assert client.post("/api/billing/checkout").status_code == 403
    assert client.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("connection_type", ["http", "websocket"])
def test_local_uvicorn_stack_preserves_raw_peer_despite_spoofed_forwarding_headers(monkeypatch, connection_type):
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "*")
    observed = {}

    async def inspect_connection(scope, _receive, _send):
        observed["peer"] = scope["client"]
        observed["allowed"] = local_testing_request(HTTPConnection(scope))

    config = local_config(8001)
    assert config.host == "127.0.0.1"
    assert config.proxy_headers is False
    config.app = inspect_connection
    config.load()
    scope = {"type": connection_type, "asgi": {"version": "3.0"}, "http_version": "1.1",
             "scheme": "http" if connection_type == "http" else "ws", "method": "GET",
             "server": ("127.0.0.1", 8001), "client": ("192.168.1.25", 50001),
             "path": "/api/auth/me", "root_path": "", "query_string": b"",
             "headers": [(b"host", b"localhost:8001"), (b"origin", b"http://localhost:3000"),
                         (b"x-forwarded-for", b"127.0.0.1"), (b"x-forwarded-proto", b"http")]}
    asyncio.run(config.loaded_app(scope, None, None))
    assert observed["peer"] == ("192.168.1.25", 50001)
    assert observed["allowed"] is False


def test_container_entrypoint_refuses_testing_mode_even_in_development(monkeypatch):
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "local_test_mode", True)
    with pytest.raises(RuntimeError, match="forbidden in containers"):
        container_config()


def test_normal_container_keeps_production_proxy_transport(monkeypatch):
    monkeypatch.setattr(settings, "local_test_mode", False)
    config = container_config()
    assert config.host == "0.0.0.0"
    assert config.proxy_headers is True
