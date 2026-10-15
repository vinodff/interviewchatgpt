import asyncio
import io
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import stripe
from pydantic import SecretStr
from pypdf import PdfWriter
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.db import SessionLocal
from app.github_identity import STATE_COOKIE
from app.main import app
from app.models import AuthSession, LiveSession, UsageBucket, User
from app.security import COOKIE, token_hash
from app.services import extraction, knowledge
from app.services.extraction import ExtractionError, Segment
from app.services.live import LiveOrchestrator
from app.usage import charge_connection
from tests.test_api import HEADERS, signup
from tests.test_api import client as client


def test_backend_root_opens_the_web_application(client):
    response = client.get("/", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == settings.public_url


def test_english_level_and_hands_free_preferences_round_trip_without_losing_context(client):
    signup(client)
    preferences = {"role": "Platform engineer", "language": "English", "english_level": "simple", "reading_mode": "speech", "reading_wpm": 110, "grounding": "strict", "response_delivery": "talking_points", "personalization": "grounded"}
    response = client.patch("/api/profile", json={"preferences": preferences})
    assert response.status_code == 200
    saved = client.get("/api/auth/me").json()["preferences"]
    assert all(saved[key] == value for key, value in preferences.items())


@pytest.mark.parametrize("preferences", [{"english_level": "unsupported"}, {"reading_mode": "eye_tracking"}, {"reading_wpm": 0}, {"reading_wpm": 241}, {"response_delivery": "undetectable"}, {"personalization": "invent_experience"}])
def test_unsafe_or_unsupported_reader_preferences_are_rejected(client, preferences):
    signup(client)
    assert client.patch("/api/profile", json={"preferences": preferences}).status_code == 422


def test_live_ticket_binds_authentication_without_cross_port_cookie(client, monkeypatch):
    signup(client)
    session = client.post("/api/sessions", json={"consent": True}).json()
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
    url = f"/api/live/{session['id']}/ws?ticket={ticket}"
    with client.websocket_connect(url, headers={"Origin": "http://localhost:3001"}) as socket:
        assert socket.receive_json()["state"] == "listening"
        socket.send_json({"type": "stop"})
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(url, headers={"Origin": "http://localhost:3001"}):
            pass


def test_logout_revokes_already_issued_live_ticket(client):
    signup(client)
    session = client.post("/api/sessions", json={"consent": True}).json()
    ticket = client.post(f"/api/sessions/{session['id']}/ticket").json()["ticket"]
    client.post("/api/auth/logout")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/live/{session['id']}/ws?ticket={ticket}", headers={"Origin": "http://localhost:3001"}):
            pass


@pytest.mark.parametrize("failure", ["lease", "database", "stop_marker"])
def test_accepted_socket_still_closes_when_cleanup_dependencies_fail(client, monkeypatch, failure):
    signup(client)
    session = client.post("/api/sessions", json={"consent": True}).json()
    ticket = client.post(f"/api/sessions/{session['id']}/ticket").json()["ticket"]

    class QuietOrchestrator:
        terminal_error = False

        def __init__(self, _session_id, _user_id, send):
            self.send = send

        async def run(self, _queue, stop):
            await self.send({"type": "status", "state": "listening"})
            await stop.wait()

    async def unavailable(*_args, **_kwargs):
        raise RedisConnectionError("test outage")

    monkeypatch.setattr("app.services.live.LiveOrchestrator", QuietOrchestrator)
    if failure == "lease":
        monkeypatch.setattr("app.main.coordination.release", unavailable)
    elif failure == "database":
        monkeypatch.setattr("app.main.charge_connection", unavailable)
    else:
        from app.cache import coordination
        original_set = coordination.set

        async def failed_stop_marker(key, *args, **kwargs):
            if key.startswith("stop:"):
                await unavailable()
            return await original_set(key, *args, **kwargs)

        monkeypatch.setattr(coordination, "set", failed_stop_marker)
    with client.websocket_connect(f"/api/live/{session['id']}/ws?ticket={ticket}", headers={"Origin": "http://localhost:3001"}) as socket:
        assert socket.receive_json()["state"] == "listening"
        socket.send_json({"type": "stop"})
        # An HTTP error/denial response after accept is not a valid WS message.
        assert socket.receive() == {"type": "websocket.close", "code": 1000, "reason": ""}


async def test_chunked_upload_is_capped_before_spooling(client, monkeypatch):
    signup(client)
    monkeypatch.setattr(settings, "max_upload_bytes", 1024)
    consumed = 0
    async def stream():
        nonlocal consumed
        yield b'--boundary\r\nContent-Disposition: form-data; name="file"; filename="resume.txt"\r\nContent-Type: text/plain\r\n\r\n'
        for _ in range(40):
            consumed += 65536
            yield b"a" * 65536
        yield b"\r\n--boundary--\r\n"
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS, cookies=dict(client.cookies)) as value:
        response = await value.post("/api/sources/upload", content=stream(), headers={"Content-Type": "multipart/form-data; boundary=boundary"})
    assert response.status_code == 413, response.text
    assert consumed <= settings.max_upload_bytes + 1024 * 1024 + 65536


