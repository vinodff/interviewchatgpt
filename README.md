# InterviewPilot Live

A working consent-based live assistant with a Next.js interface, FastAPI/WebSocket backend, Gemini transcription and streamed answers, and a private PostgreSQL/pgvector knowledge base. Speech drives the live workflow; there is no manual question submission, practice, quiz, or hidden recording mode.

## Run locally

This workspace's backend API key is already saved in the ignored `backend/.env`. Keep provider and billing secrets out of the frontend. The local app uses **http://localhost:3001**, the API uses **http://localhost:8001**, and its isolated PostgreSQL cluster uses port **5543**. These ports avoid other applications on this computer.

```powershell
# From the project root. Starts hidden processes with logs under data/.
.\scripts\start-local.ps1
```

Or start each service in its own terminal:

```powershell
cd backend
uv sync --frozen
uv run alembic upgrade head
uv run python -m scripts.run_local --port 8001
```

```powershell
cd backend
uv run python -m app.services.worker
```

```powershell
cd frontend
npm ci
npm run build
npm run start -- --port 3001
```

`frontend/.env.local` sets `BACKEND_INTERNAL_URL=http://127.0.0.1:8001` and `NEXT_PUBLIC_WS_URL=ws://localhost:8001`. HTTP requests authenticate with a private cookie; a short-lived, single-use session ticket authenticates the WebSocket. Open the app at `localhost:3001`.

For a new machine, configure `backend/.env` from `backend/.env.example`. SQLite and memory coordination are available for explicit development use. Production requires PostgreSQL, pgvector, Redis, HTTPS, a persistent encryption key, and backend Gemini credentials. Dependency versions are locked in `backend/uv.lock` and `frontend/package-lock.json`.

## Local testing without login

This computer is configured with `LOCAL_TEST_MODE=true` and an existing `LOCAL_TEST_USER_ID` in the ignored backend `.env`. Opening the app automatically establishes a private session cookie for that workspace, preserving its uploaded resume and preferences. No login, subscription, monthly minute cap, or session-duration cap is required. Gemini quota, file-size limits, request throttles, consent, and one-live-session coordination still apply. Usage is measured; `minute_limit: null` means unlimited application minutes.

Use only `scripts/start-local.ps1` or the individual launch commands above for testing mode. Both frontend and API bind to loopback; the API launcher disables forwarding-header trust. Do not expose these listeners through public proxies, tunnels, LAN bindings, or custom Uvicorn commands. Testing deliberately shares one workspace with local users/applications on this computer. Production/staging settings and the container entrypoint refuse testing mode. Set `LOCAL_TEST_MODE=false` and restart to restore normal login/billing. Account deletion is disabled during testing to protect the selected workspace.

## Android APK

The debug-signed test APK is `artifacts/android/InterviewPilotLive-test.apk`. It runs the mobile web application with Android microphone permission and document uploads. The backend remains on the PC or a hosted HTTPS server; the API key is never packaged in the APK.

Keep the local application running, connect a phone with USB debugging authorized, then run:

```powershell
.\scripts\connect-android.ps1
```

The script installs the APK and forwards ports 3001 and 8001, so the app's `http://localhost:3001` reaches this PC without exposing the services to the LAN. See [Android guide](docs/ANDROID.md) for installation, hosted connections, rebuilding and release signing.

## Use the application

1. Open your workspace (automatically in local testing; create an account in normal mode). Add your target role and job context in Your profile. Answer options show Answer format, English level, Answer length, and Hands-free scrolling. More options expands tone, personalization, knowledge sources, and reading speed.
2. Upload PDFs, DOCX, screenshots, certificates, source files, or a ZIP project archive. Create a project to group related evidence; import public GitHub repositories using their URLs. The separate worker extracts, analyzes, embeds, and indexes evidence automatically. Coverage and processing errors are visible.
3. On Live workspace, select microphone or shared-tab audio, choose transcript retention, and affirm participant consent and permission to use AI assistance.
4. Click Start live session and grant the browser's audio permissions. Transcription, question detection, follow-up resolution, project selection, retrieval, streaming, duplicate prevention, and connection renewal run automatically. Stop ends capture and the session.

