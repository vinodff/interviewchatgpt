import { api, ApiError, messageOf, post } from "./api";
import { AudioCapture, type AudioMode } from "./capture";
import { parseLiveMessage, websocketUrl, type LiveMessage } from "./protocol";
import type { Session, Evidence } from "./types";
import { getStoredUser, searchStoredEvidence, addTurnToStoredSession } from "./browser-storage";
import { generateHumanAnswer } from "./knowledge-engine";

export type LocalEvent = { type: "local"; phase?: "capturing" | "connecting" | "reconnecting" | "ended"; detail?: string; error?: string; dropped?: number };

export function mergeUtterances(current: string, incoming: string): string {
  const curr = current.trim();
  const inc = incoming.trim();
  if (!curr) return inc;
  if (!inc) return curr;

  const currLower = curr.toLowerCase();
  const incLower = inc.toLowerCase();

  // 1. Exact match or incoming is already at the end of current
  if (currLower === incLower || currLower.endsWith(incLower)) {
    return curr;
  }

  // 2. Incoming is a continuation/superset starting with current (e.g. "ok can you write" -> "ok can you write python")
  if (incLower.startsWith(currLower)) {
    return inc;
  }

  // 3. Current starts with incoming (incoming is an older/shorter snapshot)
  if (currLower.startsWith(incLower)) {
    return curr;
  }

  // 4. Incoming contains current anywhere inside it (restarted/extended phrase)
  if (incLower.includes(currLower)) {
    return inc;
  }

  // 5. Overlap between end of curr and start of inc
  const currWords = curr.split(/\s+/);
  const incWords = inc.split(/\s+/);

  const maxCheck = Math.min(currWords.length, incWords.length, 8);
  for (let len = maxCheck; len >= 1; len--) {
    const currTail = currWords.slice(currWords.length - len).map(w => w.toLowerCase()).join(" ");
    const incHead = incWords.slice(0, len).map(w => w.toLowerCase()).join(" ");
    if (currTail === incHead) {
      const remainingIncWords = incWords.slice(len);
      return [...currWords, ...remainingIncWords].join(" ");
    }
  }

  // 6. If incoming looks like a rephrased longer sentence, take incoming
  if (incWords.length >= currWords.length + 3) {
    return inc;
  }

  return `${curr} ${inc}`;
}

/** Normalized comparison form: lowercase, no punctuation, single spaces. */
function normText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy duplicate-question check. Growing ASR repeats are never exactly equal,
 * so exact comparison misses them. True when one normalized question contains
 * the other (covers superstring repeats in both directions) or token overlap
 * is very high (covers lightly rephrased repeats).
 */
export function isDuplicateQuestion(a: string, b: string): boolean {
  const na = normText(a);
  const nb = normText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  // Containment needs a meaningful anchor so tiny phrases cannot match everything.
  if (shorter.length >= 12 && longer.includes(shorter)) return true;
  const setA = new Set(na.split(" "));
  const setB = new Set(nb.split(" "));
  let inter = 0;
  setA.forEach(word => { if (setB.has(word)) inter++; });
  return inter / (setA.size + setB.size - inter) >= 0.8;
}

/**
 * Collapse immediately repeated multi-word runs ("...tags here ...tags here")
 * that streaming ASR emits inside one long turn. cleanQuestion only handles
 * runs up to 4 words; recognition restarts echo much longer runs.
 */
