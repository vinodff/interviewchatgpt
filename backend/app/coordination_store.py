"""Atomic cross-process leases, single-use tickets, and counters backed by PostgreSQL."""

import time
from datetime import UTC, datetime, timedelta

from sqlalchemy import (
    Column,
    DateTime,
    Index,
    Integer,
    String,
    Table,
    Text,
    case,
    cast,
    delete,
    func,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.models import Base

runtime_coordination = Table(
    "runtime_coordination", Base.metadata,
    Column("key", String(512), primary_key=True),
    Column("value", Text, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
)
Index("ix_runtime_coordination_expires_at", runtime_coordination.c.expires_at)


class PostgresCoordination:
    def __init__(self, engine):
        self.engine = engine
        self._cleanup_at = 0.0

    def _clock(self):
        # Database time avoids differences between horizontally scaled service clocks.
        return func.clock_timestamp() if self.engine.dialect.name == "postgresql" else datetime.now(UTC)

    def _insert(self):
        return pg_insert(runtime_coordination) if self.engine.dialect.name == "postgresql" else sqlite_insert(runtime_coordination)

    async def _cleanup(self, connection):
        if time.monotonic() < self._cleanup_at:
            return
        self._cleanup_at = time.monotonic() + 60
        expired = select(runtime_coordination.c.key).where(
            runtime_coordination.c.expires_at <= self._clock(),
        ).limit(1000).with_for_update(skip_locked=True)
        # Recheck expiry on the deleted version too: a lease may have been replaced
        # after the statement's snapshot while a concurrent write held its row lock.
        await connection.execute(delete(runtime_coordination).where(
            runtime_coordination.c.key.in_(expired), runtime_coordination.c.expires_at <= self._clock(),
        ))

    async def get(self, key):
        async with self.engine.connect() as connection:
            return await connection.scalar(select(runtime_coordination.c.value).where(
                runtime_coordination.c.key == key, runtime_coordination.c.expires_at > self._clock(),
            ))

    async def set(self, key, value, ttl, nx=False):
        async with self.engine.begin() as connection:
            await self._cleanup(connection)
            statement = self._insert().values(key=key, value=value, expires_at=self._clock() + timedelta(seconds=ttl))
            options = {"where": runtime_coordination.c.expires_at <= self._clock()} if nx else {}
            statement = statement.on_conflict_do_update(
                index_elements=[runtime_coordination.c.key],
                set_={"value": statement.excluded.value, "expires_at": statement.excluded.expires_at}, **options,
            ).returning(runtime_coordination.c.key)
            return (await connection.scalar(statement)) is not None

    async def consume(self, key):
        async with self.engine.begin() as connection:
            return await connection.scalar(delete(runtime_coordination).where(
                runtime_coordination.c.key == key, runtime_coordination.c.expires_at > self._clock(),
            ).returning(runtime_coordination.c.value))

    async def delete(self, key):
        async with self.engine.begin() as connection:
            await connection.execute(delete(runtime_coordination).where(runtime_coordination.c.key == key))

    async def release(self, key, value):
        async with self.engine.begin() as connection:
            await connection.execute(delete(runtime_coordination).where(
                runtime_coordination.c.key == key, runtime_coordination.c.value == value,
            ))

    async def renew(self, key, value, ttl):
        async with self.engine.begin() as connection:
            result = await connection.scalar(update(runtime_coordination).where(
                runtime_coordination.c.key == key, runtime_coordination.c.value == value,
                runtime_coordination.c.expires_at > self._clock(),
            ).values(expires_at=self._clock() + timedelta(seconds=ttl)).returning(runtime_coordination.c.key))
            return result is not None

    async def hit(self, key, limit, period):
        async with self.engine.begin() as connection:
            await self._cleanup(connection)
            expired = runtime_coordination.c.expires_at <= self._clock()
            statement = self._insert().values(key=key, value="1", expires_at=self._clock() + timedelta(seconds=period))
            statement = statement.on_conflict_do_update(
                index_elements=[runtime_coordination.c.key],
                set_={
                    "value": case((expired, "1"), else_=cast(cast(runtime_coordination.c.value, Integer) + 1, String)),
                    "expires_at": case((expired, statement.excluded.expires_at), else_=runtime_coordination.c.expires_at),
                },
            ).returning(runtime_coordination.c.value)
            return int(await connection.scalar(statement)) <= limit
