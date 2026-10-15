# InterviewPilot Live frontend

Next.js 16.4.0, React 19, TypeScript, and Tailwind 4. Install with `npm ci`, then use `npm run dev` with the backend listening on port 8000. `.env.example` documents the public WebSocket origin and internal HTTP proxy origin. No provider or Stripe secrets belong here.

`npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` validate the frontend. `npm run test:e2e` starts Next on port 3000 and exercises the real backend; start the backend and worker first. E2E creates and cleans up a test account, projects, uploaded sources, and sessions. No HTTP response mocking is used. Audio hardware is replaced only in the capture-permission test. Set `E2E_BASE_URL` to use an already running frontend.

Docker builds standalone output and runs as a non-root user. `BACKEND_URL` is a build argument because Next rewrites are compiled into the build. In production a same-origin reverse proxy must route `/api/*`, including WebSocket upgrades, to the backend. Leave `NEXT_PUBLIC_WS_URL` empty for same-origin secure WebSockets. For local production previews set it to `ws://localhost:8000` at build time. Serve both frontend and backend using the same hostname (`localhost` or `127.0.0.1`) so the HTTP-only session cookie reaches the WebSocket handshake.

Start requests browser audio permissions synchronously in the user gesture. Desktop Chrome and Edge can share a meeting tab with audio and a separate microphone. The required display video track stays alive but frames are never encoded or transmitted. Microphone mode is available on supported mobile browsers, with explicitly uncertain speaker attribution. AudioWorklet resamples the native context rate to 16 kHz mono PCM16 in 100 ms packets. Capture stops on permission revocation, browser suspension, terminal errors, component unmount, and Stop. Reconnect discards interrupted audio, uses fresh single-use tickets and bounded backoff, and bounds browser output buffering.

The UI does not offer practice or manual question entry. Speech drives question detection. Only the latest generation can update the displayed answer. Text retention is opt-in at session creation and raw audio is never stored.
