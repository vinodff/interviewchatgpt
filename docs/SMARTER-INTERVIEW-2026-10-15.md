# Structured interview memory and conversation benchmark

This follow-up improves the existing Vercel browser workspace. It builds on the [initial bug audit](AUDIT-2026-10-15.md); the separately hosted FastAPI path keeps its existing transport and context implementation.

## Behavior

- Keep the active task, requested language, constraints and reference to the earlier code. Preserve the two latest code blocks separately from the four recent answer excerpts, so a follow-up can refer to code after recent history rolls over. Keep up to 12 earlier topic summaries.
- Supply one structured memory object instead of repeating overlapping answer and speech histories. Whitelist its fields at the API boundary, cap serialized context at 32,000 characters and code at 10,000 characters total. Clipped code is explicitly marked incomplete.
- Treat assistant suggestions, reported candidate speech and uploaded evidence as distinct sources. Candidate attribution is estimated; generated suggestions never establish personal experience or authorship. Session memory stays in RAM and resets on Stop, including when transcript retention is disabled.
- Process contextual requests such as “In Go,” “In C++,” “In C#,” and “Why?” after a task. Keep language punctuation in duplicate keys so a provisional C++ request corrected to C# is submitted again.
- Use the original spoken wording to recognize task continuity even when the model rewrites a short follow-up. Unrelated new topics reset task metadata. Explicit revisions replace known conflicting recursion, mutation, time or space constraints while retaining independent clauses. This extraction uses bounded heuristics; the model also receives recent speech and explicit precedence rules.
- Check the full utterance fingerprint before applying a late speaker classification, including corrections beyond the prompt's 800-character speech excerpt.
- Reserve the larger code output budget for short language conversions; keep explanation follow-ups on the normal prose path.

One model request still performs question detection and answer generation together. This work does not add a second model call to the answer path. Clear final questions wait 250–350 ms for speech stabilization; stable interim requests wait 450 ms, or 600 ms after repeated recognition corrections. Incomplete prefixes wait 1,900 ms. These delays precede provider generation and do not guarantee end-to-end latency.

The live metrics report observed first answer text and completion time. Optional token usage comes from provider metadata rather than model-generated claims. No prompt or answer telemetry service was added.

## Repeatable benchmark

From `frontend`, with a running browser workspace and its server-side Gemini key configured:

```powershell
$env:CONVERSATION_BENCHMARK_URL='http://127.0.0.1:3020'
npm run benchmark:conversation
```

The fixtures cover direct requests, a trailing “what is list” after candidate narration, first-person instructions, interruptions, narration without a request, reading a previous suggestion, language conversion after seven history rollovers, earlier code's space complexity, a quoted past question, multipart requests and noisy technical transcription.

The report is written to ignored `frontend/test-results/conversation-benchmark.json`. It includes missed requests, unwanted answers, transport failures, first-text latency, context size and available provider token usage. Topic keyword checks and selected language/code/complexity assertions do not establish exhaustive answer correctness. Without `CONVERSATION_BENCHMARK_URL`, ordinary unit tests run the offline fixture checks and skip the network benchmark.

The local production-build run on October 15 passed all 11 real-provider cases: 11/11 intent decisions, zero missed questions, zero unwanted answers and zero transport failures. All selected content checks passed, including a JavaScript code fence after Python history and O(n) space for a reversed copy. First answer text after submission had a median of 1,814 ms and sample p95 of 3,349 ms across eight answer-bearing requests. Provider metadata totaled 7,078 input tokens and 1,081 output tokens. These observations are one small synthetic run, not a latency or accuracy guarantee.

Local verification also passed 202 frontend unit tests (one opt-in network benchmark skipped by the ordinary suite), ESLint, TypeScript and the production build. The separately invoked real-provider benchmark passed all 12 tests in its file. Two Playwright browser journeys passed: persistence/evidence/profile/deletion and corrected speech/narration/embedded question/Python-to-JavaScript follow-up/disabled retention, including a 390-pixel viewport check.

The existing [production site](https://frontend-blush-pi-24.vercel.app) was redeployed successfully as `dpl_BDS5MjM82VtHqnCcXA3jatNQMzJ6` (`READY`). Its health endpoint confirmed browser mode with AI configured. The server credential remains in the existing Vercel environment.

The same 11-case benchmark passed against the public production URL with zero missed questions, unwanted answers or transport failures; selected content checks also passed. First-text median was 1,584 ms and sample p95 was 8,747 ms across eight requests producing answers. The slowest case was a new JavaScript stack implementation on the code model; its full response took 9,643 ms. The language conversion took 4,417 ms to first text. These samples show that coding latency remains variable even when ordinary questions stream sooner. Reported provider usage was 7,078 input tokens and 1,065 output tokens. Raw local and production reports are preserved in ignored `data/conversation-benchmark-local.json` and `data/conversation-benchmark-production.json`.

Both Playwright journeys also passed against the public site (37.5 seconds total), including the real-provider speech correction and Python-to-JavaScript sequence. The temporary local test listener on port 3020 was stopped; the existing development services were preserved.

## Practical limits

This benchmark begins with transcript text. It does not measure accent recognition, overlapping voices, microphone placement, iPhone permission interruptions or actual meeting audio capture. Playwright replaces speech hardware only; its app, storage, API and Gemini responses are real. A physical iPhone session remains necessary to validate those device-specific conditions.

A single mixed microphone cannot reliably establish speaker identity. The system treats answer intent separately so uncertain speaker labels do not suppress a real request. Clear separate permitted audio tracks through the full backend remain the stronger capture method where supported.
