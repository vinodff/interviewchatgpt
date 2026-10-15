"""Opt-in real Gemini request planning -> Python code -> contextual explanation.

Uses a labeled generic coding task and incurs provider usage. Generated code is
parsed for syntax, never executed. No user content or credentials are printed.
"""
import ast
import asyncio
import json
import re

from app.services.ai import GeminiService
from app.services.live import LiveOrchestrator, QuestionDecision


async def main():
    ai = GeminiService()
    live = LiveOrchestrator("provider-fixture", "provider-fixture", lambda _event: None, ai=ai)
    live.audio_mode = "tab"
    live.preferences = {"language": "English", "english_level": "simple", "response_delivery": "natural", "personalization": "grounded"}
    try:
        question = "Write a Python function that removes duplicate strings from a list while preserving their first-seen order."
        entry = {"id": "fixture-code", "role": "interviewer", "spoken": question, "question": "", "suggestion": ""}
        plan = await ai.structured(live._classification_prompt(entry), QuestionDecision, fast=True)
        assert plan.requests_answer and plan.response_kind == "code", "Coding request was not recognized"
        assert plan.code_language.casefold() in {"python", "py"}
        answer = "".join([part async for part in ai.stream_answer(live._answer_prompt(plan.question, [], plan))])
        code = re.search(r"```(?:python|py)\s*\n(.*?)```", answer, re.DOTALL | re.IGNORECASE)
        assert code, "Python code was not displayed in a language-tagged fence"
        parsed = ast.parse(code.group(1))
        assert any(isinstance(node, ast.FunctionDef) for node in ast.walk(parsed))
        entry.update(question=plan.question, suggestion=answer)
        live.memory.append(entry)
        follow_up = {"id": "fixture-explain", "role": "interviewer", "spoken": "Explain that function and why it preserves order.", "question": "", "suggestion": ""}
        explain_plan = await ai.structured(live._classification_prompt(follow_up), QuestionDecision, fast=True)
        assert explain_plan.response_kind == "explanation" and explain_plan.is_follow_up
        explanation = "".join([part async for part in ai.stream_answer(live._answer_prompt(explain_plan.question, [], explain_plan))])
        assert explanation.strip() and not explanation.lstrip().startswith("```")
        unclear = {"id": "fixture-unclear", "role": "interviewer", "spoken": "Write Python code.", "question": "", "suggestion": ""}
        live.memory.clear()
        unclear_plan = await ai.structured(live._classification_prompt(unclear), QuestionDecision, fast=True)
        assert unclear_plan.needs_clarification
        print(json.dumps({"coding_intent": plan.response_kind, "python_syntax_valid": True,
                          "follow_up_intent": explain_plan.response_kind, "contextual_explanation": True,
                          "unspecified_task_clarifies": True, "generated_code_executed": False}))
    finally:
        await ai.close()


if __name__ == "__main__":
    asyncio.run(main())
