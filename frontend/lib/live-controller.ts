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

export class LiveController {
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private speechRecognition: { stop: () => void; start: () => void } | null = null;
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

  constructor(private notify: (event: LiveMessage | LocalEvent) => void, private onSession: (session: Session) => void) {}

  async start(mode: AudioMode, title: string, retention: boolean) {
    try {
      const host = typeof window !== "undefined" ? (window.location.hostname || window.location.host || "") : "";
      const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
      const isHostedDomain = host !== "" && !isLocal;
      const isBrowserMode = isHostedDomain && !process.env.NEXT_PUBLIC_WS_URL;

      // When in Browser Live Mode on hosted devices (e.g. Android mobile), do not run AudioCapture
      // because Android's AudioFlinger only grants exclusive mic access to one audio client at a time.
      // Skipping AudioCapture gives SpeechRecognition 100% uninterrupted, continuous microphone ownership.
      if (!isBrowserMode) {
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
    this.notify({
      type: "status",
      state: "listening",
      detail: "Live audio active. Microphone listening continuously…"
    });

    // Acquire Screen Wake Lock on mobile devices so screen and audio don't sleep
    if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
      try {
        (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock.request("screen").then((lock: unknown) => {
          this.wakeLock = lock;
        }).catch(() => undefined);
      } catch {
        /* ignore */
      }
    }

    // Set up visibilitychange handler to recover when phone wakes up or tab returns to view
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (!this.stopped && document.visibilityState === "visible" && this.session && this.session.status !== "ended") {
          if (typeof navigator !== "undefined" && "wakeLock" in navigator) {
            try {
              (navigator as unknown as { wakeLock: { request: (type: string) => Promise<unknown> } }).wakeLock.request("screen").then((lock: unknown) => {
                this.wakeLock = lock;
              }).catch(() => undefined);
            } catch { /* ignore */ }
          }
          if (this.speechRecognition && !this.isRecognizing) {
            try { this.speechRecognition.start(); } catch { /* ignore */ }
          }
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }

    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "en-US";
          recognition.maxAlternatives = 1;

          recognition.onstart = () => {
            this.isRecognizing = true;
          };

          recognition.onresult = (event: any) => {
            if (this.stopped) return;

            let currentInterim = "";
            let currentFinal = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              const phrase = res[0]?.transcript?.trim() || "";
              if (!phrase) continue;
              if (res.isFinal) {
                currentFinal = currentFinal ? `${currentFinal} ${phrase}` : phrase;
              } else {
                currentInterim = currentInterim ? `${currentInterim} ${phrase}` : phrase;
              }
            }

            const incomingText = (currentFinal || currentInterim).trim();
            if (!incomingText) return;

            // Ignore conversational filler acknowledgments when idle
            if (this.isFiller(incomingText) && !this.activeUtterance) {
              return;
            }

            if (!this.activeTranscriptId) {
              this.activeTranscriptId = `tr_${Date.now()}`;
              this.activeUtterance = incomingText;
            } else {
              this.activeUtterance = mergeUtterances(this.activeUtterance, incomingText);
            }

            // Update the single active transcript turn live in place!
            this.notify({
              type: "transcript",
              id: this.activeTranscriptId,
              role: "interviewer",
              text: this.activeUtterance,
              final: false
            });

            if (this.speechDebounceTimer) {
              clearTimeout(this.speechDebounceTimer);
            }

            // Debounce speech finalization before generating answer
            this.speechDebounceTimer = setTimeout(() => {
              void this.finalizeActiveUtterance();
            }, 950);
          };

          recognition.onerror = (event: any) => {
            // 'no-speech' is normal when room is quiet; keep listening
            if (event.error === "no-speech") return;

            if (event.error === "not-allowed") {
              this.isRecognizing = false;
              return;
            }

            // For transient errors on mobile (aborted, audio-capture, network), re-arm quickly
            if (event.error === "audio-capture" || event.error === "aborted" || event.error === "network") {
              this.isRecognizing = false;
              if (this.restartTimer) clearTimeout(this.restartTimer);
              this.restartTimer = setTimeout(() => {
                if (!this.stopped && !this.isRecognizing && this.session && this.session.status !== "ended") {
                  try { recognition.start(); } catch { /* ignore */ }
                }
              }, 120);
            }
          };

          recognition.onend = () => {
            this.isRecognizing = false;
            // On Android Chrome, recognition automatically ends after speech; immediately re-arm without delay
            if (!this.stopped && this.session && this.session.status !== "ended") {
              try {
                recognition.start();
              } catch {
                if (this.restartTimer) clearTimeout(this.restartTimer);
                this.restartTimer = setTimeout(() => {
                  if (!this.stopped && !this.isRecognizing && this.session && this.session.status !== "ended") {
                    try { recognition.start(); } catch { /* ignore */ }
                  }
                }, 60);
              }
            }
          };

          recognition.start();
          this.speechRecognition = recognition;

          // Watchdog every 1200ms: keeps recognition continuously active even if Android silently dropped it
          this.watchdogTimer = setInterval(() => {
            if (!this.stopped && this.session && this.session.status !== "ended" && this.speechRecognition && !this.isRecognizing) {
              try {
                this.speechRecognition.start();
              } catch {
                /* already starting or active */
              }
            }
          }, 1200);
        } catch { /* SpeechRecognition not allowed */ }
      }
    }
  }

  private async finalizeActiveUtterance() {
    if (this.stopped || !this.activeUtterance.trim()) return;

    const raw = this.activeUtterance.trim();
    const transcriptId = this.activeTranscriptId;

    // Mark current turn as finalized in the transcript UI
    if (transcriptId) {
      this.notify({
        type: "transcript",
        id: transcriptId,
        role: "interviewer",
        text: raw,
        final: true
      });
    }

    // Reset utterance tracking so next question gets its own turn
    this.activeTranscriptId = null;
    this.activeUtterance = "";

    if (this.isFiller(raw)) return;

    const clean = cleanQuestion(raw);
    if (clean.length < 5) return;

    const isQuestion = raw.includes("?")
      || /^(what|how|why|when|where|which|who|can|could|would|is|are|do|does|did|explain|describe|tell|walk me through|difference)/i.test(raw)
      || /^(what|how|why|when|where|which|who|can|could|would|is|are|do|does|did|explain|describe|tell|walk me through|difference)/i.test(clean)
      || /(python|javascript|react|database|dataset|dictionary|sql|api|system|service|memory|class|function|design|scale|code|git|docker|linked list|hash map|queue|stack|tree|array)/i.test(clean);

    if (isQuestion) {
      await this.respondToQuestion(clean, raw);
    }
  }

  private isFiller(text: string): boolean {
    const cleaned = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (!cleaned) return true;
    return /^(ok|okay|ok\s+ok|okay\s+okay|yeah|yep|yes|sure|right|uh\s*huh|mhm|cool|got\s+it|alright|thanks|thank\s+you|hello|hi|hey|am\s+i\s+audible|can\s+you\s+hear\s+me|testing)+$/i.test(cleaned);
  }

  async respondToQuestion(question: string, rawUtterance?: string) {
    if (this.stopped) return;
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
        signal: AbortSignal.timeout(3800)
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
