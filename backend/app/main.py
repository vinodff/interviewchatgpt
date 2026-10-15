import asyncio
import json
import logging
import secrets
import time
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from redis.exceptions import RedisError
from sqlalchemy import func, select, text, update
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api import router
from app.billing import router as billing_router
from app.body_limit import BodyLimitMiddleware
from app.cache import coordination
from app.config import settings
from app.db import SessionLocal, engine, initialize_database
from app.github_identity import router as github_router
from app.models import AuthSession, LiveSession, User
from app.security import aware, current_user, local_testing_request, token_hash
from app.usage import charge_connection, minute_limit, used_seconds

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app):
    if settings.environment != "production":
        await initialize_database()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if coordination.redis:
        await coordination.redis.ping()
    yield
    if coordination.redis:
        await coordination.redis.aclose()
    await engine.dispose()


app = FastAPI(title="InterviewPilot Live API", version="0.1.0", lifespan=lifespan,
              docs_url="/api/docs" if settings.environment != "production" else None)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-InterviewPilot"])
app.add_middleware(BodyLimitMiddleware)
if settings.environment == "production":
    from urllib.parse import urlparse
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list({urlparse(o).hostname for o in settings.allowed_origins} | {"backend"}))


@app.middleware("http")
async def security_boundary(request: Request, call_next):
    if request.url.path.startswith("/api/"):
        if settings.local_test_mode:
            if not local_testing_request(request):
                return JSONResponse({"detail": "Testing access is only available on this device"}, status_code=403)
            if request.url.path in {"/api/auth/register", "/api/auth/login", "/api/auth/reset-request", "/api/auth/reset-confirm", "/api/billing/checkout", "/api/billing/portal"}:
                return JSONResponse({"detail": "Accounts and billing are disabled in the local testing workspace"}, status_code=403)
        if request.url.path == "/api/sources/upload":
            from fastapi import HTTPException
            try:
                async with SessionLocal() as db:
                    await current_user(request, db)
            except HTTPException as error:
                return JSONResponse({"detail": error.detail}, status_code=error.status_code)
        try:
            content_length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "Invalid request size"}, status_code=400)
        if content_length > settings.max_upload_bytes + 1024 * 1024:
            return JSONResponse({"detail": "Request exceeds the file size limit"}, status_code=413)
        if request.method in {"POST", "PATCH", "DELETE", "PUT"} and request.url.path != "/api/billing/webhook":
            origin = request.headers.get("origin")
            if request.headers.get("x-interviewpilot") != "1" or (origin and origin not in settings.allowed_origins) or (settings.environment == "production" and not origin):
                return JSONResponse({"detail": "Request origin could not be verified"}, status_code=403)
        client_ip = request.client.host if request.client else "unknown"
        try:
            allowed = await coordination.hit("http:" + token_hash(client_ip), 600, 60)
        except RedisError:
            return JSONResponse({"detail": "Live connection authentication is temporarily unavailable. Please retry shortly."}, status_code=503)
        if not allowed:
            return JSONResponse({"detail": "Too many requests"}, status_code=429)
    response = await call_next(request)
    response.headers.update({"X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
                             "Referrer-Policy": "same-origin", "Cache-Control": "no-store"})
    if settings.environment == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.exception_handler(Exception)
async def unexpected(_request: Request, error: Exception):
    # Avoid logging exception messages: SDK/HTTP exceptions may contain credentials or document text.
    logger.error("Unhandled API error type=%s", type(error).__name__)
    return JSONResponse({"detail": "The service could not complete this request. Please try again"}, status_code=500)


@app.exception_handler(RedisError)
async def coordination_unavailable(_request: Request, error: RedisError):
    logger.warning("Coordination service unavailable type=%s", type(error).__name__)
    return JSONResponse({"detail": "Live connection authentication is temporarily unavailable. Please retry shortly."}, status_code=503)


app.include_router(router, prefix="/api")
app.include_router(billing_router, prefix="/api")
app.include_router(github_router, prefix="/api")


@app.get("/", include_in_schema=False)
async def open_application():
    return RedirectResponse(settings.public_url, status_code=307)


