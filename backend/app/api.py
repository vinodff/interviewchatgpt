import asyncio
import hashlib
import json
import mimetypes
import secrets
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import coordination
from app.config import settings
from app.models import AuthSession, LiveSession, PasswordReset, Project, Source, Turn, User
from app.schemas import (
    GithubImport,
    Login,
    ProfileUpdate,
    ProjectCreate,
    Register,
    ResetConfirm,
    ResetRequest,
    SessionCreate,
)
from app.security import (
    COOKIE,
    aware,
    check_password,
    current_user,
    database,
    dummy_hash,
    hasher,
    issue_cookie,
    local_testing_user,
    rate_limit,
    revoke_all,
    token_hash,
)
from app.storage import delete_private, read_private, write_private
from app.usage import minute_limit, session_dict, used_seconds, user_dict

router = APIRouter()
ALLOWED_SUFFIXES = {".pdf", ".docx", ".txt", ".md", ".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".kt", ".go", ".rs", ".c", ".cpp", ".h", ".cs", ".html", ".css", ".sql", ".json", ".yaml", ".yml", ".xml", ".toml", ".png", ".jpg", ".jpeg", ".webp", ".zip"}


def source_dict(item: Source) -> dict:
    return {"id": item.id, "project_id": item.project_id, "name": item.name, "kind": item.kind,
            "status": item.status, "error": item.error, "chunk_count": item.chunk_count,
            "analysis": {k: v for k, v in item.analysis.items() if not k.startswith("_")},
            "created_at": item.created_at.isoformat()}


async def owned(db: AsyncSession, model, item_id: str, user_id: str):
    item = await db.scalar(select(model).where(model.id == item_id, model.user_id == user_id))
    if not item:
        raise HTTPException(404, "Item not found")
    return item


async def source_quota(db: AsyncSession, user_id: str):
    await rate_limit("ingest:" + user_id, 10, 60)
    count = await db.scalar(select(func.count()).select_from(Source).where(Source.user_id == user_id))
    if count >= settings.max_sources:
        raise HTTPException(403, "Knowledge source limit reached. Delete an old source to add another")


@router.post("/auth/register", status_code=201)
async def register(body: Register, request: Request, response: Response, db: AsyncSession = Depends(database)):
    await rate_limit("register:" + (request.client.host if request.client else "unknown"), 5, 300)
    user = User(email=str(body.email).lower(), name=body.name.strip(), password_hash=await asyncio.to_thread(hasher.hash, body.password))
    if not user.name:
        raise HTTPException(422, "Enter your name")
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "An account with this email already exists") from None
    await issue_cookie(user.id, db, response)
    return await user_dict(db, user)


@router.post("/auth/login")
async def login(body: Login, request: Request, response: Response, db: AsyncSession = Depends(database)):
    await rate_limit("login-ip:" + (request.client.host if request.client else "unknown"), 15, 300)
    await rate_limit("login-account:" + str(body.email).lower(), 10, 300)
    user = await db.scalar(select(User).where(User.email == str(body.email).lower()))
    valid = await check_password(body.password, user.password_hash if user else dummy_hash)
    if not user or not valid:
        raise HTTPException(401, "Email or password is incorrect")
    old = request.cookies.get(COOKIE)
    if old:
        await db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(old)))
    await issue_cookie(user.id, db, response)
    return await user_dict(db, user)


