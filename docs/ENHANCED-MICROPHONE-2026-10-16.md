# Enhanced microphone for quiet or slow speech

Enable **Enhanced microphone · quiet voices** in Capture setup before starting a live session on the [existing site](https://frontend-blush-pi-24.vercel.app). Leave it off to keep the existing browser speech recognizer. This option belongs to the Vercel browser workspace; the separate FastAPI/WebSocket capture path keeps its existing behavior.

Start capture before the conversation and wait for **Listening live** before the first question. Microphone permission and AudioWorklet initialization must complete before audio can be processed.

## How it works

Android Chrome's built-in speech recognizer does not accept a processed microphone track and can ignore continuous recognition. Enhanced mode captures through the existing AudioWorklet independently of that recognizer. It requests browser automatic gain, turns off echo cancellation and noise suppression that can remove soft room voices, and sends 16 kHz mono PCM through bounded in-memory processing.

Each segment is normalized toward a target level, with at most 16× gain and a peak limit to prevent clipping. Digital silence stays silent. This improves the level of captured speech but cannot recover words buried in noise or never received by the microphone.

Capture continues while short WAV segments are understood through the existing server-side Gemini credential. Segments last at most four seconds, carry 300 ms of pre-roll and preserve 500 ms of overlap at continuous boundaries. A near-silent pause of 600 ms finalizes the current segment; otherwise continuous audio keeps being processed. Incomplete questions can continue across these boundaries. Loud background noise can keep a segment active until its four-second boundary, which adds latency. The overlap assembler only removes matching words at a known overlapping audio boundary in the same turn.

An incomplete question prefix such as “what is” can wait for a continuation captured within ten seconds. The gap is measured using capture timestamps, so a queued or slow transcription response does not discard promptly spoken words. Candidate narration is not carried into a following speaker turn. Speaker identity remains uncertain in a mixed microphone stream.

The input meter reports the level reaching the phone and the last segment's applied gain. It shows a waiting message before samples arrive and suggests moving the microphone closer when the input is nearly silent.

## Latency, resources and limits

Enhanced mode adds audio collection and provider audio processing. When no ready uploaded sources are in use, or personalization is technical, it transcribes, recognizes a request and streams the contextual answer in one call. The default combined model is Gemini 3.1 Flash-Lite, with Gemini 3.6 Flash fallback before a preview is shown. `GEMINI_AUDIO_ANSWER_MODEL` overrides that default; `GEMINI_ANSWER_MODEL` remains an overall answer override. Uploaded-source personalization keeps transcription followed by question-based evidence retrieval and the existing streamed answer. Context/preferences changes invalidate a prepared audio answer rather than applying stale results. See [latency measurements and validation](LATENCY-2026-10-16.md).

This mode can use more provider resources than standard browser recognition and cannot promise a fixed response time. In noisy rooms, moving the microphone closer is usually more useful than increasing gain.

Audio is held temporarily in memory and is not written to application storage. Short processed segments are sent to Gemini for authorized transcription. Stop, permission revocation, backgrounding or capture interruption releases tracks and aborts requests. Pending responses cannot revive a stopped session. The queue is limited to three waiting segments; if transcription cannot keep up, capture stops with an explicit error rather than silently dropping audio.

The same-origin transcription endpoint uses the existing origin/header checks, a separate per-instance 60-request/minute audio bucket, a 400,000-byte request-body cap (including bounded answer context), strict base64/canonical WAV validation and a six-second audio input limit. The client normally sends at most four seconds. Credentials remain server-only. At most two model attempts run within bounded timeouts; an already previewed response is never silently replaced with a different model's answer. Unavailable or malformed responses produce errors, never a synthesized transcript. Empty speech is accepted without creating a question. `GEMINI_TRANSCRIPTION_MODEL` optionally overrides the default Gemini 3.6 Flash model for the separate transcription path.

## Verification

Regression coverage includes quiet gain/clipping, silence, slow pauses, overlap, strict WAV validation, rejected cross-site requests, provider failures, microphone ownership, late responses after Stop, separation of candidate speech, and an 11-second delayed transcription continuation that retains its comparison instruction.

The final local check passed **225 unit tests** (one unrelated opt-in conversation benchmark skipped), ESLint, TypeScript and the production build. All **three Playwright journeys passed** against that build in 37.1 seconds: persistence, standard live conversation and Enhanced quiet/slow audio. Independent TypeScript, React and code/security reviewers found no remaining blocking issues after the capture-timestamp fix.

Production was redeployed successfully on October 16 as `dpl_BcxfEAi6UHiimR5idqaBxHmAhQXh` (`READY`), using Vercel CLI 64.3.1 with the existing project scope explicitly selected. The health check confirmed AI configuration. Both standard production browser journeys passed; the Enhanced quiet/slow journey then passed in 13.1 seconds with real server transcription and answer generation. Its fixture includes two seconds of startup silence to represent waiting for capture readiness. The transcript assertion checks the full question in the transcript log, allowing multiple rows rather than assuming a single row. The initial public run exposed this test startup/locator issue; no application response mocking was added.

A real-provider browser test used a synthesized “What is a Python dictionary?” recording attenuated by 34 dB. It exercised real getUserMedia capture, AudioWorklet PCM conversion, WAV normalization, the server transcription route, Gemini and answer rendering. A second fixture used slow speech with an inserted 1.8-second pause and an input RMS of approximately −56.5 dBFS. Both reached an answer; Stop ended the microphone track and disabled retention left session turns empty. Standard browser persistence and conversation journeys also passed alongside this test.

These are desktop Chromium tests with a fake microphone supplying an actual quiet WAV, not a physical Android acoustic test. Android hardware, browser audio processing, Bluetooth routing, meeting-app microphone sharing and real room noise remain device-specific. A microphone still must actually hear the interviewer; headphones and operating-system restrictions can prevent another app's audio from reaching it.

To repeat the audio journey, supply a mono PCM WAV fixture and a running browser workspace with its server Gemini key:

```powershell
cd frontend
$env:E2E_BROWSER_MODE='1'
$env:E2E_BASE_URL='http://127.0.0.1:3021'
$env:E2E_QUIET_AUDIO_FILE='C:/absolute/path/to/quiet-voice.wav'
npx playwright test tests/e2e/enhanced-microphone.spec.ts
```

The local synthetic source and attenuated fixtures are kept under ignored `data/quiet-voice-*` and `data/quiet-slow-voice-*` paths. The app does not create these files from user audio.

References: [SpeechRecognition browser compatibility](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json), [Gemini audio input](https://ai.google.dev/gemini-api/docs/audio).