async def test_anonymous_upload_does_not_read_body(client):
    await asyncio.to_thread(client.post, "/api/auth/logout")
    consumed = False
    async def stream():
        nonlocal consumed
        consumed = True
        yield b"a" * 2**20
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as value:
        response = await value.post("/api/sources/upload", content=stream(), headers={"Content-Type": "multipart/form-data; boundary=x"})
    assert response.status_code == 401
    assert not consumed


async def test_cumulative_accounting_is_idempotent_across_cancelled_commit(client):
    user = signup(client)
    session = client.post("/api/sessions", json={"consent": True}).json()
    async with SessionLocal() as db:
        assert await charge_connection(db, user["id"], session["id"], "connection-a", 5) == 5
    # Equivalent to finalization retry after the commit succeeded but caller was cancelled.
    async with SessionLocal() as db:
        assert await charge_connection(db, user["id"], session["id"], "connection-a", 5) == 0
        assert await charge_connection(db, user["id"], session["id"], "connection-a", 7) == 2
        assert (await db.get(LiveSession, session["id"])).billed_seconds == 7
        assert (await db.scalar(select(UsageBucket).where(UsageBucket.user_id == user["id"]))).seconds == 7


async def test_private_github_rejected_before_content_requests(monkeypatch):
    calls = []
    async def response(_client, path, **_kwargs):
        calls.append(path)
        return {"private": True, "visibility": "private", "default_branch": "main"}
    monkeypatch.setattr(extraction, "_github_json", response)
    with pytest.raises(ExtractionError, match="Only public"):
        await extraction.extract_github("https://github.com/owner/secret")
    assert calls == ["/repos/owner/secret"]


@pytest.mark.parametrize("committer_id,expected", [(42, True), (99, False)])
async def test_signed_commit_requires_author_and_committer_identity(monkeypatch, committer_id, expected):
    sha = "a" * 40
    async def response(_client, path, **_kwargs):
        if path.endswith("/commits"):
            return [{"sha": sha, "author": {"id": 42, "login": "alice"}, "committer": {"id": committer_id}, "commit": {"message": "Add API handler", "verification": {"verified": True}}}]
        if "/git/trees/" in path:
            return {"tree": []}
        return {"private": False, "visibility": "public", "default_branch": "main"}
    monkeypatch.setattr(extraction, "_github_json", response)
    result = await extraction.extract_github("https://github.com/alice/project", "alice", {"id": 42, "login": "alice"})
    assert result.segments[0].metadata["verified_contribution"] is expected


def test_supported_quote_cannot_launder_unsupported_achievement_label():
    segment = Segment("The project uses PostgreSQL for storing users.", "README:L1")
    raw = {"facts": [{"category": "achievement", "label": "Scaled to ten million paying users", "quote": "uses PostgreSQL for storing users", "locator": "README:L1", "classification": "reported_experience"}]}
    assert knowledge._ground_facts(raw, [segment], repository=False) == []


def test_scanned_pdf_page_limit_is_applied_during_serialization(monkeypatch):
    writer = PdfWriter()
    for _ in range(3):
        writer.add_blank_page(width=100, height=100)
    output = io.BytesIO()
    writer.write(output)
    monkeypatch.setattr(extraction, "MAX_SCANNED_PAGES", 2)
    serialized = 0
    original = extraction.PdfWriter.write
    def record(self, destination):
        nonlocal serialized
        serialized += 1
        return original(self, destination)
    monkeypatch.setattr(extraction.PdfWriter, "write", record)
    with pytest.raises(ExtractionError, match="Scanned PDF exceeds"):
        extraction._read_pdf(output.getvalue())
    assert serialized == 2


def test_scanned_pdf_serialized_bytes_are_bounded(monkeypatch):
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    output = io.BytesIO()
    writer.write(output)
    monkeypatch.setattr(extraction, "MAX_SCANNED_BYTES", 100)
    with pytest.raises(ExtractionError, match="serialized-page byte limit"):
        extraction._read_pdf(output.getvalue())


