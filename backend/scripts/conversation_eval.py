"""Opt-in real Gemini text-classifier evaluation; no microphone or user data is used."""

import argparse
import asyncio
import json
import logging
import statistics
import time
from collections import deque
from pathlib import Path

from app.config import settings
from app.services.ai import GeminiService
from app.services.live import LiveOrchestrator, QuestionDecision


async def evaluate(output: Path, selected: set[str]):
    cases = json.loads((Path(__file__).parents[1] / "tests/fixtures/interview_conversations.json").read_text(encoding="utf-8"))
    if selected:
        cases = [case for case in cases if case["id"] in selected]
    if not cases:
        raise ValueError("No evaluation cases selected")
    ai = GeminiService()
    results = []
    semaphore = asyncio.Semaphore(2)

    async def ignore(_message):
        pass

    async def one(case):
        async with semaphore:
            live = LiveOrchestrator("evaluation-only", "synthetic-fixture", ignore, ai=ai)
            live.audio_mode = case.get("mode", "microphone")
            live.memory = deque(({"id": f"{case['id']}-previous-{index}", "question": "", "suggestion": "", **item}
                                 for index, item in enumerate(case.get("recent", []))), maxlen=32)
            role = live._channel_role(case.get("channel", 0))
            entry = {"id": case["id"], "channel": case.get("channel", 0), "role": role, "spoken": case["text"], "question": "", "suggestion": ""}
            started = time.perf_counter()
            try:
                if role == "user":
                    # The real orchestrator never sends the known candidate channel to detection.
                    result = {"requests_answer": False, "speaker_role": "user", "response_kind": "general", "needs_clarification": False}
                else:
                    decision = await ai.structured(live._classification_prompt(entry), QuestionDecision, fast=True)
                    result = decision.model_dump() if isinstance(decision, QuestionDecision) else QuestionDecision.model_validate(decision).model_dump()
                checks = {"request": result["requests_answer"] == case["request"]}
                if case.get("kind") and result["requests_answer"]:
                    checks["intent"] = result["response_kind"] in case["kind"]
                if "clarification" in case:
                    checks["clarification"] = result["needs_clarification"] == case["clarification"]
                item = {"id": case["id"], "passed": all(checks.values()), "checks": checks,
                        "expected_request": case["request"], "result": result, "latency_ms": round((time.perf_counter() - started) * 1000)}
            except Exception as error:
                # Provider messages can contain private transport details; report only the error type.
                item = {"id": case["id"], "passed": False, "error_type": type(error).__name__}
            results.append(item)

    try:
        await asyncio.gather(*(one(case) for case in cases))
    finally:
        await ai.close()
    results.sort(key=lambda item: item["id"])
    successful = [item for item in results if "result" in item]
    false_triggers = sum(not item["expected_request"] and item["result"]["requests_answer"] for item in successful)
    missed = sum(item["expected_request"] and not item["result"]["requests_answer"] for item in successful)
    durations = [item["latency_ms"] for item in successful]
    summary = {"model": settings.gemini_fast_model, "cases": len(cases), "passed": sum(item["passed"] for item in results),
               "evaluation_errors": len(results) - len(successful), "false_triggers": false_triggers, "missed_requests": missed,
               "median_classifier_ms": round(statistics.median(durations)) if durations else None,
               "scope": "Synthetic text-classifier scenarios, not speaker diarization or audio accuracy."}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"summary": summary, "results": results}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary))
    for item in results:
        if not item["passed"]:
            print(json.dumps({"failed_case": item["id"], "checks": item.get("checks"), "error_type": item.get("error_type")}))
    return all(item["passed"] for item in results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("../artifacts/evals/conversation-eval.json"))
    parser.add_argument("--case", action="append", default=[])
    args = parser.parse_args()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("google_genai").setLevel(logging.WARNING)
    raise SystemExit(0 if asyncio.run(evaluate(args.output, set(args.case))) else 1)


if __name__ == "__main__":
    main()
