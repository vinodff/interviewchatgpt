"""Exchange only server-verified Supabase identities for application sessions."""

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, EmailStr, ValidationError

from app.config import loopback_host, settings


@dataclass(frozen=True)
class VerifiedSupabaseIdentity:
    id: str
    email: str
    name: str


class _ProviderUser(BaseModel):
    id: UUID
    email: EmailStr
    email_confirmed_at: datetime | None = None
    user_metadata: dict | None = None


async def verify_supabase_user(access_token: str) -> VerifiedSupabaseIdentity:
    """Ask the configured Auth server to validate the access token; never decode it as proof."""
    base_url = settings.supabase_url.rstrip("/")
    api_key = settings.supabase_anon_key.get_secret_value()
    parsed = urlparse(base_url)
    local_http = (
        settings.environment in {"development", "test"}
        and parsed.scheme == "http" and loopback_host(parsed.hostname)
    )
    if not api_key or not parsed.hostname or (parsed.scheme != "https" and not local_http) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
        raise HTTPException(503, "Google sign-in is not configured. Please use email and password")
    if not access_token.strip() or any(character.isspace() for character in access_token):
        raise HTTPException(401, "Sign in with Google again to continue")
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False, trust_env=False) as client:
            response = await client.get(
                base_url + "/auth/v1/user",
                headers={"Authorization": "Bearer " + access_token, "apikey": api_key, "Accept": "application/json"},
            )
    except httpx.HTTPError:
        raise HTTPException(503, "Google sign-in is temporarily unavailable. Please try again") from None
    if response.status_code in {401, 403}:
        raise HTTPException(401, "Sign in with Google again to continue")
    if response.status_code != 200:
        raise HTTPException(503, "Google sign-in is temporarily unavailable. Please try again")
    try:
        identity = _ProviderUser.model_validate(response.json())
    except (ValueError, ValidationError):
        raise HTTPException(503, "Google sign-in could not be verified. Please try again") from None
    # A valid token alone does not prove ownership of an unconfirmed email address.
    # This check also protects linking an existing password account by email.
    if identity.email_confirmed_at is None:
        raise HTTPException(403, "Verify your Google account email before signing in")
    email = str(identity.email).lower()
    metadata = identity.user_metadata or {}
    name = metadata.get("full_name") or metadata.get("name")
    name = name.strip()[:120] if isinstance(name, str) else ""
    return VerifiedSupabaseIdentity(str(identity.id), email, name or email.split("@")[0][:120])