export function dedupeRepeatedPhrases(text: string): string {
  const tokens = text.split(/(\s+)/);
  const words: string[] = [];
  const gaps: string[] = [];
  tokens.forEach((token, index) => { (index % 2 === 0 ? words : gaps).push(token); });
  const keyOf = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let i = 0; i < words.length; i++) {
      // No run-length cap: recognition restarts echo whole sentences (50+ words).
      const maxRun = Math.floor((words.length - i) / 2);
      for (let run = maxRun; run >= 1; run--) {
        let same = true;
        for (let k = 0; k < run; k++) {
          if (keyOf(words[i + k]) !== keyOf(words[i + run + k]) || !keyOf(words[i + k])) { same = false; break; }
        }
        if (same) {
          words.splice(i + run, run);
          gaps.splice(i + run, run);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return words.map((word, index) => word + (gaps[index] || "")).join("").trim();
}

/**
 * Classify new speech against the last finalized turn, reusing the proven
 * mergeUtterances overlap logic:
 * - "repeat": fully covered by prior text (echo / older snapshot) → ignore.
 * - "continuation": extends or overlaps prior text → resume the same row.
 * - "new": unrelated → start a fresh row.
 */
export function repetitionOf(incoming: string, prior: string): "repeat" | "continuation" | "new" {
  const inc = incoming.trim();
  const prev = prior.trim();
  if (!inc || !prev) return "new";
  const merged = mergeUtterances(prev, inc);
  if (merged.toLowerCase() === prev.toLowerCase()) return "repeat";
  if (merged !== `${prev} ${inc}`) return "continuation";
  return "new";
}

export function cleanQuestion(fullText: string): string {
  let q = fullText.trim();

  // 1. Strip conversational filler prefixes
  q = q
    .replace(/^(okay|ok|so|now|alright|well|and|um|uh|please)\s*,?\s*/i, "")
    .replace(/^(let me know|can you tell me|could you tell me|tell me|i want to know|can you explain|could you explain|i want you to)\s*,?\s*/i, "")
    .replace(/^(your|about|what)\s+(what is|what are)/i, "$2")
    .trim();

  // 2. Remove consecutive duplicate words or phrases (collapses stutters)
  for (let pass = 0; pass < 3; pass++) {
    q = q.replace(/\b(\w+(?:\s+\w+){0,3})\s+\1\b/gi, "$1");
  }

  return q.trim();
}

export function isLikelyQuestion(raw: string, clean: string): boolean {
  const r = raw.trim();
  const c = clean.trim();
  if (c.length < 4) return false;

  // 1. Definite question mark
  if (r.endsWith("?") || c.endsWith("?")) return true;

  // 2. Explicit question interrogatives (e.g. "what", "how", "why", "when", "where", "which", "who")
  const hasInterrogative = /^(what|how|why|when|where|which|who|whom|whose)\b/i.test(r) ||
    /^(what|how|why|when|where|which|who|whom|whose)\b/i.test(c) ||
    /\b(what is|what are|how to|how do|how does|how can|why is|why does|which one)\b/i.test(c);
  if (hasInterrogative) return true;

  // 3. Modal / auxiliary interview questions (e.g. "can you", "could you", "would you")
  const hasModal = /\b(can you|could you|would you|will you|should you)\b/i.test(c);
  if (hasModal) return true;

  // 4. Inverted auxiliary verbs (e.g. "is there", "are there", "do you", "does it", "have you", "did you")
  const hasInvertedAux = /^(is|are|do|does|did|have|has|was|were)\s+(you|we|there|it|a|an|the|this|that|they)\b/i.test(r) ||
    /^(is|are|do|does|did|have|has|was|were)\s+(you|we|there|it|a|an|the|this|that|they)\b/i.test(c);
  if (hasInvertedAux) return true;

  // 5. Direct request / imperative to explain, describe, tell, compare
  const hasImperative = /^(explain|describe|tell me|talk about|what about|how about|walk me through|clarify|elaborate|give me|compare|difference between)\b/i.test(r) ||
    /^(explain|describe|tell me|talk about|what about|how about|walk me through|clarify|elaborate|give me|compare|difference between)\b/i.test(c);
  if (hasImperative) return true;

  // 6. Direct coding prompts (e.g. "write code for...", "implement...", "give me python code for...")
  const hasCodePrompt = /\b(write|show|give|implement|create|code|draft)\s+(a|an|the|me|us|some)?\s*(code|program|function|script|algorithm|class|method|solution|linked list|palindrome|two sum|hash map)\b/i.test(c);
  if (hasCodePrompt) return true;

  // 7. Explanatory statements / candidate reading: if it starts with first-person, descriptive definitions ("In Python a dictionary is..."), reject it!
  const isExplanation = /^(i\s|i'm|in my|in python\s+[a-z\s]+(is|are)\b|for example|basically|first|next|then|here|my\s|as a|so if|when we|it is|it has|this is|they are|we can|you can|user_scores|items\s*=)\b/i.test(c);
  if (isExplanation) return false;

  // 8. Core technical interview concepts & topics (e.g. "sequential data type in Python", "mutable vs immutable", "garbage collection")
  // In an interview, naming a technical topic or concept is a prompt for the candidate to explain it.
  const technicalTopics = /(sequential\s+data\s+type|sequence\s+type|sequence\s+types|data\s+type|mutable|immutable|mutability|garbage\s+collection|memory\s+management|linked\s+list|hash\s+map|dictionary|list\s+vs\s+tuple|palindrome|two\s+sum|binary\s+search|sorting\s+algorithm|recursion|gil\b|global\s+interpreter\s+lock|multithreading|concurrency|asyncio|generator|iterator|decorator|rest\s+api|fastapi|django|docker|kubernetes|sql\b|database\s+index)/i;
  if (technicalTopics.test(c)) {
    return true;
  }

  // 9. Short prompt mentioning python / javascript / react / sql along with technical keywords (under 8 words)
  const words = c.split(/\s+/);
  if (words.length <= 8 && /(python|javascript|react|sql|database|api|code|algorithm|memory|class|function)/i.test(c)) {
    return true;
  }

  return false;
}

export class LiveController {
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private speechRecognition: { stop: () => void; start: () => void; abort?: () => void } | null = null;
  private activeTranscriptId: string | null = null;
  private activeUtterance = "";
  private speechDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityHandler: (() => void) | null = null;
  private wakeLock: unknown = null;
  private isRecognizing = false;
  private stopped = false;
  private reconnects = 0;
  private dropped = 0;
  private session: Session | null = null;
  private lastServerAt = Date.now();
  /** Tracks the last generated answer so we can detect self-echo (user reading the answer aloud) */
  private lastAnswerText = "";
  private lastAnswerAt = 0;
  /** True while an answer is actively being generated / streamed */
  private isGeneratingAnswer = false;
  /** When true, locks the currently displayed answer from being replaced by new speech */
  private isAnswerLocked = false;
  /** True while speech recognition is in the middle of starting asynchronously */
  private isStarting = false;
  /** Session start time for millisecond-level elapsed timestamp tracking */
  private startedAt = 0;
  /** Text already finalized by previous recognition instances in the active turn */
  private turnCommittedText = "";
  /** Last accepted question, guarded by a fuzzy duplicate window */
  private lastProcessedQuestion = "";
  /** When the last question was accepted, for the fuzzy duplicate window */
  private lastQuestionAt = 0;
  /** Tracks the last finalized turn for smart cross-pause utterance stitching */
  private lastFinalizedTurn: { text: string; at: number; id: string; role: "user" | "interviewer" } | null = null;

  constructor(private notify: (event: LiveMessage | LocalEvent) => void, private onSession: (session: Session) => void) {}

  setAnswerLocked(locked: boolean) {
    this.isAnswerLocked = locked;
  }

  private getElapsedTimestamp(): string {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - (this.startedAt || Date.now())) / 1000));
    const mm = Math.floor(elapsedSec / 60).toString().padStart(2, "0");
    const ss = (elapsedSec % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }

  private determineRole(text: string): "user" | "interviewer" {
    const clean = text.trim().toLowerCase();

    // 1. Explicit Candidate Speech Patterns ALWAYS mean candidate (user)
    if (/^(my answer is|in my opinion|in my experience|in my work|as i mentioned|i typically|i would say|let me explain|so basically i|i use|i am|i'm|from my background|in my previous project|here is how i|my approach is)\b/i.test(clean)) {
      return "user";
    }

    // 2. Candidate reading the displayed answer aloud (self-echo) is checked
    // BEFORE question patterns: answer-reading in a mixed microphone carries
    // topic keywords ("dictionary", "tags") that question heuristics would
    // otherwise match, wiping the answer the candidate is reading. Real
    // questions are safe — isSelfEcho excludes interrogative-led utterances.
    if (this.isSelfEcho(text)) return "user";

    // 3. Clear Question or Interview Prompt ALWAYS means interviewer
    if (isLikelyQuestion(text, cleanQuestion(text))) {
      return "interviewer";
    }

    return "interviewer";
  }

  async start(mode: AudioMode, title: string, retention: boolean) {
    try {
      const host = typeof window !== "undefined" ? (window.location.hostname || window.location.host || "") : "";
      const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
      const isHostedDomain = host !== "" && !isLocal;
      const isBrowserMode = isHostedDomain && !process.env.NEXT_PUBLIC_WS_URL;

      if (isBrowserMode) {
        // In Browser Live Mode on mobile/hosted devices, request mic permission upfront if supported
        // and immediately release tracks so the hardware mic is 100% free and unblocked for SpeechRecognition!
        if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
          } catch (err) {
            if ((err as Error)?.name === "NotAllowedError" || (err as Error)?.name === "PermissionDeniedError") {
              await this.fail("Microphone permission was denied. Please allow microphone access in your browser settings to continue.", false);
              return;
            }
          }
        }
      } else {
        this.capture = new AudioCapture(mode, packet => this.sendAudio(packet), message => { void this.fail(message); });
        this.notify({ type: "local", phase: "capturing", detail: "Waiting for your browser’s audio permission…" });
        await this.capture.ready;
      }

      if (this.stopped) return;
      this.notify({ type: "local", phase: "connecting", detail: "Connecting your authorized conversation…" });
      const session = await api<Session>("/sessions", post({ consent: true, audio_mode: mode, title: title.trim() || "Live conversation", retention }));
      this.session = session;
      this.onSession(session);
      if (this.stopped) { await api(`/sessions/${session.id}/stop`, post()); return; }
      await this.connect();
    } catch (error) { if (!this.stopped) await this.fail(messageOf(error)); }
  }

  private async connect() {
    if (this.stopped || !this.session) return;

    const host = typeof window !== "undefined" ? (window.location.hostname || window.location.host || "") : "";
    const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
    const isHostedDomain = host !== "" && !isLocal;

    if (isHostedDomain && !process.env.NEXT_PUBLIC_WS_URL) {
      this.startBrowserLiveMode();
      return;
    }

    let ticket: string;
    try { ({ ticket } = await api<{ ticket: string }>(`/sessions/${this.session.id}/ticket`, post())); }
    catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        const detail = error.status === 409 ? "This session has ended. Audio capture stopped. Start a new session to continue."
          : error.status === 401 ? "Your sign-in has expired. Audio capture stopped. Sign in again and start a new session."
          : error.status === 403 ? "Access to this live session was denied. Audio capture stopped. Check your permissions before starting a new session."
          : [404, 410].includes(error.status) ? "This live session is no longer available. Audio capture stopped. Start a new session to continue."
          : `The live connection was refused: ${messageOf(error)} Audio capture stopped. Check the request before starting a new session.`;
        await this.fail(detail, false); return;
      }
      throw error;
    }
    if (this.stopped) return;
    const ws = new WebSocket(websocketUrl(this.session.id, ticket, process.env.NEXT_PUBLIC_WS_URL || "", window.location));
    this.socket = ws;
    ws.onopen = () => {
      if (this.stopped || ws !== this.socket) { ws.close(); return; }
      this.lastServerAt = Date.now();
      this.notify({ type: "local", detail: "Audio connected. Waiting for the transcription service…" });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (Date.now() - this.lastServerAt > 40000) ws.close(4000, "Heartbeat timed out");
          else ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    };
    ws.onmessage = event => {
      if (ws !== this.socket || this.stopped || typeof event.data !== "string") return;
      const message = parseLiveMessage(event.data);
      if (!message) return;
      this.lastServerAt = Date.now();
      this.notify(message);
      if (message.type === "status" && message.state === "listening") this.reconnects = 0;
      if (message.type === "status" && message.state === "ended") { void this.stop(); }
      if (message.type === "error" && !message.recoverable) { void this.fail(message.message); }
    };
    ws.onerror = () => { /* Close owns reconnect; browsers intentionally hide handshake details. */ };
    ws.onclose = event => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (ws !== this.socket || this.stopped) return;
      if (event.code === 4409) { void this.fail("A live connection is already active for this session. Audio capture stopped in this browser. Return to the active browser or start a new session.", false); return; }
      if ([1008, 4401, 4403].includes(event.code)) { void this.fail("The live connection was refused. Check your session, permissions, and server configuration before restarting.", false); return; }
      this.scheduleReconnect();
    };
  }

  private startBrowserLiveMode() {
    if (this.stopped) return;
    this.startedAt = Date.now();
    this.notify({
      type: "status",
      state: "listening",
      detail: "Live audio active. Microphone recording continuously…"
    });

    // 1. Acquire Screen Wake Lock on mobile devices so screen and audio don't sleep
    this.acquireWakeLock();

    // 2. Set up visibilitychange handler to recover when phone wakes up or tab returns to view
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (!this.stopped && document.visibilityState === "visible" && this.session && this.session.status !== "ended") {
          this.acquireWakeLock();
          if (!this.isRecognizing && !this.isStarting) {
            this.scheduleRecognitionRestart(80);
          }
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    // 3. Initialize continuous SpeechRecognition (exclusive hardware mic access)
    this.initSpeechRecognition();

    // 4. Watchdog every 1200ms: keeps recognition continuously active even if Android silently dropped it
    this.watchdogTimer = setInterval(() => {
      if (!this.stopped && this.session && this.session.status !== "ended") {
        if (!this.isRecognizing && !this.isStarting) {
          this.safeStartRecognition();
        }
      }
    }, 1200);
  }

  private acquireWakeLock() {
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock.request("screen").then(lock => {
          this.wakeLock = lock;
        }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleRecognitionRestart(delayMs = 80) {
    if (this.stopped || !this.session || this.session.status === "ended") return;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.stopped || !this.session || this.session.status === "ended") return;
      this.safeStartRecognition();
    }, delayMs);
  }

  private safeStartRecognition() {
    if (this.stopped || !this.session || this.session.status === "ended") return;
    if (this.isRecognizing || this.isStarting) return;

    if (!this.speechRecognition) {
      this.initSpeechRecognition();
      return;
    }

    try {
      this.isStarting = true;
      this.speechRecognition.start();
    } catch {
      this.isStarting = false;
      this.isRecognizing = false;
      // If start threw (e.g. InvalidStateError or stale IPC connection on Android), cleanly recreate
      this.initSpeechRecognition();
    }
  }

  private initSpeechRecognition() {
    if (this.stopped || !this.session || this.session.status === "ended") return;

    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    // Safely detach previous instance if any
    if (this.speechRecognition) {
      try {
        this.speechRecognition.stop();
      } catch { /* ignore */ }
      this.speechRecognition = null;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      const deviceLang = typeof navigator !== "undefined" ? (navigator.language || (navigator.languages && navigator.languages[0]) || "en-US") : "en-US";
      recognition.lang = deviceLang;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        this.isRecognizing = true;
        this.isStarting = false;
      };

      recognition.onresult = (event: any) => {
        if (this.stopped) return;

        let sessionFinal = "";
        let sessionInterim = "";

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const phrase = res[0]?.transcript?.trim() || "";
          if (!phrase) continue;
          if (res.isFinal) {
            sessionFinal = sessionFinal ? `${sessionFinal} ${phrase}` : phrase;
          } else {
            sessionInterim = sessionInterim ? `${sessionInterim} ${phrase}` : phrase;
          }
        }

        const incomingText = (sessionFinal || sessionInterim).trim();
        if (!incomingText) return;

        // Ignore conversational filler acknowledgments when idle
        if (this.isFiller(incomingText) && !this.activeUtterance && !this.turnCommittedText) {
          return;
        }

        const now = Date.now();
        if (!this.activeTranscriptId) {
          const prior = this.lastFinalizedTurn;
          const resumable = prior !== null && prior.role === "interviewer" && (now - prior.at) < 60000;
          if (resumable && prior) {
            const relation = repetitionOf(incomingText, prior.text);
            if (relation === "repeat") return;
            if (relation === "continuation") {
              this.activeTranscriptId = prior.id;
              this.turnCommittedText = prior.text;
            } else {
              this.activeTranscriptId = `tr_${now}`;
              this.turnCommittedText = "";
            }
          } else {
            this.activeTranscriptId = `tr_${now}`;
            this.turnCommittedText = "";
          }
        }

        // Clean replacement of current session interim text onto committed text - NO string-merging heuristics!
        const finalizedSoFar = [this.turnCommittedText, sessionFinal].filter(Boolean).join(" ").trim();
        this.activeUtterance = [finalizedSoFar, sessionInterim].filter(Boolean).join(" ").trim();

        const role = this.determineRole(this.activeUtterance);
        const timestamp = this.getElapsedTimestamp();

        // Update the single active transcript turn live in place with exact timestamp!
        this.notify({
          type: "transcript",
          id: this.activeTranscriptId,
          role,
          text: this.activeUtterance,
          timestamp,
          final: false
        });

        if (this.speechDebounceTimer) {
          clearTimeout(this.speechDebounceTimer);
        }

        // Smart adaptive debounce:
        // If the utterance is already a clear question (e.g. "what is data"), finalize in 650ms for lightning-fast answers!
        // For longer ongoing candidate speech, wait 1100ms.
        const isQuestion = isLikelyQuestion(this.activeUtterance, cleanQuestion(this.activeUtterance));
        const debounceMs = isQuestion ? 650 : 1100;
        this.speechDebounceTimer = setTimeout(() => {
          void this.finalizeActiveUtterance();
        }, debounceMs);
      };

      recognition.onerror = (event: any) => {
        const error = event?.error;
        this.isRecognizing = false;
        this.isStarting = false;

        // 'no-speech' is normal when room is quiet; onend will fire shortly and schedule seamless restart
        if (error === "no-speech") return;

        if (error === "not-allowed") {
          this.notify({
            type: "local",
            phase: "ended",
            error: "Microphone permission was not allowed. Please allow microphone access in your browser site settings."
          });
          return;
        }

        // For transient errors on mobile (aborted, audio-capture, network), schedule restart
        this.scheduleRecognitionRestart(120);
      };

      recognition.onend = () => {
        this.isRecognizing = false;
        this.isStarting = false;

        // If recognition ended mid-utterance, commit current utterance so next instance continues seamlessly
        if (this.activeTranscriptId && this.activeUtterance) {
          this.turnCommittedText = this.activeUtterance;
        }

        // On Android Chrome, recognition automatically ends after speech; immediately re-arm with safe 80ms delay
        if (!this.stopped && this.session && this.session.status !== "ended") {
          this.scheduleRecognitionRestart(80);
        }
      };

      this.speechRecognition = recognition;
      this.isStarting = true;
      recognition.start();
    } catch {
      this.isStarting = false;
      this.isRecognizing = false;
      this.scheduleRecognitionRestart(200);
    }
  }

  /**
   * Check if incoming speech is the user reading/repeating the last generated answer (self-echo).
   * Only strong question signals (a trailing "?", or an interrogative / modal /
   * imperative lead like "what", "can you", "tell me") veto echo detection.
   * Topic keywords alone must NOT veto: answer-reading in a mixed microphone
   * always carries them, and vetoing on them is what wiped the displayed
   * answer while the candidate read it. Short utterances (< 8 words) never
   * count as echo — short topic prompts ("mutable vs immutable in python")
   * must still reach the interviewer path, and short non-question speech is
   * already rejected downstream without wiping anything.
   */
  private isSelfEcho(text: string): boolean {
    if (!this.lastAnswerText) return false;
    const elapsed = Date.now() - this.lastAnswerAt;
    // Check within 60 seconds of the answer appearing
    if (elapsed > 60000) return false;

    // Strong question signals are never self-echo.
    const trimmed = text.trim();
    if (/[?？]\s*$/.test(trimmed)) return false;
    if (/^(what|how|why|when|where|which|who|can you|could you|would you|tell me|explain|describe|difference between|walk me through|give me)\b/i.test(trimmed)) {
      return false;
    }

    const cleanAnswer = this.lastAnswerText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const cleanSpeech = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleanAnswer || !cleanSpeech) return false;

    const speechTokens = cleanSpeech.split(" ").filter(w => w.length > 0);
    if (speechTokens.length < 8) return false;

    // 5-word n-gram check: if any 5 consecutive words in spoken speech appear in the answer, it's self-echo
    for (let i = 0; i <= speechTokens.length - 5; i++) {
      const penta = `${speechTokens[i]} ${speechTokens[i + 1]} ${speechTokens[i + 2]} ${speechTokens[i + 3]} ${speechTokens[i + 4]}`;
      if (cleanAnswer.includes(penta)) {
        return true;
      }
    }

    // Paraphrased / ASR-mangled reading ("tax" for "tags", dropped words)
    // rarely keeps 5 clean words in a row. Fall back to a 4-gram check plus
    // bag containment: if nearly every spoken word comes from the displayed
    // answer, the candidate is reading it aloud.
    for (let i = 0; i <= speechTokens.length - 4; i++) {
      const tetra = `${speechTokens[i]} ${speechTokens[i + 1]} ${speechTokens[i + 2]} ${speechTokens[i + 3]}`;
      if (cleanAnswer.includes(tetra)) {
        return true;
      }
    }
    const answerSet = new Set(cleanAnswer.split(" ").filter(w => w.length > 0));
    let hits = 0;
    for (const word of speechTokens) {
      if (answerSet.has(word)) hits++;
    }
    if (hits / speechTokens.length >= 0.7) {
      return true;
    }

    return false;
  }

  private async finalizeActiveUtterance() {
    if (this.stopped || !this.activeUtterance.trim()) return;

    // Collapse long repeated runs streaming ASR echoes inside one turn
    // ("...tags here ...tags here ...tags here" → one instance) before the
    // text is displayed as final or used for question detection.
    const raw = dedupeRepeatedPhrases(this.activeUtterance.trim());
    if (!raw) return;
    const transcriptId = this.activeTranscriptId;
    const role = this.determineRole(raw);
    const timestamp = this.getElapsedTimestamp();

    // Mark current turn as finalized in the transcript UI with exact timestamp & accurate role
    if (transcriptId) {
      this.notify({
        type: "transcript",
        id: transcriptId,
        role,
        text: raw,
        timestamp,
        final: true
      });
    }

    // Save for smart cross-pause utterance stitching (including role)
    this.lastFinalizedTurn = { text: raw, at: Date.now(), id: transcriptId || `tr_${Date.now()}`, role };

    // Reset utterance tracking so next question gets its own turn
    this.activeTranscriptId = null;
    this.activeUtterance = "";
    this.turnCommittedText = "";

    // Candidate speech should not trigger new answers
    if (role === "user") return;

    if (this.isFiller(raw)) return;

    const clean = cleanQuestion(raw);
    if (clean.length < 4) return;

    // === SMART ANTI-OVERWRITE SAFEGUARDS ===

    // 1. If user locked the answer in UI, do not overwrite
    if (this.isAnswerLocked) return;

    // 2. If an answer is currently being streamed/generated, ignore new speech
    if (this.isGeneratingAnswer) return;

    // 3. Deduplication: growing ASR repeats are never exactly equal, so an
    // exact comparison misses them and each repeat would emit a new question
    // event — which clears the displayed answer mid-reading. Fuzzy containment
    // + token overlap over a 30s window suppresses re-triggers while a
    // genuinely new question still goes through immediately.
    if (this.lastProcessedQuestion && (Date.now() - this.lastQuestionAt) < 30000 && isDuplicateQuestion(clean, this.lastProcessedQuestion)) {
      return;
    }

    // 4. Self-echo detection: if the user is reading the displayed answer aloud, ignore it
    if (this.isSelfEcho(clean) || this.isSelfEcho(raw)) {
      return;
    }

    // 5. Smart question classification: reject candidate explanations and statements
    if (!isLikelyQuestion(raw, clean)) {
      return;
    }

    this.lastProcessedQuestion = clean;
    this.lastQuestionAt = Date.now();

    await this.respondToQuestion(clean, raw);
  }

  private isFiller(text: string): boolean {
    const cleaned = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (!cleaned) return true;
    return /^(ok|okay|ok\s+ok|okay\s+okay|yeah|yep|yes|sure|right|uh\s*huh|mhm|cool|got\s+it|alright|thanks|thank\s+you|hello|hi|hey|am\s+i\s+audible|can\s+you\s+hear\s+me|testing)+$/i.test(cleaned);
  }

  async respondToQuestion(question: string, rawUtterance?: string) {
    if (this.stopped) return;

    this.isGeneratingAnswer = true;
    try {
      const genId = `gen_${Date.now()}`;
      const displayQuestion = question.length > 5 ? question : (rawUtterance || question);
      const rawWords = displayQuestion.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3);
      const words = Array.from(new Set(rawWords)).slice(0, 5);

      this.notify({
        type: "question",
        generation_id: genId,
        question: displayQuestion,
        keywords: words
      });

      const user = getStoredUser();
      const prefs = user.preferences || {};
      const role = prefs.role || "Software Engineer";
      const evidence = searchStoredEvidence(displayQuestion);

      let answerText = "";

      // 1. Try calling Gemini AI route
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: displayQuestion,
            role,
            preferences: prefs,
            evidence
          }),
          signal: AbortSignal.timeout(6500)
        });
        if (response.ok) {
          const data = await response.json();
          if (data.ok && data.answer) {
            answerText = data.answer;
          }
        }
      } catch {
        /* fallback to instant knowledge engine */
      }

      // 2. Fallback to instant client-side knowledge engine if Gemini is unavailable
      if (!answerText) {
        const result = generateHumanAnswer(displayQuestion, role, prefs, evidence);
        answerText = result.answer;
      }

      // Fast, natural streaming (22ms cadence)
      const tokens = answerText.split(/(\s+)/);
      let accumulated = "";

      for (let i = 0; i < tokens.length; i += 2) {
        if (this.stopped) return;
        const piece = (tokens[i] || "") + (tokens[i + 1] || "");
        accumulated += piece;
        this.notify({
          type: "answer_delta",
          generation_id: genId,
          text: piece
        });
        await new Promise(r => setTimeout(r, 22));
      }

      if (this.stopped) return;
      this.notify({
        type: "answer_complete",
        generation_id: genId,
        answer: accumulated.trim(),
        evidence,
        keywords: words,
        latency_ms: 180
      });

      // Store the answer for self-echo detection and set cooldown timestamp
      this.lastAnswerText = accumulated.trim();
      this.lastAnswerAt = Date.now();

      if (this.session) {
        addTurnToStoredSession(this.session.id, {
          id: `turn_${Date.now()}`,
          role: "interviewer",
          text: rawUtterance || displayQuestion,
          question: displayQuestion,
          answer: accumulated.trim(),
          evidence,
          created_at: new Date().toISOString()
        });
      }
    } finally {
      this.isGeneratingAnswer = false;
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnects >= 8) { void this.fail("The live service is unavailable after several reconnect attempts. Your capture has stopped."); return; }
    const delay = Math.min(750 * 2 ** this.reconnects++, 8000);
    this.notify({ type: "local", phase: "reconnecting", detail: "Connection interrupted. Reconnecting automatically; audio during the interruption is discarded." });
    this.reconnectTimer = setTimeout(() => { void this.connect().catch(error => {
      if (this.stopped) return;
      this.notify({ type: "local", error: messageOf(error) });
      this.scheduleReconnect();
    }); }, delay);
  }

  private sendAudio(packet: ArrayBuffer) {
    const ws = this.socket;
    // No growing application queue; browser output is bounded to about one second.
    if (!this.stopped && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 64000) ws.send(packet);
    else if (!this.stopped) {
      this.dropped++;
      if (this.dropped % 10 === 0) this.notify({ type: "local", dropped: this.dropped });
    }
  }

  private async fail(error: string, stopRemote = true) {
    if (this.stopped) return;
    this.notify({ type: "local", phase: "ended", error });
    await this.stop(stopRemote);
  }

  async stop(stopRemote = true) {
    if (this.stopped) return;
    this.stopped = true;
    this.isStarting = false;
    this.isRecognizing = false;
    this.lastFinalizedTurn = null;
    if (this.wakeLock && typeof (this.wakeLock as { release?: () => Promise<void> }).release === "function") {
      (this.wakeLock as { release: () => Promise<void> }).release().catch(() => undefined);
      this.wakeLock = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.isRecognizing = false;
    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.activeTranscriptId = null;
    this.activeUtterance = "";
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.speechRecognition) {
      try { this.speechRecognition.stop(); } catch { /* ignore */ }
      this.speechRecognition = null;
    }
    this.capture?.stop();
    this.capture = null;
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      ws.onclose = null; ws.onmessage = null; ws.onopen = null;
      if (stopRemote && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
      ws.close();
    }
    this.notify({ type: "local", phase: "ended", detail: "Audio capture stopped." });
    if (this.session && stopRemote) {
      try { const ended = await api<Session>(`/sessions/${this.session.id}/stop`, post()); this.onSession(ended); }
      catch (error) { this.notify({ type: "local", error: `Capture is stopped. Session status could not be saved: ${messageOf(error)}` }); }
    }
  }
}
