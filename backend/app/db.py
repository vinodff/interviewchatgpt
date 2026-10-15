from pathlib import Path

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings

if settings.database_url.startswith("sqlite"):
    Path("data").mkdir(exist_ok=True)
engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")


async def initialize_database():
    from app.models import Base
    async with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
