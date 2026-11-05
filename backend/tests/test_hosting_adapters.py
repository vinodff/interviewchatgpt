import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr, ValidationError
from sqlalchemy import update
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings, settings
from app.coordination_store import PostgresCoordination, runtime_coordination
from app.storage import cipher, delete_private, read_private, write_private

SOURCE_ID = "26a75599-85a8-4e9c-a625-741f9f1c32a3"


@pytest.fixture
async def store(tmp_path):
    engine = create_async_engine("sqlite+aiosqlite:///" + str(tmp_path / "coordination.db"))
    async with engine.begin() as connection:
        await connection.run_sync(runtime_coordination.create)
    yield PostgresCoordination(engine)
    await engine.dispose()


async def expire(store, key):
    async with store.engine.begin() as connection:
        await connection.execute(update(runtime_coordination).where(runtime_coordination.c.key == key).values(
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        ))


async def test_shared_database_leases_are_atomic_and_owner_bound(store):
    other = PostgresCoordination(store.engine)
    results = await asyncio.gather(*[store.set("lease", str(i), 60, nx=True) for i in range(16)])
    assert sum(results) == 1
    owner = await other.get("lease")
    assert owner is not None
    assert not await other.renew("lease", "wrong-owner", 60)
    await other.release("lease", "wrong-owner")
    assert await other.get("lease") == owner
    assert await other.renew("lease", owner, 60)
    await expire(store, "lease")
    assert await store.get("lease") is None
    assert not await store.renew("lease", owner, 60)
    assert await other.set("lease", "new-owner", 60, nx=True)
    await store.release("lease", owner)
    assert await store.get("lease") == "new-owner"
    await store.release("lease", "new-owner")
    assert await store.get("lease") is None


async def test_shared_database_tickets_can_be_consumed_only_once(store):
    await store.set("ticket", "identity-binding", 60)
    values = await asyncio.gather(*[store.consume("ticket") for _ in range(16)])
    assert values.count("identity-binding") == 1
    assert values.count(None) == 15
    await store.set("expired-ticket", "old-identity", 60)
    await expire(store, "expired-ticket")
    assert await store.consume("expired-ticket") is None


async def test_database_counter_is_atomic_and_expiry_resets_window(store):
    values = await asyncio.gather(*[store.hit("counter", 5, 60) for _ in range(20)])
    assert sum(values) == 5
    await expire(store, "counter")
    assert await store.hit("counter", 5, 60)
    assert await store.get("counter") == "1"
    await store.set("replace", "one", 60)
    await store.set("replace", "two", 60)
    assert await store.get("replace") == "two"
    await store.delete("replace")
    assert await store.get("replace") is None


