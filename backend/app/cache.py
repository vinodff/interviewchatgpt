import asyncio
import time

from redis.asyncio import Redis

from app.config import settings


class Coordination:
    """Redis in production; explicitly process-local coordination for development."""

    def __init__(self):
        self.redis = None if settings.redis_url == "memory://" else Redis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=3, socket_timeout=5, health_check_interval=30)
        self.memory: dict[str, tuple[str, float]] = {}
        self.lock = asyncio.Lock()

    async def get(self, key: str) -> str | None:
        if self.redis:
            return await self.redis.get(key)
        async with self.lock:
            value = self.memory.get(key)
            if value and value[1] > time.monotonic():
                return value[0]
            self.memory.pop(key, None)
            return None

    async def set(self, key: str, value: str, ttl: int, nx=False) -> bool:
        if self.redis:
            return bool(await self.redis.set(key, value, ex=ttl, nx=nx))
        async with self.lock:
            current = self.memory.get(key)
            if nx and current and current[1] > time.monotonic():
                return False
            self.memory[key] = (value, time.monotonic() + ttl)
            return True

    async def consume(self, key: str) -> str | None:
        if self.redis:
            return await self.redis.eval("local v=redis.call('GET',KEYS[1]); redis.call('DEL',KEYS[1]); return v", 1, key)
        async with self.lock:
            value = self.memory.pop(key, None)
            return value[0] if value and value[1] > time.monotonic() else None

    async def delete(self, key: str):
        if self.redis:
            await self.redis.delete(key)
        else:
            async with self.lock:
                self.memory.pop(key, None)

    async def renew(self, key: str, value: str, ttl: int) -> bool:
        if self.redis:
            return bool(await self.redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],ARGV[2]) else return 0 end", 1, key, value, ttl))
        async with self.lock:
            current = self.memory.get(key)
            if not current or current[0] != value or current[1] <= time.monotonic():
                return False
            self.memory[key] = (value, time.monotonic() + ttl)
            return True

    async def release(self, key: str, value: str):
        if self.redis:
            await self.redis.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, key, value)
        else:
            async with self.lock:
                if self.memory.get(key, (None,))[0] == value:
                    self.memory.pop(key, None)

    async def hit(self, key: str, limit: int, period: int) -> bool:
        if self.redis:
            count = await self.redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, period)
            return int(count) <= limit
        async with self.lock:
            now = time.monotonic()
            old, deadline = self.memory.get(key, ("0", now + period))
            count = int(old) + 1 if deadline > now else 1
            self.memory[key] = (str(count), deadline if deadline > now else now + period)
            if len(self.memory) > 10000:
                self.memory = {k: v for k, v in self.memory.items() if v[1] > now}
            return count <= limit


coordination = Coordination()