Answers distinguish personal evidence, reported experience, repository observations, and general technical explanations. Repository access alone never proves authorship. Optional GitHub OAuth binds identity; only GitHub-verified signed commits whose author **and** committer match that identity establish attribution to those specific commits. Other claims remain reported or unverified.

On mobile, the live answer occupies the upper 30% by default. Drag the divider or use its keyboard controls to adjust the answer pane from 15% to 70%; its height is saved only on your device. The lower pane contains branding, session controls, detected questions, answer options, evidence and transcript. Both panes scroll independently, and lower sections can collapse. Changing saved answer preferences applies to the next detected question without stopping capture.

The hands-free reading guide starts automatically when an answer is complete. By default it follows recognized spoken words, underlines the current word, and scrolls only the answer pane to keep upcoming text visible. After a short quiet gap, it advances at your selected pace (60–240 words per minute; default 130). You can choose speech only, timed silent reading, or Off in Answer options before starting. A confident speech match corrects an earlier timed estimate, including when you speak more slowly. The guide pauses off-screen, on disconnect or Stop, and resets for a new answer. Saved reader changes apply immediately without restarting capture.

Spoken position is estimated from transcription and text alignment, rather than gaze. Silent reading uses elapsed time; the browser cannot determine exactly which word your eyes are reading. A separate microphone channel provides clearer speaker attribution; mixed-microphone tracking requires stronger matching evidence. The guide does not add another recorder or permission request.

Answer delivery can be Natural spoken phrasing, Talking points, or a Structured answer. Grounded personalization prefers relevant evidence from your projects and profile; Technical focus emphasizes the technical explanation. Natural phrasing can adapt to your prior spoken wording, while facts and personal claims remain subject to the same source rules.

Question detection also plans the response format in the same AI call. An implementation request produces language-tagged, formatted code; an explanation follow-up uses the actual earlier code; debugging, design, comparison and behavioral requests receive the corresponding response. Explicit code requests take priority over a talking-point setting. Missing task requirements or unavailable code lead to a focused clarification. The app cannot inspect meeting-screen code that has not been supplied in audio, uploaded sources, or prior generated context. Generated code is displayed as escaped text with indentation; it is never executed by the app.

## Browser capture limits

Desktop Chrome/Edge can commonly share audio from a selected browser tab. The browser requires a display video track; it stays local and no video frames are transmitted. A separate microphone channel records the user's spoken answers. Select the meeting tab and enable Share audio in the browser picker.

Mobile browsers generally support microphone capture, with browser-specific limitations. A microphone captures audible room sound; it does not give arbitrary access to another app's or tab's audio. Headphones and echo cancellation can prevent remote meeting audio from reaching the microphone. Speaker attribution in a mixed microphone stream is uncertain. Use a permitted source that actually contains the conversation.

Capture requires HTTPS or localhost and visible permission. Browsers cannot silently regrant screen-share permissions or guarantee capture while suspended, backgrounded, locked, or interrupted. The app displays interruption and cleans up resources. Network reconnection can be automatic while permissions remain valid; dropped audio is reported, rather than replayed as new speech.

## Integrations and deployment

- Gemini is configured and exercised with real provider calls in this workspace. Models are environment-configurable; the defaults were verified against [official Gemini model documentation](https://ai.google.dev/gemini-api/docs/models).
- Stripe Checkout, subscription synchronization, usage limits, and the billing portal are implemented. Activation needs `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and a signed webhook endpoint secret. Payment and subscription state comes from Stripe, never from a success redirect.
- Password recovery needs SMTP configuration. GitHub identity verification needs a GitHub OAuth app client ID/secret with callback `/api/profile/github/callback`. Public repository import works without OAuth, subject to GitHub rate limits; an optional backend token must not grant tenants private repository access.
- Docker Compose includes PostgreSQL/pgvector, Redis, migrations, API, ingestion worker, frontend, and a Caddy HTTPS reverse proxy. See [deployment instructions](docs/DEPLOYMENT.md). Docker execution and public cloud deployment require an environment with Docker and a domain.

See [architecture](docs/ARCHITECTURE.md), [validation](docs/VALIDATION.md), [security and operations](docs/SECURITY.md), and the [Android APK guide](docs/ANDROID.md). The Android host reuses the same HTTP/audio WebSocket contract; a future native client can replace the WebView while keeping these services.
