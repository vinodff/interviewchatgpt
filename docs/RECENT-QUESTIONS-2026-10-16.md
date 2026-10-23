# Short topics, recent questions and document references

This update addresses a mixed transcript that contained earlier discussion, several DBMS questions and a final “abstract class” prompt. It extends the [latency improvements](LATENCY-2026-10-16.md) on the existing Vercel browser workspace.

## Behavior

Common standalone technical topics such as “Abstract,” “abstract class,” “DBMS,” “polymorphism” and “time complexity” can stabilize as interim speech in 450 ms. They no longer depend on Android marking a long recognition result final. The contextual model still decides whether the speech requests an answer. A term inside a candidate explanation does not automatically establish a new question, and physical speaker identity remains uncertain in a mixed microphone stream.

An explicit trailing topic can supersede an older question in the same transcript. “What is DBMS? abstract class” targets abstract classes rather than reusing a prepared DBMS answer. The Enhanced microphone cache validates this alignment before reuse. Punctuation inside qualified names, such as `java.util.List` or `React.Component.set`, stays intact.

The **Recent questions & topics** row replaces the static example-topic buttons in an active browser session. It shows up to eight options from the actual conversation before the answer finishes. Unconfirmed options are marked **Heard**. The model's confirmed questions remain available as new questions arrive. Select a question to ask it manually with current preferences and context; selection releases a held answer so the new response can appear. Unsupported backend manual controls are hidden.

Recognition corrections replace provisional options, while stable unique identities preserve keyboard focus. Confirming a question and then correcting the same transcript cannot create duplicate button identities. Options remain temporary session state; starting a new session resets them.

## Original speech and context

The API receives the original speech as `latest_speech` and a separate bounded `possible_request_focus` hint. The hint helps topic targeting and evidence retrieval, but is explicitly unverified and cannot override whether the original speech contains a request. This prevents “The interviewer asked what is DBMS” or “I can describe polymorphism” from becoming synthetic commands after extraction.

Pure capability statements without a later question, punctuation boundary or instruction are declined cheaply. This rule returns speaker identity **unknown**; sentence form cannot establish who spoke. For Enhanced audio it applies only when no unfinished question prefix is being carried. “Can you tell me how” followed by “I can describe polymorphism” can therefore remain one real request.

Session memory still supplies earlier code, the active task, programming language, constraints, recent exchanges and reported speech with uncertain attribution. Source evidence is searched for each new question, so newly uploaded ready documents are available without reusing an old source cache.

## Document references

Browser retrieval now matches complete words instead of substrings and ignores question boilerplate. It searches the focused question rather than unrelated narration from a long recognition result. General DBMS or abstract-class questions therefore do not inherit every résumé section that happens to match earlier conversational words.

The answer model returns bounded zero-based `evidence_indices` for excerpts it reports actually using. The API attaches only those excerpts, and session history stores that same selection. A résumé skill name does not establish its technical definition. General knowledge can produce an empty reference list, while strict grounding continues to require supporting evidence or an explicit gap acknowledgment. Model-selected references are not independent verification of an uploaded claim.

## Validation

- **262 unit tests passed**, with two external-provider benchmarks opt-in and skipped in the default suite. TypeScript, ESLint, the production build and whitespace checks passed.
- The expanded **16-case application/provider benchmark passed all intent and selected content checks**, with no missed questions, unwanted answers or transport errors. It includes bare abstract in Python context, bare DBMS, the adjacent-topic transcript, first-person requests, reported questions, code conversions and candidate narration. Requesting cases had a first-text median of 1.808 s and a largest sampled latency of 3.255 s. These measure transcript-to-answer processing, not physical microphone detection.
- The first expanded benchmark exposed an unwanted answer to “I can describe polymorphism.” The conservative narration rule and mixed-question/prefix regressions address that failure; the subsequent benchmark passed.
- All three local browser journeys passed: profile/source persistence, live corrected speech and recent-question replay, and real quiet/slow PCM audio through Gemini. The live journey includes a synthetic résumé that lists DBMS as a skill, verifies no false citation for the definition, selects DBMS while the prior answer is held, checks keyboard focus after speech correction and verifies disabled retention.
- Independent React, TypeScript and code/security reviews verified fixes for reporting context, qualified names, stale audio topic reuse, unsupported controls, option identity collisions and contrast.

These are synthetic desktop Chromium and provider checks. Physical Android microphone behavior, room acoustics and every possible interview phrasing remain unverified. Short-topic vocabulary is a bounded recognition aid; the contextual model and manual selection remain important for ambiguous phrases.

## Production

The update was deployed on October 16 to [the existing site](https://frontend-blush-pi-24.vercel.app), deployment `dpl_2HKjy2jstPBBDxMnA8aLG8fXCQWV` (`READY`). Vercel initially returned an internal error before upload; the retry completed successfully with the existing project scope. The public health check confirmed AI configuration.

All three public browser journeys passed in 50.1 seconds: profile/source persistence, corrected live speech with short topics/manual replay/document-reference filtering, and quiet/slow real audio. The last journey also explicitly checks the completed answer and ready announcement, rather than treating the disappearance of a streaming indicator alone as success.

Three repeated quiet-dictionary journeys against this latest release passed in 38.3 seconds. Their first visible text arrived 5.195, 3.690 and 4.725 seconds after estimated fixture speech end (median 4.725 s), using one client audio/answer call each. This is about 19% lower than the original 5.859-second production median. It is slower than the earlier speed-only release's small 3.330-second sample; the observations do not isolate provider load, network variability or prompt changes. They should not be used to promise a fixed response time. The later measurements are retained in ignored `data/topics-production-latency-2026-10-16.json`.

An additional public live journey passed in 30.3 seconds with the question/topic controls visible in an active 390 × 844 viewport, keyboard-focus correction, manual replay and no document-level horizontal overflow. The screenshot is a test artifact rather than a physical Android capture.

Reload the page before the next session to load this deployment. A tab already running a session continues using its loaded client bundle.
