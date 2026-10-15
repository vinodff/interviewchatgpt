import json
from types import SimpleNamespace

import pytest
from google.genai import types

from app.models import User
from app.services.ai import GeminiService, ProviderError
from tests.test_live import AIStub, decision, finish_question, make_orchestrator
from tests.test_live import store as store


def payload(prompt):
    return json.loads(prompt[prompt.index('{"question":'):])


async def test_code_then_explanation_retains_the_actual_generated_code(store):
    code = "```python\ndef unique(items):\n    return list(dict.fromkeys(items))\n```"

    class PlanningAI(AIStub):
        async def stream_answer(self, prompt):
            self.prompts.append(prompt)
            yield code if len(self.prompts) == 1 else "The dictionary retains the first occurrence of each key."

    ai = PlanningAI([
        decision("Write Python to remove duplicates in order", response_kind="code", code_language="python"),
        decision("Explain the Python function just shown", response_kind="explanation", code_language="python", is_follow_up=True),
    ])
    live, events, _ = await make_orchestrator(store, ai)
    await live._final_transcript("code", 0, "Write Python to remove duplicates in order")
    await finish_question(live)
    await live._final_transcript("explain", 0, "Explain that function")
    await finish_question(live)
    assert payload(ai.prompts[0])["request_plan"]["response_kind"] == "code"
    follow_up = payload(ai.prompts[1])
    assert follow_up["request_plan"]["response_kind"] == "explanation"
    assert follow_up["recent_code"] == [{"text": code, "is_excerpt": False}]
    assert len([event for event in events if event["type"] == "answer_complete"]) == 2


async def test_ambiguous_request_clarifies_without_unnecessary_retrieval_even_in_strict_mode(store):
    ai = AIStub([decision("Write Python code", response_kind="code", code_language="python", needs_clarification=True)])
    live, events, _ = await make_orchestrator(store, ai)
    async with store() as db:
        user = await db.get(User, "owner")
        user.preferences = {"grounding": "strict", "response_delivery": "talking_points", "personalization": "grounded"}
        await db.commit()

    async def forbidden_retrieval(*_args, **_kwargs):
        raise AssertionError("Clarification should not spend time retrieving an unspecified task")

    live.retriever = forbidden_retrieval
    await live._final_transcript("clarify", 0, "Write Python code")
    await finish_question(live)
    request = payload(ai.prompts[0])
    assert request["request_plan"]["needs_clarification"] is True
    assert request["preferences"]["response_delivery"] == "talking_points"
    assert request["preferences"]["personalization"] == "grounded"
    assert any(event["type"] == "answer_complete" for event in events)


async def test_code_history_is_bounded_and_excluded_from_unrelated_questions(store):
    live, _, _ = await make_orchestrator(store, AIStub())
    for index in range(20):
        live.memory.append({"id": str(index), "role": "interviewer", "spoken": "request", "suggestion": "```python\n" + "x" * 7900 + "\n```"})
    code_context = live._recent_code_context(decision(response_kind="debugging"))
    assert sum(len(item["text"]) for item in code_context) == 10000
    assert len(code_context) == 2 and code_context[1]["is_excerpt"]
    assert not live._recent_code_context(decision(response_kind="behavioral"))


@pytest.mark.parametrize("finish_reason", [types.FinishReason.MAX_TOKENS, types.FinishReason.SAFETY, types.FinishReason.RECITATION, types.FinishReason.OTHER])
async def test_incomplete_provider_code_is_never_marked_complete(finish_reason):
    async def generate_content_stream(**_kwargs):
        async def output():
            yield SimpleNamespace(text="```python\ndef unfinished(", candidates=[SimpleNamespace(finish_reason=finish_reason)])
        return output()

    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content_stream=generate_content_stream)))
    service = GeminiService(client=client)
    with pytest.raises(ProviderError) as error:
        _ = [text async for text in service.stream_answer("temporary bounded test fixture")]
    assert error.value.code == "AI_INCOMPLETE_ANSWER"