@router.post("/auth/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(database)):
    await db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(request.cookies.get(COOKIE, ""))))
    await db.commit()
    response.delete_cookie(COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/auth/me")
async def me(request: Request, response: Response, db: AsyncSession = Depends(database)):
    user = await local_testing_user(request, response, db) if settings.local_test_mode else await current_user(request, db)
    return await user_dict(db, user)


@router.patch("/profile")
async def profile(body: ProfileUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    for field in ("name", "github_username"):
        value = getattr(body, field)
        if value is not None:
            setattr(user, field, value.strip())
    if not user.name:
        raise HTTPException(422, "Enter your name")
    if body.preferences is not None:
        user.preferences = body.preferences.model_dump()
    await db.commit()
    return await user_dict(db, user)


def send_reset(email: str, token: str):
    message = EmailMessage()
    message["Subject"] = "Reset your InterviewPilot Live password"
    message["From"] = settings.smtp_from
    message["To"] = email
    message.set_content("Reset your password within 30 minutes: " + settings.public_url + "/?reset=" + token)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password.get_secret_value())
        server.send_message(message)


@router.post("/auth/reset-request")
async def reset_request(body: ResetRequest, request: Request, db: AsyncSession = Depends(database)):
    await rate_limit("reset:" + (request.client.host if request.client else "unknown"), 5, 300)
    if not settings.smtp_host or not settings.smtp_from:
        raise HTTPException(503, "Password recovery email is not configured. Contact the application operator")
    user = await db.scalar(select(User).where(User.email == str(body.email).lower()))
    if user:
        token = secrets.token_urlsafe(32)
        await db.execute(delete(PasswordReset).where(PasswordReset.user_id == user.id))
        db.add(PasswordReset(token_hash=token_hash(token), user_id=user.id, expires_at=datetime.now(UTC) + timedelta(minutes=30)))
        await db.commit()
        try:
            await asyncio.to_thread(send_reset, user.email, token)
        except (smtplib.SMTPException, OSError):
            raise HTTPException(503, "Recovery email is temporarily unavailable") from None
    return {"ok": True, "detail": "If this account exists, a password reset email has been sent"}


@router.post("/auth/reset-confirm")
async def reset_confirm(body: ResetConfirm, db: AsyncSession = Depends(database)):
    reset = await db.get(PasswordReset, token_hash(body.token), with_for_update=True)
    if not reset or aware(reset.expires_at) <= datetime.now(UTC):
        raise HTTPException(400, "This reset link is invalid or expired")
    user = await db.get(User, reset.user_id)
    user.password_hash = await asyncio.to_thread(hasher.hash, body.password)
    await revoke_all(user.id, db)
    await db.delete(reset)
    await db.commit()
    return {"ok": True}


@router.delete("/auth/account")
async def delete_account(response: Response, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    if settings.testing_user(user.id):
        raise HTTPException(403, "Account deletion is disabled in testing mode to protect the saved workspace")
    lock_key, lock_value = "billing:" + user.id, secrets.token_urlsafe(16)
    if not await coordination.set(lock_key, lock_value, 60, nx=True):
        raise HTTPException(409, "A billing update is in progress; try again shortly")
    try:
        if user.stripe_customer_id:
            if not settings.stripe_secret_key.get_secret_value():
                raise HTTPException(503, "Billing must be available to verify account deletion")
            import stripe

            from app.billing import customer_subscriptions
            try:
                subscriptions = await customer_subscriptions(user.stripe_customer_id)
                checkout_sessions = await asyncio.to_thread(stripe.checkout.Session.list, customer=user.stripe_customer_id, limit=100, api_key=settings.stripe_secret_key.get_secret_value())
                for checkout in checkout_sessions.data:
                    if checkout.status == "open":
                        await asyncio.to_thread(stripe.checkout.Session.expire, checkout.id, api_key=settings.stripe_secret_key.get_secret_value())
                # Re-fetch after expiring open checkouts, guarding completion races.
                subscriptions = await customer_subscriptions(user.stripe_customer_id)
                if any(item.status not in {"canceled", "incomplete_expired"} for item in subscriptions):
                    raise HTTPException(409, "End every subscription in Manage subscription before deleting the account")
                if checkout_sessions.has_more:
                    raise HTTPException(409, "Billing history requires operator review before account deletion")
            except stripe.StripeError:
                raise HTTPException(503, "Billing verification failed; your account has been kept") from None
        elif user.plan == "pro":
            raise HTTPException(409, "End your subscription before deleting the account")
        files = (await db.scalars(select(Source.storage_path).where(Source.user_id == user.id))).all()
        sessions = (await db.scalars(select(LiveSession.id).where(LiveSession.user_id == user.id))).all()
        for sid in sessions:
            await coordination.set("stop:" + sid, "1", 86400)
        for path in files:
            await delete_private(path)
        await db.delete(user)
        await db.commit()
    finally:
        await coordination.release(lock_key, lock_value)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/projects")
async def projects(user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    items = (await db.scalars(select(Project).where(Project.user_id == user.id).order_by(Project.created_at.desc()))).all()
    counts = dict((await db.execute(select(Source.project_id, func.count()).where(Source.user_id == user.id).group_by(Source.project_id))).all())
    return [{"id": p.id, "name": p.name, "description": p.description, "analysis": p.analysis, "source_count": counts.get(p.id, 0), "created_at": p.created_at.isoformat()} for p in items]


@router.post("/projects", status_code=201)
async def create_project(body: ProjectCreate, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    await rate_limit("projects:" + user.id, 20, 60)
    item = Project(user_id=user.id, name=body.name.strip(), description=body.description)
    if not item.name:
        raise HTTPException(422, "Enter a project name")
    db.add(item)
    await db.commit()
    return {"id": item.id, "name": item.name, "description": item.description, "analysis": item.analysis, "source_count": 0, "created_at": item.created_at.isoformat()}


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    project = await owned(db, Project, project_id, user.id)
    files = (await db.scalars(select(Source.storage_path).where(Source.project_id == project.id, Source.user_id == user.id))).all()
    for path in files:
        await delete_private(path)
    await db.delete(project)
    await db.commit()
    from app.services.knowledge import build_profile
    await build_profile(user.id)
    return {"ok": True}


@router.post("/projects/{project_id}/github", status_code=202)
async def github(project_id: str, body: GithubImport, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    await owned(db, Project, project_id, user.id)
    await source_quota(db, user.id)
    from app.services.extraction import parse_github_url
    try:
        owner, repo = parse_github_url(body.url)
    except ValueError:
        raise HTTPException(422, "Use a GitHub repository URL: https://github.com/owner/repository") from None
    item = Source(user_id=user.id, project_id=project_id, name=f"{owner}/{repo}", kind="github", url=f"https://github.com/{owner}/{repo}")
    db.add(item)
    await db.commit()
    return source_dict(item)


@router.get("/sources")
async def sources(user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    return [source_dict(s) for s in (await db.scalars(select(Source).where(Source.user_id == user.id).order_by(Source.created_at.desc()))).all()]


@router.post("/sources/upload", status_code=202)
async def upload(file: UploadFile = File(...), project_id: str | None = Form(None), user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    await source_quota(db, user.id)
    if project_id:
        await owned(db, Project, project_id, user.id)
    name = Path((file.filename or "upload").replace("\\", "/")).name
    suffix = Path(name).suffix.lower()
    if len(name) > 255 or suffix not in ALLOWED_SUFFIXES or name.lower().startswith(".env"):
        raise HTTPException(415, "Upload a PDF, DOCX, source file, image, or ZIP project archive. Secret files are not accepted")
    content = bytearray()
    while block := await file.read(65536):
        content.extend(block)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(413, "Files must be 20 MB or smaller")
    await file.close()
    if not content:
        raise HTTPException(422, "The uploaded file is empty")
    digest = hashlib.sha256(content).hexdigest()
    duplicate = await db.scalar(select(Source).where(Source.user_id == user.id, Source.sha256 == digest, Source.project_id == project_id))
    if duplicate:
        return source_dict(duplicate)
    mime = mimetypes.guess_type(name)[0] or "text/plain"
    item = Source(user_id=user.id, project_id=project_id or None, name=name, kind="archive" if suffix == ".zip" else "image" if suffix in {".png", ".jpg", ".jpeg", ".webp"} else "document", mime_type=mime, sha256=digest)
    db.add(item)
    await db.flush()
    item.storage_path = await write_private(item.id, bytes(content))
    try:
        await db.commit()
    except Exception:
        await delete_private(item.storage_path)
        raise
    return source_dict(item)


@router.post("/sources/{source_id}/retry")
async def retry_source(source_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, Source, source_id, user.id)
    await rate_limit("retry:" + user.id, 10, 60)
    if item.status not in {"failed", "ready"}:
        raise HTTPException(409, "This source is already being processed")
    item.status, item.error, item.attempts = "queued", None, 0
    item.analysis = {k: v for k, v in item.analysis.items() if k != "_worker"}
    item.processing_started_at = None
    await db.commit()
    return source_dict(item)


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, Source, source_id, user.id)
    await delete_private(item.storage_path)
    await db.delete(item)
    await db.commit()
    from app.services.knowledge import build_profile
    await build_profile(user.id)
    return {"ok": True}


@router.get("/sources/{source_id}/download")
async def download(source_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, Source, source_id, user.id)
    if not item.storage_path:
        raise HTTPException(404, "This source is a repository reference")
    content = await read_private(item.storage_path)
    from urllib.parse import quote
    return Response(content, media_type="application/octet-stream", headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(item.name), "Cache-Control": "no-store"})


@router.get("/knowledge/search")
async def search(q: str, user: User = Depends(current_user)):
    if not q.strip() or len(q) > 1000:
        raise HTTPException(422, "Enter a search query of 1–1000 characters")
    await rate_limit("search:" + user.id, 30, 60)
    from app.services.knowledge import retrieve
    return await retrieve(user.id, q, limit=10)


@router.get("/provider/check")
async def provider_check(user: User = Depends(current_user)):
    await rate_limit("provider:" + user.id, 5, 60)
    from app.services.ai import GeminiService
    service = GeminiService()
    try:
        return await service.check()
    finally:
        await service.close()


@router.get("/sessions")
async def sessions(user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    return [session_dict(s) for s in (await db.scalars(select(LiveSession).where(LiveSession.user_id == user.id).order_by(LiveSession.created_at.desc()).limit(200))).all()]


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreate, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    if not body.consent:
        raise HTTPException(422, "Confirm that all participants consent and AI assistance is permitted")
    if not settings.gemini_api_key.get_secret_value():
        raise HTTPException(503, "The operator must configure a Gemini API key before live sessions")
    await rate_limit("sessions:" + user.id, 10, 60)
    limit = minute_limit(user)
    if limit is not None and await used_seconds(db, user.id) >= limit * 60:
        raise HTTPException(403, "Your monthly live-session allowance has been used")
    item = LiveSession(user_id=user.id, title=body.title, audio_mode=body.audio_mode, retention=body.retention)
    db.add(item)
    await db.commit()
    return session_dict(item)


@router.get("/sessions/{session_id}")
async def session_detail(session_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, LiveSession, session_id, user.id)
    turns = (await db.scalars(select(Turn).where(Turn.session_id == item.id).order_by(Turn.created_at).limit(1000))).all()
    return {**session_dict(item), "turns": [{"id": t.id, "role": t.role, "text": t.text, "question": t.question, "answer": t.answer, "evidence": t.evidence, "created_at": t.created_at.isoformat()} for t in turns]}


@router.post("/sessions/{session_id}/ticket")
async def ticket(session_id: str, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, LiveSession, session_id, user.id)
    if item.status == "ended" or await coordination.get("stop:" + item.id):
        raise HTTPException(409, "This session has ended")
    await rate_limit("tickets:" + user.id, 20, 60)
    ticket_value = secrets.token_urlsafe(32)
    claim = {"user_id": user.id, "session_id": session_id, "auth_hash": token_hash(request.cookies[COOKIE])}
    await coordination.set("ticket:" + token_hash(ticket_value), json.dumps(claim), 60)
    return {"ticket": ticket_value, "expires_in": 60}


@router.post("/sessions/{session_id}/stop")
async def stop_session(session_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, LiveSession, session_id, user.id)
    await coordination.set("stop:" + item.id, "1", 86400)
    item.status, item.ended_at = "ended", datetime.now(UTC)
    await db.commit()
    return session_dict(item)


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    item = await owned(db, LiveSession, session_id, user.id)
    if await coordination.get("socket:" + user.id):
        raise HTTPException(409, "End the active live session before deleting session history")
    await coordination.set("stop:" + item.id, "1", 86400)
    await db.delete(item)
    await db.commit()
    return {"ok": True}
