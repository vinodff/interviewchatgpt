import asyncio
import os
from pathlib import Path

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


async def write_private(source_id: str, data: bytes) -> str:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    target = checked_path(str(settings.upload_dir / f"{source_id}.enc"))
    encrypted = await asyncio.to_thread(cipher().encrypt, data)
    await asyncio.to_thread(target.write_bytes, encrypted)
    os.chmod(target, 0o600)
    return str(target)


async def read_private(path: str) -> bytes:
    data = await asyncio.to_thread(checked_path(path).read_bytes)
    return await asyncio.to_thread(cipher().decrypt, data)


async def delete_private(path: str):
    if path:
        await asyncio.to_thread(checked_path(path).unlink, missing_ok=True)
