# Continuous streaming speech recognition — October 16, 2026

## Decision and research

The previous Enhanced path waited for a finished WAV clip, uploaded it, then transcribed/answered it. The new default sends 100 ms PCM frames continuously to a dedicated speech recognizer; stable interim questions can enter the existing answer pipeline before the final transcript arrives.

Options considered:

| Option | Fit for this application |
| --- | --- |
| Browser/on-device Web Speech | Retained as Standard. On-device processing is experimental and language-pack availability varies. It does not give this application the same control over quiet-audio PCM. |
| Deepgram streaming | Supports interim transcripts and configurable endpointing. Requires a separate provider credential/account; not provisioned or benchmarked here. |
| Gemini dedicated Live Transcribe | Selected and tested with the existing account. Text-only streaming STT, English India/US hints and technical vocabulary biasing; avoids a new provider or conversational audio agent. |

Primary sources consulted October 16:

- [Google Live Transcribe guide](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe): PCM format, interim/final semantics, vocabulary, VAD and language hints.
- [Google model limitations](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe): ten-minute streaming connection limit and no streaming speaker diarization.
- [Google Live API reference](https://ai.google.dev/api/live): wire fields, activity audio offsets, token restrictions and constrained WebSocket RPC.
- [Google ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens): temporary client credentials.
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing): a free tier is listed, subject to project quotas. Paid usage is billed separately from answer generation; the listed blended STT estimate is about $0.009/minute. No billing setting or subscription was changed. Free-tier provider data handling differs from paid-tier handling.
- [MDN on-device recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally): experimental availability.
- [Deepgram endpointing/interim results](https://developers.deepgram.com/docs/understand-endpointing-interim-results): streaming alternative.

This is the best tested fit with the current credentials and architecture, not a universal accuracy ranking across providers or devices.

## Implementation

`StreamingRecognition` owns one `AudioCapture` requested synchronously from Start. Every frame is transmitted, including low-level audio; an energy threshold does not discard words. Smoothed gain is bounded at 16×, with a 0.95 peak ceiling. Digital silence remains silent. A local 400 ms pause can request finalization while provider VAD remains enabled.

The shared setup selects `gemini-3.5-transcribe-live`, TEXT only, verbatim transcription, en-IN/en-US hints, and a small technical vocabulary. Interim text replaces its prior hypothesis. Authoritative final segments commit once, with the same controller pause/carry behavior used by Enhanced capture. Incomplete contextual prefixes such as “now in … JavaScript” now survive a final boundary. Questions are still determined by intent, regardless of an uncertain speaker label. Uploaded-source retrieval, recent question choices, stale-response suppression, memory and answer streaming remain in the answer pipeline.

`POST /api/live/speech-ticket` accepts an empty JSON object. It reuses the site's origin/header checks and has its own per-instance/IP limit of four tickets/minute. The server posts `bidiGenerateContentSetup` to Google's `v1beta/auth_tokens`: one use, a one-minute new-session window, thirty-minute credential expiry, and no `fieldMask`, which locks the complete setup including absent tools. This REST field and `BidiGenerateContentConstrained?access_token=…` were verified directly. A guide's `liveConnectConstraints` REST example returned400; that SDK-facing spelling is not used on the wire.

Only the short-lived credential reaches the browser, in memory. Responses use no-store. The permanent key stays in server headers; credentials/provider errors are never echoed into application messages. This public device-local workspace does not acquire multiuser authentication or distributed quota enforcement from ephemeral tokens.

Audio buffering is bounded to sixty frames/six seconds. Startup frames drain in order with 20 ms yields instead of overflowing browser TLS buffering. New frames cannot overtake buffered frames. Persistent transport congestion, expired buffers, invalid responses, Stop, backgrounding or capture loss terminate clearly. A broken socket stops and asks for repetition because replaying unacknowledged audio could duplicate or change questions.

## Connection renewal and limitations

After eight minutes, the app can renew at a confirmed quiet boundary, preserving microphone ownership and buffering new audio while the next connection starts. Renewal requires no pending interim, no cloud/local speech activity, no queued audio, two seconds of local quiet, matching cloud activity-start/end/final counts, and a provider activity-end audio offset covering all locally detected voiced frames. An old final transcript alone cannot acknowledge newer audio, and an activity-end event without its authoritative final cannot permit renewal. Empty final segments reset their capture timestamp.

If continuous audio, persistent room noise, or absent provider acknowledgments prevent a safe boundary, capture stops explicitly at 9.5 minutes, before the provider's ten-minute limit. Restart the session or choose Enhanced for such environments. Multi-hour uninterrupted streaming in noisy rooms is not established by these tests. This conservative limit avoids silently discarding an unfinished question. There is no claim of speaker diarization from one mixed microphone.

## Validation

- 310 unit tests passed; two external provider benchmark tests are opt-in and skipped in the default suite. The backend live suite passed 64 tests. TypeScript, ESLint and the Vercel production build passed.
- New tests cover token restrictions, cross-origin rejection, issuance limits, safe errors, initial audio buffering, PCM gain, ordered backpressure, Stop during token provisioning, interim replacement, final commit, empty finals, delayed old finals, capture timestamps, planned renewal and expiration.
- Real Chromium AudioWorklet capture with a synthetic quiet microphone fixture and real Gemini: three local runs passed. First displayed answer after estimated speech end:2669,2066,2303 ms; median 2303 ms. Earlier production baseline with the same fixture:5195,3690,4725 ms; median 4725 ms. This local/production comparison is provisional until production readback.
- A real-capture quiet fixture with a 1.8-second pause inside “What is … a Python dictionary?” passed. Standard browser workspace journeys for source/profile persistence and real-model contextual answers also passed on rerun. An earlier run had a transient browser actionability timeout and a missed bare-topic model response; these are not concealed as passed attempts.
- Physical Android Chrome hardware, different accents, noisy calls and broad word-error rate have not been measured. Synthetic fixtures establish particular regressions, not a general accuracy percentage.

Reproduce with the existing E2E fixture command, adding `E2E_SPEECH_ENGINE=streaming`. Supply `E2E_VOICE_END_MS` only when the fixture end is known. Local ignored measurement reports are under `data/streaming-local-latency-2026-10-16.json`; raw audio is synthetic and ignored by Git.

## Keyword definitions and simple examples

The follow-up request added “database means”, “SQL means”, “Python means”, bare language names and additional common technical topics to the fast topic path. Comma-separated means prompts become recent-question choices. The server retains original speech while supplying a normalized standalone-topic request, so a new definition is not suppressed by an unrelated prior coding task. Keyword-only definition requests are an intentional product behavior requested by the user; full candidate narratives and reported past questions remain guarded.

Explanatory answers now include one short concrete example by default, within the selected answer length. A **Simple example** select in live answer options and Profile controls `include_simple_example`; **Only when I ask** opts out of unsolicited examples. Explicit spoken example requests still take priority. Strict grounding, missing-information clarification and prohibitions on invented personal experience apply to examples. The backend schema/prompt also support the preference. Profile requires Save profile; live options save automatically.

Validation adds means-prompt parsing, interim timing, preference persistence, server prompt controls and three real-model definition/example cases. A consecutive-keyword browser reproduction exposed a final/interim window merge: the final of an already-submitted stable request now commits immediately, so the next keyword starts its own window. A three-keyword regression covers Database, SQL and Python without an artificial pause between recognition events.

A separate browser trace found an older speech debounce firing after a manual recent-question selection. Manual requests now clear the already-heard window and queued speech, supersede older answer requests before aborting them, and ignore delayed audio captured before the selection. Capture continues, and completed audio boundaries reset their result cursor. Regressions cover the next native/Enhanced keyword and intentional aborts without a false timeout. The local full browser journey passed with consecutive means prompts and their examples.

A nineteen-case model benchmark initially omitted the Python-specific ABC mechanism in its abstract-class case; language-specific explanation/example guidance was strengthened. The next run passed18 of19 intent/transport cases; all three new definition/example cases passed, and one stack-code response stopped after a preview. Safe synthetic diagnostics identified intermittent provider RECITATION finish flags on common code snippets with both tested answer models. Filters were not disabled, partial responses are not accepted as complete, and the stream now reports a fixed stopped-generation message rather than incorrectly implying a network/quota failure. This remains an external provider reliability limitation; it is not claimed fixed by a clean local test suite. Temporary diagnostic code was removed. Deployment measurements and final release identity are recorded after production verification.

## Production release

The initial deployment `dpl_6qtpPjKmCA5NrJzeNVkcFLSTTC8s` reached READY at [the production site](https://frontend-blush-pi-24.vercel.app) (`frontend-9w45rbgqb-vcontenthelper-4975s-projects.vercel.app`). The public health route returned200 with AI configured. Production compilation and TypeScript completed successfully.

Three real Chromium microphone/AudioWorklet-to-Gemini runs passed on this release. Estimated speech-end-to-first-displayed-answer times were2927,2795,2886 ms; median2886 ms, versus the earlier production median4725 ms (38.9% lower). Same synthetic quiet fixture, three runs per release: this is a small regression comparison, not an all-device latency guarantee. Reports are in ignored `data/streaming-production-latency-2026-10-16.json`. Physical Android testing remains outstanding.

The final public browser run passed all three journeys in1.4 minutes: source/profile persistence; real-model conversation, manual choice, consecutive Database/SQL/Python means prompts with relevant examples and mobile layout; and quiet speech with a1.8-second internal pause through actual PCM capture. Stop released microphone tracks and disabled text retention left no saved turns. The temporary local3022 verification server was stopped after verification.

Final release `dpl_4c8TW2hPtqJZvM2r9ZCYdZ4rwzBr` is READY (`frontend-58fvjuemj-vcontenthelper-4975s-projects.vercel.app`) at the same public URL. It adds one narrow correction: the pre-manual audio timestamp cutoff is used for Enhanced's actual segment capture times, while Streaming's local energy estimate cannot discard cloud-recognized quiet speech. A regression covers a new faint question below the local activity threshold after manual selection. All310 frontend tests pass. Final public health, three real-model means-prompt/example checks, and the real quiet-microphone E2E check passed. The final smoke report is in ignored `data/streaming-final-production-smoke-2026-10-16.json`.