@app.get("/api/health")
async def health():
    database_ok = redis_ok = False
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
        database_ok = True
        redis_ok = bool(await coordination.redis.ping()) if coordination.redis else True
    except Exception as error:
        logger.warning("Health check failed type=%s", type(error).__name__)
    status = "ok" if database_ok and redis_ok else "degraded"
    return JSONResponse({"status": status, "database": "postgresql" if engine.dialect.name == "postgresql" else "sqlite-development",
                         "redis": "redis" if coordination.redis else "memory-development",
                         "ai_configured": bool(settings.gemini_api_key.get_secret_value()),
                         "billing_configured": bool(settings.stripe_secret_key.get_secret_value() and settings.stripe_price_id)}, status_code=200 if status == "ok" else 503)


@app.websocket("/api/live/{session_id}/ws")
async def live_socket(websocket: WebSocket, session_id: str):
    if settings.local_test_mode and not local_testing_request(websocket):
        await websocket.close(code=4403)
        return
    if websocket.headers.get("origin") not in settings.allowed_origins:
        logger.warning("Live authorization refused: untrusted origin")
        await websocket.close(code=4403)
        return
    ticket = websocket.query_params.get("ticket", "")
    if not ticket or len(ticket) > 100:
        await websocket.close(code=4401)
        return
    claim = await coordination.consume("ticket:" + token_hash(ticket))
    try:
        binding = json.loads(claim or "null")
    except ValueError:
        binding = None
    if not isinstance(binding, dict) or binding.get("session_id") != session_id or not isinstance(binding.get("user_id"), str) or not isinstance(binding.get("auth_hash"), str):
        logger.warning("Live authorization refused: ticket expired or invalid")
        await websocket.close(code=4401)
        return
    user_id, auth_hash = binding["user_id"], binding["auth_hash"]
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        session = await db.scalar(select(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user_id))
        # Ticket issuance required the cookie. Recheck that exact authenticated session,
        # without depending on a second cookie handoff to another port/browser surface.
        auth = await db.get(AuthSession, auth_hash)
        if not user or not session or not auth or auth.user_id != user_id or aware(auth.expires_at) <= datetime.now(UTC):
            logger.warning("Live authorization refused: issuing account session unavailable")
            await websocket.close(code=4401)
            return
        if settings.local_test_mode and not settings.testing_user(user_id):
            await websocket.close(code=4403)
            return
        limit = minute_limit(user)
        session_limit = None if settings.testing_user(user_id) else settings.max_session_seconds
        if session.status == "ended" or await coordination.get("stop:" + session_id) or (limit is not None and await used_seconds(db, user_id) >= limit * 60):
            logger.warning("Live authorization refused: ended session or usage allowance reached")
            await websocket.close(code=4403)
            return
        if session_limit is not None and session.billed_seconds >= session_limit:
            await websocket.close(code=4403)
            return
        base_seconds = session.billed_seconds
    lock_value = session_id + ":" + secrets.token_urlsafe(12)
    lock_key = "socket:" + user_id
    if not await coordination.set(lock_key, lock_value, 20, nx=True):
        logger.warning("Live authorization refused: another live connection is active")
        await websocket.close(code=4409)
        return
    try:
        async with SessionLocal() as db:
            if await coordination.get("stop:" + session_id):
                await coordination.release(lock_key, lock_value)
                await websocket.close(code=4403)
                return
            result = await db.execute(update(LiveSession).where(LiveSession.id == session_id, LiveSession.user_id == user_id, LiveSession.status != "ended").values(status="live", started_at=func.coalesce(LiveSession.started_at, datetime.now(UTC))))
            if result.rowcount != 1:
                await coordination.release(lock_key, lock_value)
                await websocket.close(code=4403)
                return
            await db.commit()
        await websocket.accept()
    except Exception:
        with suppress(Exception):
            await coordination.release(lock_key, lock_value)
        raise
    stop = asyncio.Event()
    send_lock = asyncio.Lock()
    queue: asyncio.Queue[tuple[int, bytes]] = asyncio.Queue(maxsize=100)
    started = time.monotonic()
    connection_id = str(uuid.uuid4())
    charged = 0
    dropped = 0
    ended = False

    async def send(message: dict):
        async with send_lock:
            await websocket.send_json(message)

    async def receive():
        nonlocal dropped, ended
        window = time.monotonic()
        frames = 0
        while not stop.is_set():
            message = await asyncio.wait_for(websocket.receive(), timeout=45)
            if message["type"] == "websocket.disconnect":
                return
            if message.get("bytes") is not None:
                data = message["bytes"]
                if not (3 <= len(data) <= 6401) or data[0] not in (0, 1) or len(data[1:]) % 2:
                    await send({"type": "error", "code": "INVALID_AUDIO", "message": "Unsupported audio frame", "recoverable": False})
                    ended = True
                    return
                if time.monotonic() - window >= 1:
                    frames, window = 0, time.monotonic()
                frames += 1
                if frames > 50:
                    ended = True
                    return
                if queue.full():
                    queue.get_nowait()
                    dropped += 1
                    if dropped == 1:
                        await send({"type": "error", "code": "AUDIO_BACKPRESSURE", "message": "Network is behind; some audio was dropped", "recoverable": True})
                queue.put_nowait((data[0], data[1:]))
            elif message.get("text"):
                if len(message["text"]) > 100:
                    ended = True
                    return
                try:
                    command = json.loads(message["text"])
                except (ValueError, TypeError):
                    ended = True
                    return
                if not isinstance(command, dict):
                    ended = True
                    return
                if command.get("type") == "stop":
                    ended = True
                    return
                if command.get("type") == "ping":
                    await send({"type": "pong"})

    async def monitor():
        nonlocal charged, ended
        while not stop.is_set():
            await asyncio.sleep(5)
            elapsed = int(time.monotonic() - started)
            if session_limit is not None:
                elapsed = min(elapsed, session_limit - base_seconds)
            delta = elapsed - charged
            async with SessionLocal() as db:
                accepted = await charge_connection(db, user_id, session_id, connection_id, elapsed)
                charged = elapsed
                auth = await db.get(AuthSession, auth_hash)
                current = await db.get(LiveSession, session_id)
            charged = elapsed
            lock_ok = await coordination.renew(lock_key, lock_value, 20)
            if accepted < delta or not auth or aware(auth.expires_at) <= datetime.now(UTC) or not current or await coordination.get("stop:" + session_id) or (session_limit is not None and base_seconds + elapsed >= session_limit) or not lock_ok:
                ended = True
                await send({"type": "status", "state": "ended", "detail": "Session stopped or usage allowance reached"})
                return

    from app.services.live import LiveOrchestrator
    orchestrator = LiveOrchestrator(session_id, user_id, send)
    tasks = [asyncio.create_task(receive()), asyncio.create_task(monitor()), asyncio.create_task(orchestrator.run(queue, stop))]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        if tasks[2] in done and orchestrator.terminal_error:
            ended = True
        for task in done:
            task.result()
    except (WebSocketDisconnect, ConnectionError, TimeoutError):
        pass
    except Exception as error:
        logger.warning("Live transport failure type=%s", type(error).__name__)
        with suppress(Exception):
            await send({"type": "error", "code": "SESSION_FAILED", "message": "Live session interrupted; reconnecting", "recoverable": True})
    finally:
        stop.set()
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        elapsed = int(time.monotonic() - started)
        if session_limit is not None:
            elapsed = min(elapsed, session_limit - base_seconds)
        # After accept, cleanup errors must not enter HTTP denial handlers. A failed
        # database or Redis operation must still allow the transport to close.
        try:
            async with SessionLocal() as db:
                await charge_connection(db, user_id, session_id, connection_id, elapsed)
                session = await db.get(LiveSession, session_id)
                if session:
                    session.metrics = {**session.metrics, "audio_dropped": session.metrics.get("audio_dropped", 0) + dropped}
                    if ended:
                        session.status, session.ended_at = "ended", datetime.now(UTC)
                    await db.commit()
        except Exception as error:
            logger.warning("Live database cleanup failed type=%s", type(error).__name__)
        if ended:
            try:
                await coordination.set("stop:" + session_id, "1", 86400)
            except Exception as error:
                logger.warning("Live stop marker unavailable type=%s", type(error).__name__)
        try:
            await coordination.release(lock_key, lock_value)
        except Exception as error:
            # The owner lease expires after 20 seconds if Redis is unavailable.
            logger.warning("Live lease release failed type=%s", type(error).__name__)
        with suppress(Exception):
            await websocket.close(code=1000 if ended else 1012)
