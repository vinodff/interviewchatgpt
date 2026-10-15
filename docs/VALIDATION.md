# Validation record — 15 October 2026

The application is running locally at http://localhost:3001 with FastAPI at port 8001, PostgreSQL/pgvector at port 5543, Redis coordination, and the durable ingestion worker. Gemini requests use backend credentials. Temporary integration accounts and their sources were deleted after verification.

## Automated checks

| Check | Result |
| --- | --- |
| Backend unit and integration regressions | 110 passed |
| Frontend audio, capture, protocol, reader, formatting and mobile layout tests | 50 passed |
| Frontend TypeScript, ESLint and production build | Passed |
| Backend Ruff: application, migrations, tests and scripts | Passed |
| Real Chromium browser journeys | 4 passed |
| Fresh PostgreSQL upgrade → downgrade → upgrade, followed by `alembic check` | Passed; no schema differences |
| SQLite development migration and `alembic check` | Passed |
| Backend `pip-audit` | No known vulnerabilities reported after updating cryptography to 50.0.2 |
| Production frontend `npm audit --omit=dev` | No known vulnerabilities reported |
| Credential scan of every non-ignored project file | Configured Gemini key absent |
| Startup PowerShell and CI/Compose YAML syntax | Parsed successfully |

Browser journeys use real account, profile, upload, worker, search, history and deletion endpoints. The live audio test substitutes only microphone hardware with a labeled synthesized WAV; the actual AudioWorklet, resampling, WebSocket ticket, Gemini transcription, semantic question detection, personal retrieval and streamed answer run without mocked HTTP or AI responses. Password recovery verifies the actual unconfigured SMTP response and rejects an invalid reset token.

The mobile live journey verifies an answer-only upper pane at 30% on a 375×812 viewport, independently scrolling lower controls, keyboard and pointer resizing, no height change from a simple divider tap, and a visible Stop button on a 375×400 viewport. Friendly/source-only preferences save through the real API while capture remains active. Backend regression tests verify that the next question reads the updated preferences and that source-only mode does not generate an unsupported answer when retrieval is empty.

The expanded journey saves Simple English and automatic reading preferences, observes a moving word underline and answer-pane scrolling without a manual answer scroll, verifies the lower controls stay still, and checks that Stop clears the underline. Reader tests cover long finalized speech, ordinary “What matters…” statements, hesitations, small transcription errors, repeated phrases, and correction when a timed estimate runs ahead of actual speech.

A second labeled browser WAV asks for a Python implementation, pauses, then asks to explain that code and its complexity. The app automatically displays indented Python and then the contextual explanation during one session, even when Talking points is selected. This journey also verifies desktop question/answer spacing. Parser tests verify escaped untrusted markup, incomplete streamed fences, preserved source offsets and code indentation. Cancelled/limited or otherwise unsuccessful provider output is not marked complete; partial code is removed and late completion messages are rejected.

Connection regressions cover one-use tickets without a second cross-port cookie, revoked login sessions, duplicate accounting, and cleanup during database or Redis failures. Review fixes also cover signed GitHub attribution, source-fact grounding, bounded scanned-PDF serialization, and stale Stripe subscription events.

## Provider and ingestion evidence

- Real Gemini availability, structured reasoning, embeddings (768 dimensions), answer streaming and live transcription were exercised successfully.
- A labeled six-file project ZIP covered frontend, backend API, consumer worker, SQL schema, README and architecture documentation. It produced six searchable chunks with source locators and a source-backed automatic answer.
- The public GitHub API importer successfully extracted three segments from `octocat/Hello-World`, each with a locator. OAuth identity binding needs external client credentials.
- A real fast-model call translated the fixed missing-evidence notice into French. Question, profile and source text are excluded from that translation request.
- `uv run python -m scripts.response_plan_smoke` verified real semantic coding intent, syntax-valid Python, a contextual explanation follow-up and clarification of an unspecified task. Generated fixture code was parsed with Python's AST parser and was never executed.

In the final browser fixture, the UI measured **5,328ms to first answer text** and approximately **5.8s to answer completion**, starting when the finalized transcript reached the orchestrator. These timings include classification, retrieval and answer generation; they exclude spoken-question duration and transcription finalization. An earlier six-file ZIP run measured 7,390ms to answer completion. These are individual fixture observations, not a measured production percentile or service guarantee.

