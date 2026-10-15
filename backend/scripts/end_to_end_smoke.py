"""Opt-in real integration: labeled fixture ZIP + synthesized speech -> automatic answer.

Uses the local running API/worker and configured Gemini provider; incurs API usage.
Temporary account and knowledge are deleted on exit. Never reads credentials into output.
"""
import asyncio
import io
import json
import math
import os
import re
import time
import uuid
import wave
import zipfile
from array import array
from pathlib import Path

import httpx
import websockets


def project_fixture() -> bytes:
    output = io.BytesIO()
    files = {
        "README.md": "# EventStream — integration test fixture\nEventStream processes messages through a FastAPI ingest endpoint, a Redis consumer group, and PostgreSQL storage. Redis provides a durable stream buffer and replay after consumer restarts. No claims about any real person's contributions are made by this test fixture.\n",
        "backend/api.py": "from fastapi import FastAPI\napp = FastAPI()\n@app.post('/events')\nasync def ingest(event: dict):\n    return await redis.xadd('events', event)\n",
        "backend/worker.py": "# The Redis consumer acknowledges only after PostgreSQL commits.\nasync def process(redis, db):\n    messages = await redis.xreadgroup('workers', 'one', {'events': '>'})\n    for message in messages:\n        await db.store(message)\n        await redis.xack('events', 'workers', message.id)\n",
        "database/schema.sql": "CREATE TABLE events (id text PRIMARY KEY, payload jsonb NOT NULL, received_at timestamptz DEFAULT now());\n",
        "frontend/page.tsx": "export default function Events({events}: {events: string[]}) { return <ul>{events.map(e => <li key={e}>{e}</li>)}</ul>; }\n",
        "docs/architecture.md": "Browser -> POST /events -> Redis stream -> consumer -> PostgreSQL events table. At-least-once delivery requires idempotent event IDs. The UI shows the persisted events. Redis is a buffer; PostgreSQL is the system of record.\n",
    }
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return output.getvalue()


def pcm16(path: Path) -> bytes:
    with wave.open(str(path), "rb") as file:
        assert file.getsampwidth() == 2 and file.getnchannels() == 1
        source_rate = file.getframerate()
        samples = array("h", file.readframes(file.getnframes()))
    count = math.floor(len(samples) * 16000 / source_rate)
    output = array("h")
    for index in range(count):
        position = index * source_rate / 16000
        lower = min(int(position), len(samples) - 1)
        upper = min(lower + 1, len(samples) - 1)
        output.append(round(samples[lower] + (samples[upper] - samples[lower]) * (position - lower)))
    return b"\x00" * 32000 + output.tobytes() + b"\x00" * 64000


def word_error_rate(expected: str, actual: str) -> float:
    def words(value):
        return re.findall(r"\w+", value.casefold())
    reference, hypothesis = words(expected), words(actual)
    previous = list(range(len(hypothesis) + 1))
    for i, expected_word in enumerate(reference, 1):
        current = [i]
        for j, actual_word in enumerate(hypothesis, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (expected_word != actual_word)))
        previous = current
    return previous[-1] / max(1, len(reference))


