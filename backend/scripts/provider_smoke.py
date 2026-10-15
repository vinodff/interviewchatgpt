"""Explicit provider integration smoke test. Never prints credentials or upstream bodies."""
import asyncio
import json
import time

from app.services.ai import GeminiService, provider_error


async def main():
    service = GeminiService()
    try:
        print(json.dumps(await service.check()))
        begin = time.monotonic()
        result = await service.structured("Return {\"ok\":true} only.", {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}, fast=True)
        print(json.dumps({"structured_ok": result.get("ok") is True, "latency_ms": round((time.monotonic() - begin) * 1000)}))
        vector = await service.embed(["InterviewPilot provider integration test"])
        print(json.dumps({"embedding_dimensions": len(vector[0])}))
        begin = time.monotonic()
        chunks = []
        first_token_ms = None
        async for part in service.stream_answer("Briefly explain what a database transaction is in one sentence. No personal claims."):
            first_token_ms = first_token_ms or round((time.monotonic() - begin) * 1000)
            chunks.append(part)
        print(json.dumps({"stream_ok": bool(chunks), "first_token_ms": first_token_ms, "total_ms": round((time.monotonic() - begin) * 1000)}))
    except Exception as error:
        safe = provider_error(error)
        print(json.dumps({"error": safe.code, "detail": safe.message}))
        raise SystemExit(1) from None
    finally:
        await service.close()


if __name__ == "__main__":
    asyncio.run(main())
