# InterviewWin Live frontend

Next.js 16.4.0, React 19, TypeScript, and Tailwind 4. Install with `npm ci`. Select `NEXT_PUBLIC_WORKSPACE_MODE=browser` for the existing Vercel browser workspace, or `backend` for FastAPI. `.env.example` documents the modes, public WebSocket origin and internal HTTP proxy origin. Provider secrets must be server environment variables, never `NEXT_PUBLIC_*` values.

`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` validate the frontend. `npm run test:e2e` uses port 3001 by default; backend journeys require FastAPI and its worker. Set `E2E_BASE_URL` to use an already running frontend. For standalone mode, set `E2E_BROWSER_MODE=1` and run `npx playwright test tests/e2e/browser-workspace.spec.ts`; its live journey replaces recognition hardware while using real API and Gemini responses.

`CONVERSATION_BENCHMARK_URL` enables the opt-in real-model run in `npm run benchmark:conversation`. See [memory, timing and benchmark documentation](../docs/SMARTER-INTERVIEW-2026-10-15.md) for scope, results and limitations. The default unit suite skips provider calls.

**Streaming microphone · fast + quiet voices** is the default browser recognition mode. Continuous 16 kHz PCM reaches `gemini-3.5-transcribe-live` over a direct WebSocket using a server-issued single-use credential restricted to transcription. Its interim/final transcripts feed the existing contextual answer and source retrieval pipeline. No new account or package is required. **Enhanced microphone · short recordings** remains available for combined audio understanding, and **Standard** uses browser recognition. See [streaming research and validation](../docs/STREAMING-SPEECH-2026-10-16.md) for cost, security, timings, connection renewal and device limits.

Docker builds standalone output and runs as a non-root user. `BACKEND_URL` is a build argument because Next rewrites are compiled into the build. In production a same-origin reverse proxy must route `/api/*`, including WebSocket upgrades, to the backend. Leave `NEXT_PUBLIC_WS_URL` empty for same-origin secure WebSockets. For local production previews set it to `ws://localhost:8000` at build time. Serve both frontend and backend using the same hostname (`localhost` or `127.0.0.1`) so the HTTP-only session cookie reaches the WebSocket handshake.

Start requests browser audio permissions synchronously in the user gesture. Desktop Chrome and Edge can share a meeting tab with audio and a separate microphone. The required display video track stays alive but frames are never encoded or transmitted. Microphone mode is available on supported mobile browsers, with explicitly uncertain speaker attribution. AudioWorklet resamples the native context rate to 16 kHz mono PCM16 in 100 ms packets. Capture stops on permission revocation, browser suspension, terminal errors, component unmount, and Stop. Reconnect discards interrupted audio, uses fresh single-use tickets and bounded backoff, and bounds browser output buffering.

Speech drives automatic question detection. Only the latest generation can update the displayed answer. Text retention is opt-in at session creation and raw audio is never stored.

## Public website

The home page lives at `/`; the application lives at `/interview`. Public calls to action use `/interview?view=live`. The legacy `/workspace` route preserves query parameters and redirects to the application. Existing `/?reset=...` password recovery links also redirect; the app consumes the token and clears it from the address bar. Billing returns reach `/interview?view=billing` and never activate subscriptions by themselves.

The shared public layout in `app/(site)` provides responsive navigation, footer links, smooth anchor scrolling, a reading-progress indicator, and one-time section reveals. Content is visible without JavaScript, and reduced-motion preferences disable animations and smooth scrolling. The live workspace uses separate styles so capture controls and the mobile answer split retain their behavior.

Public pages: `/features`, `/how-it-works`, `/plans`, `/about`, `/help`, `/contact`, `/privacy`, and `/terms`. Informational pages are prerendered from the typed route list in `lib/site-content.ts`; pricing and selected-plan contact pages render current server data. Unknown routes show a custom 404. Help articles support search and topic filters. Support uses `vcontenthelper@gmail.com`; the contact form prepares a message in the visitor’s email application and does not submit or send mail from the server.

Plans and privacy content follow the configured browser/account workspace mode. The policy pages describe application behavior and link to provider terms; the operator should review them against the final hosting, provider account, business details, and applicable requirements before public launch.

Run `npx playwright test tests/e2e/landing.spec.ts tests/e2e/site-pages.spec.ts` against a running frontend with `E2E_BASE_URL`. The public-page checks need no live AI calls; the password-recovery UI check stubs an unauthenticated account response. Screenshots are saved under `../artifacts/ui/`. Real account and audio journeys still need their configured services.

Three configurable launch plans are shown on the home page and `/plans`: Free (₹0, 30 minutes), Starter (₹299/month, 180 minutes), and Pro (₹799/month, 600 minutes). Account pricing comes from the backend public catalog; an unavailable service falls back to clearly marked launch prices with paid actions unavailable. Configure the backend monthly INR Stripe prices and signed webhook before enabling paid checkout. Browser/local preview access does not offer subscriptions. See [the pricing and usability review](../docs/LAUNCH-UX-REVIEW-2026-10-21.md).

`tests/e2e/interview-flow.spec.ts` adds mocked account journeys for consent, readiness failures, keyboard suggestions, autosave validation, browser history, plan selection, subscription management during catalog outages, and narrow-screen layouts. These checks deliberately do not request real microphone audio or charge a card.