@pytest.fixture
def remote_storage(monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "supabase")
    monkeypatch.setattr(settings, "supabase_url", "https://project.example.invalid")
    monkeypatch.setattr(settings, "supabase_service_role_key", SecretStr("test-service-secret"))
    monkeypatch.setattr(settings, "supabase_storage_bucket", "interviewpilot-private")
    monkeypatch.setattr(settings, "encryption_key", SecretStr(Fernet.generate_key().decode()))
    requests = []
    objects = {}

    def handle(request):
        requests.append(request)
        if "__network_error__" in objects:
            raise httpx.ConnectError("sensitive-provider-response", request=request)
        if "__response_status__" in objects:
            return httpx.Response(objects["__response_status__"], text="sensitive-provider-response")
        key = request.url.path
        if request.method == "POST":
            objects[key] = request.content
            return httpx.Response(200, json={"Key": key})
        if request.method == "GET":
            return httpx.Response(200, content=objects[key])
        objects.pop(key, None)
        return httpx.Response(200)

    original = httpx.AsyncClient
    monkeypatch.setattr("app.storage.httpx.AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    return requests, objects


async def test_private_remote_storage_encrypts_round_trip_and_deletes(remote_storage):
    requests, objects = remote_storage
    path = await write_private(SOURCE_ID, b"Private resume details")
    assert path == f"supabase://interviewpilot-private/{SOURCE_ID}.enc"
    stored = next(iter(objects.values()))
    assert b"Private resume details" not in stored
    assert cipher().decrypt(stored) == b"Private resume details"
    assert await read_private(path) == b"Private resume details"
    await delete_private(path)
    assert not objects
    assert [request.method for request in requests] == ["POST", "GET", "DELETE"]
    assert all(request.headers["authorization"] == "Bearer test-service-secret" for request in requests)
    assert all(request.headers["apikey"] == "test-service-secret" for request in requests)


@pytest.mark.parametrize("path", [
    "supabase://other-bucket/26a75599-85a8-4e9c-a625-741f9f1c32a3.enc",
    "supabase://interviewpilot-private/../secret.enc",
    "supabase://interviewpilot-private/%2e%2e/secret.enc",
    "supabase://interviewpilot-private/26a75599-85a8-4e9c-a625-741f9f1c32a3.enc?download=true",
    "C:/private/local-file.enc",
])
async def test_remote_storage_rejects_untrusted_paths_before_network(remote_storage, path):
    requests, _ = remote_storage
    with pytest.raises(ValueError, match="Invalid private storage path"):
        await read_private(path)
    with pytest.raises(ValueError, match="Invalid private storage path"):
        await delete_private(path)
    assert not requests


async def test_remote_storage_requires_configuration_and_stable_encryption_key(remote_storage, monkeypatch):
    requests, _ = remote_storage
    monkeypatch.setattr(settings, "supabase_service_role_key", SecretStr(""))
    with pytest.raises(RuntimeError, match="not configured"):
        await write_private(SOURCE_ID, b"private")
    monkeypatch.setattr(settings, "supabase_service_role_key", SecretStr("test-key"))
    monkeypatch.setattr(settings, "encryption_key", SecretStr(""))
    with pytest.raises(RuntimeError, match="stable encryption key"):
        await write_private(SOURCE_ID, b"private")
    assert not requests


async def test_remote_storage_rejects_invalid_identifiers_and_handles_network_failures(remote_storage):
    requests, objects = remote_storage
    with pytest.raises(ValueError, match="Invalid private storage identifier"):
        await write_private("../secret", b"private")
    assert not requests
    objects["__network_error__"] = True
    with pytest.raises(RuntimeError, match="temporarily unavailable") as failure:
        await write_private(SOURCE_ID, b"private")
    assert "sensitive-provider-response" not in str(failure.value)


@pytest.mark.parametrize("status", [302, 400, 403, 500])
async def test_remote_storage_fails_closed_without_exposing_provider_response(remote_storage, monkeypatch, status):
    _, objects = remote_storage
    objects["__response_status__"] = status
    with pytest.raises(RuntimeError, match="Private object storage") as failure:
        await write_private(SOURCE_ID, b"private")
    assert "sensitive-provider-response" not in str(failure.value)
    assert "test-service-secret" not in str(failure.value)


def production_settings(**changes):
    values = dict(environment="production", local_test_mode=False,
                  database_url="postgresql+asyncpg://test:unused@localhost/test", redis_url="memory://",
                  cookie_secure=True, encryption_key=SecretStr(Fernet.generate_key().decode()),
                  gemini_api_key=SecretStr("test-key"), public_url="https://app.example.com",
                  allowed_origins=["https://app.example.com"], coordination_backend="postgres")
    values.update(changes)
    return Settings(_env_file=None, **values)


def test_production_allows_shared_postgres_coordination_and_rejects_memory():
    assert production_settings().coordination_backend == "postgres"
    with pytest.raises(ValidationError, match="shared Redis or PostgreSQL"):
        production_settings(coordination_backend="redis")


def test_supabase_publishable_key_alias(monkeypatch):
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test-publishable-key")
    assert Settings(_env_file=None).supabase_anon_key.get_secret_value() == "test-publishable-key"
