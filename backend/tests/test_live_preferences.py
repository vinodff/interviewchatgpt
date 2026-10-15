import asyncio
from array import array

from app.models import User
from app.services.live import LiveOrchestrator, SourceGapMessage
from tests.test_live import AIStub, AudioSession, decision, finish_question, make_orchestrator
from tests.test_live import store as store


async def test_strict_grounding_without_evidence_never_generates_unsupported_answer(store):
    ai = AIStub([decision("Explain a project not in my uploaded files")])
    live, events, _ = await make_orchestrator(store, ai)
    async with store() as db:
        user = await db.get(User, "owner")
        user.preferences = {"grounding": "strict", "answer_tone": "casual"}
        await db.commit()
    async def no_evidence(*_args, **_kwargs):
        return []
    live.retriever = no_evidence
    await live._final_transcript("strict", 0, "Explain a project not in my uploaded files")
    await finish_question(live)
    completed = next(item for item in events if item["type"] == "answer_complete")
    assert "don't contain enough information" in completed["answer"]
    assert completed["evidence"] == []
    assert not ai.prompts


async def test_live_preferences_update_on_the_next_question_without_restart(store):
    ai = AIStub([decision("Explain Redis caching", project_id="owned-project")])
    live, _, _ = await make_orchestrator(store, ai)
    async with store() as db:
        user = await db.get(User, "owner")
        user.preferences = {"grounding": "strict", "answer_tone": "friendly", "english_level": "simple"}
        await db.commit()
    await live._final_transcript("prefs", 0, "Explain Redis caching")
    await finish_question(live)
    assert '"answer_tone": "friendly"' in ai.prompts[0]
    assert '"grounding": "strict"' in ai.prompts[0]
    assert '"english_level": "simple"' in ai.prompts[0]
    assert "English level changes wording only" in ai.prompts[0]
    assert "Do not supplement them with general knowledge" in ai.prompts[0]


async def test_strict_source_gap_notice_respects_selected_language_without_answering(store):
    class TranslationAI(AIStub):
        async def structured(self, prompt, schema, **kwargs):
            if schema is SourceGapMessage:
                assert '"language": "French"' in prompt
                assert "secret project question" not in prompt
                return SourceGapMessage(message="Vos sources ne contiennent pas assez d’informations pour répondre.")
            return await super().structured(prompt, schema, **kwargs)

    ai = TranslationAI([])
    live, _, _ = await make_orchestrator(store, ai)
    live.preferences = {"grounding": "strict", "language": "French"}
    tokens = [text async for text in live._answer_tokens("secret project question", [])]
    assert tokens == ["Vos sources ne contiennent pas assez d’informations pour répondre."]
    assert not ai.prompts


async def test_hybrid_vad_finalizes_after_speech_and_a_normal_pause():
    live = LiveOrchestrator("session", "owner", lambda _event: None)
    session = AudioSession()
    queue = asyncio.Queue()
    voiced = array("h", [3000] * 1600).tobytes()
    for _ in range(4):
        queue.put_nowait(voiced)
    for _ in range(10):
        queue.put_nowait(bytes(3200))
    task = asyncio.create_task(live._send_audio(session, queue))
    try:
        async with asyncio.timeout(2):
            while session.ends == 0:
                await asyncio.sleep(0.01)
        assert session.ends == 1
        assert len(session.audio) == 14
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
