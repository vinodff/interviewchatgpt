import asyncio

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import settings
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
target_metadata = Base.metadata


def migrate(connection):
    def include_object(obj, name, kind, reflected, compare_to):
        return not (connection.dialect.name == "sqlite" and kind == "index" and name == "chunks_embedding_hnsw")

    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


async def online():
    connection_engine = async_engine_from_config(config.get_section(config.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
    async with connection_engine.connect() as connection:
        await connection.run_sync(migrate)
    await connection_engine.dispose()


if context.is_offline_mode():
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    asyncio.run(online())