The labeled English speech fixture had a word error rate of 0.143 in the earlier ZIP run, including tokenization differences between “EventStream” and “Event Stream.” One synthesized question does not establish general transcription or answer accuracy. Multilingual speech, background noise, multiple speakers, accents and long-session throughput need broader labeled evaluation before a public release.

One coding browser fixture measured approximately 5.3s to code completion and 6.4s for its explanation follow-up, again measured from each finalized transcript. The response planner reuses question classification rather than adding a separate model request. Code history is bounded and supplied only to relevant follow-ups; missing task requirements skip unnecessary retrieval.

## Reproduce

With local services stopped or tests pointing at their own SQLite database:

```powershell
cd backend
$env:DATABASE_URL='sqlite+aiosqlite:///./data/test-api.db'
$env:REDIS_URL='memory://'
$env:GEMINI_API_KEY=''
uv run pytest -q
uv run ruff check app migrations tests scripts
```

In a separate terminal without those test environment overrides, with the local API and worker running:

```powershell
cd frontend
npm run lint
npm run test
npm run build
$env:E2E_AUDIO_FILE='C:\absolute\path\to\a\labeled-question-with-pauses.wav'
$env:E2E_CODE_AUDIO_FILE='C:\absolute\path\to\coding-then-explanation-with-a-20-second-pause.wav'
npm run test:e2e
```

The WAVs need PCM speech and pauses so automatic speech-end detection can commit the requests. Chromium plays them once rather than looping questions. Without the corresponding environment variable, a live-audio test is skipped. Browser tests create temporary accounts and remove them afterward. The opt-in `backend/scripts/provider_smoke.py`, `end_to_end_smoke.py`, and `response_plan_smoke.py` exercise the configured provider and incur API usage; the end-to-end ZIP script uses the local `data/question.wav` fixture.

## Remaining external verification

Stripe Checkout/portal/webhook code and billing regressions are implemented, but an actual Stripe test-mode purchase requires merchant credentials and a configured price/webhook. SMTP delivery and GitHub OAuth need their own credentials. These services report unavailable rather than simulating success.

Docker and cloud deployment were not executed on this Windows host because Docker is unavailable. Compose and HTTPS deployment configuration are included, with instructions in DEPLOYMENT.md. The GitHub Actions workflow is provided and its action/image references were verified; hosted CI has not run because the project has not been pushed. The Android test APK is included with a separate validation record below. Physical-device Android/iOS capture, hosted mobile connectivity, and release signing remain separate checks.

## Simplified settings, local testing and Android update

- Backend: **129 tests passed**, including normal authentication/allowances, automatic testing bootstrap, owner-only unlimited metering, production/container rejection, and real Uvicorn HTTP/WebSocket middleware forwarding-header regressions. Ruff passed.
- Frontend: **50 tests passed**, lint, typecheck and production build passed. Settings now show four primary controls and a native More options disclosure. Hidden required-field validation opens the disclosure before focusing the invalid field. Testing mode preserves the selected existing workspace and hides billing/sign-out/account deletion.
- Real-browser integration: the new testing journey passed in **39 seconds**, using actual PostgreSQL, Redis, Gemini transcription/generation and WebSockets, with a labeled synthesized WAV as microphone input. It verified anonymous bootstrap, null/unlimited allowance, compact settings persistence, mobile layout, spoken Python generation, automatic spoken explanation follow-up and native-background-event capture stop. Temporary sessions were deleted and original preferences restored.
- The four earlier account-based browser journeys require `LOCAL_TEST_MODE=false`; they were updated for the simpler labels but are not counted as fresh passes in the new testing-mode run. Run the new journey with `E2E_TEST_MODE=1`, `E2E_CODE_AUDIO_FILE` set, and `npm run test:e2e -- local-testing.spec.ts`.
- Android: `scripts/build-android.ps1` built the signed debug APK, passed **4 URL-policy tests**, and completed Android lint with zero errors. The test app installed and loaded the real workspace in an API 33 emulator at a secure loopback origin with microphone and AudioWorklet APIs present. Detailed native permission/upload/background checks are recorded after execution below; physical phone testing is not implied.
