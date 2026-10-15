import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.cache import coordination
from app.config import loopback_host, settings
from app.db import SessionLocal
from app.models import AuthSession, User

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
COOKIE = "interviewpilot_session"
dummy_hash = hasher.hash(secrets.token_urlsafe(32))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


async def database():
    async with SessionLocal() as session:
        yield session


async def current_user(request: Request, db: AsyncSession = Depends(database)) -> User:
    if settings.local_test_mode and not local_testing_request(request):
        raise HTTPException(403, "Testing access is only available on this device")
    token = request.cookies.get(COOKIE, "")
    if len(token) > 200 or not token:
        raise HTTPException(401, "Sign in to continue")
    auth = await db.get(AuthSession, token_hash(token))
    if not auth or aware(auth.expires_at) <= datetime.now(UTC):
        raise HTTPException(401, "Your session has expired. Sign in again")
    user = await db.get(User, auth.user_id)
    if not user:
        raise HTTPException(401, "Sign in to continue")
    if settings.local_test_mode and not settings.testing_user(user.id):
        raise HTTPException(403, "This browser session belongs to another account. Clear its site cookies to open the testing workspace")
    return user


def local_testing_request(request: HTTPConnection) -> bool:
    """Require loopback with the supported local runner's proxy handling disabled.

    ASGI scopes contain the original peer only when no upstream middleware trusts
    forwarded headers. Start testing mode through ``python -m scripts.run_local``;
    arbitrary Uvicorn/proxy configurations are not supported for this mode.
    """
    if not request.client or not loopback_host(request.client.host) or not loopback_host(request.url.hostname):
        return False
    origin = request.headers.get("origin")
    if origin and origin not in settings.allowed_origins:
        return False
    return not origin or loopback_host(urlparse(origin).hostname)


async def local_testing_user(request: Request, response: Response, db: AsyncSession) -> User:
    if not local_testing_request(request):
        raise HTTPException(403, "Testing access is only available on this device")
    token = request.cookies.get(COOKIE, "")
    if token and len(token) <= 200:
        auth = await db.get(AuthSession, token_hash(token))
        if auth and aware(auth.expires_at) > datetime.now(UTC):
            return await current_user(request, db)
    user = await db.get(User, settings.local_test_user_id)
    if not user:
        raise HTTPException(503, "The configured testing workspace does not exist. Set LOCAL_TEST_USER_ID to an existing account")
    await rate_limit("test-bootstrap:" + request.client.host, 20, 60)
    await issue_cookie(user.id, db, response)
    return user


async def rate_limit(key: str, limit=60, period=60):
    if not await coordination.hit("rate:" + token_hash(key), limit, period):
        raise HTTPException(429, "Too many requests. Please try again shortly", headers={"Retry-After": str(period)})


async def check_password(password: str, encoded: str) -> bool:
    try:
        return await asyncio.to_thread(hasher.verify, encoded, password)
    except (VerificationError, InvalidHashError):
        return False


async def issue_cookie(user_id: str, db: AsyncSession, response: Response):
    token = secrets.token_urlsafe(48)
    db.add(AuthSession(token_hash=token_hash(token), user_id=user_id, expires_at=datetime.now(UTC) + timedelta(days=settings.session_days)))
    await db.commit()
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="strict", max_age=settings.session_days * 86400, path="/")


async def revoke_all(user_id: str, db: AsyncSession):
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