async def main():
    headers = {"X-InterviewPilot": "1", "Origin": os.environ.get("INTERVIEWPILOT_ORIGIN", "http://localhost:3001")}
    api_url = os.environ.get("INTERVIEWPILOT_API_URL", "http://127.0.0.1:8001")
    async with httpx.AsyncClient(base_url=api_url, headers=headers, timeout=40) as client:
        registered = False
        session_id = None
        try:
            response = await client.post("/api/auth/register", json={"email": f"integration-{uuid.uuid4().hex[:12]}@example.com", "password": uuid.uuid4().hex + "-Test!", "name": "Integration test fixture"})
            response.raise_for_status()
            registered = True
            project = (await client.post("/api/projects", json={"name": "EventStream", "description": "Labeled temporary integration test fixture"})).json()
            response = await client.post("/api/sources/upload", data={"project_id": project["id"]}, files={"file": ("eventstream-fixture.zip", project_fixture(), "application/zip")})
            response.raise_for_status()
            source_id = response.json()["id"]
            begin = time.monotonic()
            while time.monotonic() - begin < 180:
                sources = (await client.get("/api/sources")).json()
                source = next(item for item in sources if item["id"] == source_id)
                if source["status"] == "failed":
                    raise RuntimeError("Ingestion failed: " + source["error"])
                if source["status"] == "ready":
                    print(json.dumps({"ingestion_ready": True, "chunks": source["chunk_count"], "ms": round((time.monotonic() - begin) * 1000)}), flush=True)
                    break
                await asyncio.sleep(2)
            else:
                raise RuntimeError("Ingestion did not complete in 180 seconds")
            evidence = (await client.get("/api/knowledge/search", params={"q": "Why Redis and how are messages processed?"})).json()
            assert evidence and all(item["project_id"] == project["id"] for item in evidence)
            print(json.dumps({"semantic_retrieval": True, "evidence_count": len(evidence), "locators": [item["locator"] for item in evidence]}), flush=True)
            response = await client.post("/api/sessions", json={"consent": True, "audio_mode": "tab", "retention": True, "title": "Temporary automatic pipeline verification"})
            response.raise_for_status()
            session_id = response.json()["id"]
            response = await client.post(f"/api/sessions/{session_id}/ticket")
            response.raise_for_status()
            ticket = response.json()["ticket"]
            cookie = "; ".join(f"{key}={value}" for key, value in client.cookies.items())
            audio = pcm16(Path("../data/question.wav"))
            ws_url = api_url.replace("http://", "ws://").replace("https://", "wss://")
            async with websockets.connect(f"{ws_url}/api/live/{session_id}/ws?ticket={ticket}", origin=headers["Origin"], additional_headers={"Cookie": cookie}, max_size=2**20) as socket:
                async def send_audio():
                    for start in range(0, len(audio), 3200):
                        await socket.send(b"\x00" + audio[start:start + 3200])
                        await asyncio.sleep(0.1)
                    # Keep streaming silence so automatic VAD can finalize without any manual submit.
                    while True:
                        await socket.send(b"\x00" + bytes(3200))
                        await asyncio.sleep(0.1)
                sender = asyncio.create_task(send_audio())
                transcript = {}
                saw_question = False
                try:
                    async with asyncio.timeout(100):
                        async for raw in socket:
                            event = json.loads(raw)
                            kind = event["type"]
                            if kind == "transcript" and event.get("final"):
                                transcript[event["id"]] = event["text"]
                            if kind == "question":
                                saw_question = True
                                print(json.dumps({"automatic_question": True, "project_selected": event.get("project_id") == project["id"], "question": event["question"]}), flush=True)
                            if kind == "error" and not event.get("recoverable"):
                                raise RuntimeError(event["code"] + ": " + event["message"])
                            if kind == "answer_complete":
                                assert saw_question and event["evidence"] and "redis" in event["answer"].casefold()
                                expected = "Can you explain how your EventStream project processes messages and why you chose Redis?"
                                print(json.dumps({"automatic_answer": True, "answer": event["answer"], "evidence_count": len(event["evidence"]), "latency_ms": event["latency_ms"], "fixture_word_error_rate": round(word_error_rate(expected, " ".join(transcript.values())), 3)}), flush=True)
                                await socket.send(json.dumps({"type": "stop"}))
                                break
                finally:
                    sender.cancel()
                    await asyncio.gather(sender, return_exceptions=True)
        finally:
            if session_id:
                await client.post(f"/api/sessions/{session_id}/stop")
            if registered:
                response = await client.delete("/api/auth/account")
                print(json.dumps({"fixture_account_deleted": response.status_code == 200}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
