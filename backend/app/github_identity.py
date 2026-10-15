import secrets
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import coordination
from app.config import settings
from app.models import AuthSession, User
from app.security import COOKIE, aware, current_user, database, rate_limit, token_hash

router = APIRouter(prefix="/profile/github", tags=["profile"])
STATE_COOKIE = "interviewpilot_github_state"


@router.post("/connect")
async def connect(request: Request, response: Response, user: User = Depends(current_user)):
    if not settings.github_client_id or not settings.github_client_secret.get_secret_value():
        raise HTTPException(503, "GitHub identity verification requires the operator's GitHub OAuth app configuration")
    await rate_limit("github-connect:" + user.id, 5, 300)
    state = secrets.token_urlsafe(32)
    auth_hash = token_hash(request.cookies[COOKIE])
    await coordination.set("github-state:" + token_hash(state), user.id + ":" + auth_hash, 600)
    response.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, secure=settings.cookie_secure, samesite="lax", path="/api/profile/github/callback")
    return {"url": "https://github.com/login/oauth/authorize?" + urlencode({"client_id": settings.github_client_id, "redirect_uri": settings.public_url + "/api/profile/github/callback", "scope": "read:user", "state": state})}


@router.get("/callback")
async def callback(request: Request, state: str = "", code: str = "", db: AsyncSession = Depends(database)):
    cookie = request.cookies.get(STATE_COOKIE, "")
    if not state or len(state) > 100 or not secrets.compare_digest(state, cookie) or len(code) > 200 or not code:
        raise HTTPException(400, "The GitHub authorization state is invalid or expired")
    claim = await coordination.consume("github-state:" + token_hash(state))
    if not claim:
        raise HTTPException(400, "The GitHub authorization state is invalid or expired")
    user_id, auth_hash = claim.split(":", 1)
    auth = await db.get(AuthSession, auth_hash)
    user = await db.get(User, user_id)
    if not auth or not user or auth.user_id != user_id or aware(auth.expires_at) < datetime.now(UTC):
        raise HTTPException(401, "Sign in again to verify GitHub identity")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client:
            token_response = await client.post("https://github.com/login/oauth/access_token", headers={"Accept": "application/json"}, data={"client_id": settings.github_client_id, "client_secret": settings.github_client_secret.get_secret_value(), "code": code, "redirect_uri": settings.public_url + "/api/profile/github/callback"})
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            if not isinstance(access_token, str) or not access_token:
                raise ValueError("No token")
            identity_response = await client.get("https://api.github.com/user", headers={"Authorization": "Bearer " + access_token, "X-GitHub-Api-Version": "2026-03-10", "Accept": "application/vnd.github+json"})
            identity_response.raise_for_status()
            identity = identity_response.json()
            if not isinstance(identity.get("id"), int) or not isinstance(identity.get("login"), str):
                raise ValueError("No identity")
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(502, "GitHub identity verification failed. Please reconnect") from None
    # Only the identity is retained, never the OAuth access token or private repository scope.
    user.github_verified_id = identity["id"]
    user.github_verified_username = identity["login"][:80]
    user.github_username = identity["login"][:80]
    await db.commit()
    result = RedirectResponse(settings.public_url + "/?github=connected", status_code=303)
    result.delete_cookie(STATE_COOKIE, path="/api/profile/github/callback")
    return result


@router.delete("/connect")
async def disconnect(user: User = Depends(current_user), db: AsyncSession = Depends(database)):
    user.github_verified_id = None
    user.github_verified_username = ""
    await db.commit()
    # Existing evidence retains historical verification. Re-import sources to update future identity linkage.
    return {"ok": True}
