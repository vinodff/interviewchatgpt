import asyncio
import os
import re
from pathlib import Path

import httpx
from cryptography.fernet import Fernet

from app.config import settings


def cipher() -> Fernet:
    key = settings.encryption_key.get_secret_value()
    if not key:
        key_path = Path("data/local-storage.key")
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if not key_path.exists():
            try:
                with key_path.open("xb") as handle:
                    handle.write(Fernet.generate_key())
                os.chmod(key_path, 0o600)
            except FileExistsError:
                pass
        key = key_path.read_text().strip()
    return Fernet(key.encode())


def checked_path(path: str) -> Path:
    root = settings.upload_dir.resolve()
    target = Path(path).resolve()
    if target.parent != root:
        raise ValueError("Invalid private storage path")
    return target


def _check_remote_path(path: str) -> str:
    bucket_prefix = f"supabase://{settings.supabase_storage_bucket}/"
    if not path.startswith(bucket_prefix):
        raise ValueError("Invalid private storage path")
    key = path[len(bucket_prefix):]
    if not key or not re.match(r"^[a-zA-Z0-9_-]+\.enc$", key) or ".." in key or "%" in key or "?" in key:
        raise ValueError("Invalid private storage path")
    return key


async def write_private(source_id: str, data: bytes) -> str:
    if not source_id or not re.match(r"^[a-zA-Z0-9_-]+$", source_id) or ".." in source_id or "/" in source_id or "\\" in source_id:
        raise ValueError("Invalid private storage identifier")

    if settings.storage_backend == "supabase":
        service_key = settings.supabase_service_role_key.get_secret_value()
        if not service_key:
            raise RuntimeError("Supabase storage is not configured")
        if not settings.encryption_key.get_secret_value():
            raise RuntimeError("Remote private storage requires a stable encryption key")

        encrypted = cipher().encrypt(data)
        bucket = settings.supabase_storage_bucket
        endpoint = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{source_id}.enc"
        headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(endpoint, content=encrypted, headers=headers)
        except httpx.HTTPError:
            raise RuntimeError("Private object storage is temporarily unavailable") from None

        if response.status_code != 200:
            raise RuntimeError("Private object storage error")
        return f"supabase://{bucket}/{source_id}.enc"

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    target = checked_path(str(settings.upload_dir / f"{source_id}.enc"))
    encrypted = await asyncio.to_thread(cipher().encrypt, data)
    await asyncio.to_thread(target.write_bytes, encrypted)
    os.chmod(target, 0o600)
    return str(target)


async def read_private(path: str) -> bytes:
    if settings.storage_backend == "supabase" or path.startswith("supabase://"):
        key = _check_remote_path(path)
        service_key = settings.supabase_service_role_key.get_secret_value()
        if not service_key:
            raise RuntimeError("Supabase storage is not configured")
        bucket = settings.supabase_storage_bucket
        endpoint = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{key}"
        headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(endpoint, headers=headers)
        except httpx.HTTPError:
            raise RuntimeError("Private object storage is temporarily unavailable") from None

        if response.status_code != 200:
            raise RuntimeError("Private object storage error")
        return cipher().decrypt(response.content)

    data = await asyncio.to_thread(checked_path(path).read_bytes)
    return await asyncio.to_thread(cipher().decrypt, data)


async def delete_private(path: str):
    if not path:
        return

    if settings.storage_backend == "supabase" or path.startswith("supabase://"):
        key = _check_remote_path(path)
        service_key = settings.supabase_service_role_key.get_secret_value()
        if not service_key:
            raise RuntimeError("Supabase storage is not configured")
        bucket = settings.supabase_storage_bucket
        endpoint = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{key}"
        headers = {
            "Authorization": f"Bearer {service_key}",
            "apikey": service_key,
        }
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.delete(endpoint, headers=headers)
        except httpx.HTTPError:
            raise RuntimeError("Private object storage is temporarily unavailable") from None

        if response.status_code != 200:
            raise RuntimeError("Private object storage error")
        return

    await asyncio.to_thread(checked_path(path).unlink, missing_ok=True)