def test_live_profile_prompt_has_a_budget():
    service = LiveOrchestrator("session", "user", lambda _event: None)
    service.profile = {"facts": [{"label": "Redis", "quote": "Redis " * 500, "category": "technology"} for _ in range(20000)], "projects": [{"analysis": "x" * 2**20}]}
    assert len(service._answer_prompt("Why Redis?", [])) < 20000


def stripe_object(value):
    return stripe.StripeObject.construct_from(value, "test-only")


def test_checkout_reuses_unexpired_session_across_idempotency_windows(client, monkeypatch):
    user = signup(client)
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_price_id", "price_pro")
    async def setup():
        async with SessionLocal() as db:
            item = await db.get(User, user["id"])
            item.stripe_customer_id = "cus_test"
            await db.commit()
    asyncio.run(setup())
    monkeypatch.setattr(stripe.Subscription, "list", lambda **_kwargs: SimpleNamespace(data=[], has_more=False))
    monkeypatch.setattr(stripe.checkout.Session, "list", lambda **_kwargs: SimpleNamespace(data=[SimpleNamespace(mode="subscription", url="https://checkout.stripe.com/existing")], has_more=False))
    def forbidden_create(**_kwargs):
        raise AssertionError("A second payable checkout must not be created")
    monkeypatch.setattr(stripe.checkout.Session, "create", forbidden_create)
    assert client.post("/api/billing/checkout").json()["url"].endswith("existing")
    assert client.post("/api/billing/checkout").json()["url"].endswith("existing")


def test_late_deleted_subscription_event_cannot_downgrade_current_subscription(client, monkeypatch):
    user = signup(client)
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_webhook_secret", SecretStr("test-only"))
    monkeypatch.setattr(settings, "stripe_price_id", "price_pro")
    async def setup():
        async with SessionLocal() as db:
            item = await db.get(User, user["id"])
            item.stripe_customer_id = "cus_test"
            await db.commit()
    asyncio.run(setup())
    event = stripe_object({"id": "evt_old", "type": "customer.subscription.deleted", "data": {"object": {"id": "sub_old", "customer": "cus_test"}}})
    active = stripe_object({"id": "sub_new", "status": "active", "items": {"data": [{"price": {"id": "price_pro"}}]}})
    monkeypatch.setattr(stripe.Webhook, "construct_event", lambda *_args: event)
    monkeypatch.setattr(stripe.Subscription, "list", lambda **_kwargs: SimpleNamespace(data=[active], has_more=False))
    assert client.post("/api/billing/webhook", content=b"fixture").status_code == 200
    assert client.get("/api/auth/me").json()["plan"] == "pro"
    assert client.post("/api/billing/webhook", content=b"duplicate fixture").status_code == 200


def test_delinquent_subscription_keeps_account_recoverable(client, monkeypatch):
    user = signup(client)
    monkeypatch.setattr(settings, "stripe_secret_key", SecretStr("test-only"))
    async def setup():
        async with SessionLocal() as db:
            item = await db.get(User, user["id"])
            item.stripe_customer_id = "cus_test"
            item.plan = "free"
            await db.commit()
    asyncio.run(setup())
    monkeypatch.setattr(stripe.Subscription, "list", lambda **_kwargs: SimpleNamespace(data=[SimpleNamespace(status="past_due")], has_more=False))
    monkeypatch.setattr(stripe.checkout.Session, "list", lambda **_kwargs: SimpleNamespace(data=[], has_more=False))
    assert client.delete("/api/auth/account").status_code == 409
    assert client.get("/api/auth/me").status_code == 200


def test_github_oauth_state_is_browser_bound_single_use(client, monkeypatch):
    signup(client)
    monkeypatch.setattr(settings, "github_client_id", "test-id")
    monkeypatch.setattr(settings, "github_client_secret", SecretStr("test-only"))
    response = client.post("/api/profile/github/connect")
    assert response.status_code == 200
    from urllib.parse import parse_qs, urlparse
    state = parse_qs(urlparse(response.json()["url"]).query)["state"][0]
    assert STATE_COOKIE in client.cookies
    assert client.get("/api/profile/github/callback", params={"state": "wrong", "code": "fixture"}).status_code == 400
    # Revoke the issuing auth session: callback cannot bind identity after logout/expiry.
    async def expire():
        async with SessionLocal() as db:
            auth = await db.get(AuthSession, token_hash(client.cookies[COOKIE]))
            auth.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
    asyncio.run(expire())
    assert client.get("/api/profile/github/callback", params={"state": state, "code": "fixture"}).status_code == 401
    assert client.get("/api/profile/github/callback", params={"state": state, "code": "fixture"}).status_code == 400
