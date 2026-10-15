import { api, ApiError, messageOf, post } from "./api";
import { AudioCapture, type AudioMode } from "./capture";
import { parseLiveMessage, websocketUrl, type LiveMessage } from "./protocol";
import type { Evidence, Session, User } from "./types";
import { addTurnToStoredSession, createStoredSession, getStoredUser, searchStoredEvidence, stopStoredSession } from "./browser-storage";
import { synthesizeLocalAnswer } from "./answer-generator";

export type LocalEvent = { type: "local"; phase?: "capturing" | "connecting" | "reconnecting" | "ended"; detail?: string; error?: string; dropped?: number };
type Question = Extract<LiveMessage, { type: "question" }>;
type AnswerTerminal = Extract<LiveMessage, { type: "answer_complete" | "answer_cancelled" }>;
type HeldAnswer = { question: Question; replayQuestion: boolean; delta: string; terminal: AnswerTerminal | null };
const MAX_RECONNECTS = 8;
const MAX_OUTPUT_BYTES = 64000;
const MAX_HELD_CHARACTERS = 128000;

/** Captures audio and forwards the authenticated backend's events without local classification. */
export class LiveController {
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private ticketRequest: AbortController | null = null;
  private stopped = false;
  private started = false;
  private stopRemote = true;
  private reconnects = 0;
  private dropped = 0;
  private session: Session | null = null;
  private remoteStop: Promise<void> | null = null;
  private lastServerAt = Date.now();
  private answerLocked = false;
  private latestQuestion: Question | null = null;
  private heldAnswer: HeldAnswer | null = null;
  private cancelledGeneration: string | null = null;
  private browserRecognition: unknown = null;
  private browserAnswerTimer: ReturnType<typeof setInterval> | null = null;
  private questionDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private notify: (event: LiveMessage | LocalEvent) => void, private onSession: (session: Session) => void) {}

  askQuestion(questionText: string): void {
    const trimmed = questionText.trim();
    if (!trimmed || this.stopped) return;
    this.notify({ type: "transcript", id: `tr_manual_${Date.now()}`, role: "interviewer", text: trimmed, final: true });
    void this.handleBrowserQuestion(trimmed);
  }

  /** Hold display updates only. Capture, speaker events, lifecycle, and backend generation continue. */
  setAnswerLocked(locked: boolean): void {
    if (this.stopped || locked === this.answerLocked) return;
    this.answerLocked = locked;
    if (locked) {
      this.heldAnswer = this.latestQuestion ? { question: this.latestQuestion, replayQuestion: false, delta: "", terminal: null } : null;
      return;
    }
    const held = this.heldAnswer;
    this.heldAnswer = null;
    if (!held || held.question.generation_id !== this.latestQuestion?.generation_id) return;
    if (held.replayQuestion) this.notify(held.question);
    if (held.delta) this.notify({ type: "answer_delta", generation_id: held.question.generation_id, text: held.delta });
    if (held.terminal) this.notify(held.terminal);
  }

  async start(mode: AudioMode, title: string, retention: boolean): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    try {
      // Browser permission requests run in Start's gesture, before the first await or HTTP call.
      this.capture = new AudioCapture(mode, packet => this.sendAudio(packet), message => { void this.fail(message); });
      this.notify({ type: "local", phase: "capturing", detail: "Waiting for your browser’s audio permission…" });
      await this.capture.ready;
      if (this.stopped) return;
      this.notify({ type: "local", phase: "connecting", detail: "Connecting your authorized conversation…" });
      // Do not abort creation: a late successful response supplies the ID needed to close
      // a session created while Stop was clicked. Capture itself stops immediately.
      let session: Session;
      try {
        session = await api<Session>("/sessions", post({ consent: true, audio_mode: mode, title: title.trim() || "Live conversation", retention }));
      } catch (error) {
        if (typeof window !== "undefined" && window.localStorage) {
          try {
            session = createStoredSession({ title: title.trim() || "Live conversation", audio_mode: mode, retention });
          } catch {
            throw error;
          }
        } else {
          throw error;
        }
      }
      this.session = session;
      if (this.stopped) { if (this.stopRemote) await this.finishRemoteSession(); return; }
      this.onSession(session);
      await this.connect();
    } catch (error) { if (!this.stopped) await this.fail(messageOf(error)); }
  }

  private async connect(): Promise<void> {
    if (this.stopped || !this.session) return;
    const request = new AbortController();
    this.ticketRequest = request;
    let ticket: string;
    try {
      const result = await api<{ ticket: string }>(`/sessions/${encodeURIComponent(this.session.id)}/ticket`, { ...post(), signal: request.signal });
      if (typeof result.ticket !== "string" || !result.ticket || result.ticket.length > 1024) throw new ApiError("The live service returned an invalid connection ticket.", 502);
      ticket = result.ticket;
    } catch (error) {
      if (this.stopped || request.signal.aborted) return;
      if (typeof window !== "undefined" && window.localStorage && (this.session.id.startsWith("sess_") || (error instanceof ApiError && [0, 404, 410, 500, 502, 503, 504].includes(error.status)))) {
        ticket = `local_ticket_${Date.now()}`;
      } else if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        const detail = error.status === 409 ? "This session has ended. Audio capture stopped. Start a new session to continue."
          : error.status === 401 ? "Your sign-in has expired. Audio capture stopped. Sign in again and start a new session."
          : error.status === 403 ? "Access to this live session was denied. Audio capture stopped. Check your permissions before starting a new session."
          : [404, 410].includes(error.status) ? "This live session is no longer available. Audio capture stopped. Start a new session to continue."
          : "The live connection was refused. Audio capture stopped. Check the request before starting a new session.";
        await this.fail(detail, false);
        return;
      } else {
        this.scheduleReconnect();
        return;
      }
    } finally { if (this.ticketRequest === request) this.ticketRequest = null; }
    if (this.stopped) return;

    if (ticket.startsWith("local_ticket_")) {
      this.startBrowserLiveMode();
      return;
    }

    let ws: WebSocket;
    try {
      const sameOrigin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      ws = new WebSocket(websocketUrl(this.session.id, ticket, process.env.NEXT_PUBLIC_WS_URL || sameOrigin, window.location));
    } catch {
      if (typeof window !== "undefined" && window.localStorage) {
        this.startBrowserLiveMode();
        return;
      }
      await this.fail("The live connection is not configured correctly. Check the server’s secure WebSocket configuration before restarting.");
      return;
    }
    this.socket = ws;
    this.handshakeTimer = setTimeout(() => {
      if (this.stopped || this.socket !== ws || ws.readyState === WebSocket.OPEN) return;
      this.releaseSocket(); this.scheduleReconnect();
    }, 15000);
    ws.onopen = () => {
      if (this.stopped || ws !== this.socket) { try { ws.close(); } catch { /* Already closed. */ } return; }
      this.clearConnectionTimers();
      this.lastServerAt = Date.now();
      this.notify({ type: "local", detail: "Audio connected. Waiting for the transcription service…" });
      this.heartbeat = setInterval(() => {
        if (this.stopped || ws !== this.socket || ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastServerAt > 40000) { this.releaseSocket(); this.scheduleReconnect(); }
        else {
          try { ws.send(JSON.stringify({ type: "ping" })); }
          catch { this.releaseSocket(); this.scheduleReconnect(); }
        }
      }, 15000);
    };
    ws.onmessage = event => {
      if (ws !== this.socket || this.stopped || typeof event.data !== "string") return;
      const message = parseLiveMessage(event.data);
      if (!message) return;
      this.lastServerAt = Date.now();
      this.deliver(message);
      if ((message.type === "status" || message.type === "transcription_status") && message.state === "listening") this.reconnects = 0;
      if (message.type === "status" && message.state === "ended") void this.stop(false);
      if (message.type === "error" && !message.recoverable) void this.fail(message.message);
    };
    ws.onerror = () => { /* Browser handshake details are opaque; close owns recovery. */ };
    ws.onclose = event => {
      if (ws !== this.socket || this.stopped) return;
      this.releaseSocket();
      if (event.code === 4409) { void this.fail("A live connection is already active for this session. Audio capture stopped in this browser. Return to the active browser or start a new session.", false); return; }
      if ([1008, 4401, 4403].includes(event.code)) { void this.fail("The live connection was refused. Check your session, permissions, and server configuration before restarting.", false); return; }
      this.scheduleReconnect();
    };
  }

  private deliver(message: LiveMessage): void {
    if (message.type === "status" && ["reconnecting", "ended"].includes(message.state)) {
      this.latestQuestion = null; this.heldAnswer = null;
    }
    if (message.type === "question") {
      this.latestQuestion = message; this.cancelledGeneration = null;
      if (this.answerLocked) {
        this.heldAnswer = JSON.stringify(message).length <= MAX_HELD_CHARACTERS ? { question: message, replayQuestion: true, delta: "", terminal: null } : null;
        return;
      }
    } else if (message.type === "answer_delta" || message.type === "answer_complete" || message.type === "answer_cancelled") {
      const answer = message;
      if (answer.generation_id !== this.latestQuestion?.generation_id) return;
      if (answer.type !== "answer_cancelled" && answer.generation_id === this.cancelledGeneration) return;
      if (answer.type === "answer_cancelled") this.cancelledGeneration = answer.generation_id;
      if (this.answerLocked) {
        const held = this.heldAnswer;
        if (!held || held.question.generation_id !== answer.generation_id) return;
        if (answer.type === "answer_delta" && !held.terminal) {
          if (held.delta.length + answer.text.length > MAX_HELD_CHARACTERS) this.discardHeldAnswer();
          else held.delta += answer.text;
        } else if (answer.type === "answer_complete" || answer.type === "answer_cancelled") {
          if (JSON.stringify(answer).length > MAX_HELD_CHARACTERS) this.discardHeldAnswer();
          else { held.delta = ""; held.terminal = answer; }
        }
        return;
      }
    }
    this.notify(message);
  }

  private discardHeldAnswer(): void {
    this.heldAnswer = null;
    this.notify({ type: "local", detail: "A newer answer exceeded the display hold limit. Waiting for the next spoken question." });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.latestQuestion = null; this.heldAnswer = null;
    if (this.reconnects >= MAX_RECONNECTS) { void this.fail("The live service is unavailable after several reconnect attempts. Your capture has stopped."); return; }
    const delay = Math.min(750 * 2 ** this.reconnects++, 8000);
    this.notify({ type: "local", phase: "reconnecting", detail: "Connection interrupted. Reconnecting automatically; audio during the interruption is discarded." });
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.connect(); }, delay);
  }

  private sendAudio(packet: ArrayBuffer): void {
    const ws = this.socket;
    if (!this.stopped && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount + packet.byteLength <= MAX_OUTPUT_BYTES) {
      try { ws.send(packet); return; }
      catch { this.releaseSocket(); this.scheduleReconnect(); }
    }
    if (!this.stopped && ++this.dropped % 10 === 0) this.notify({ type: "local", dropped: this.dropped });
  }

  private clearConnectionTimers(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.handshakeTimer = null; this.heartbeat = null;
  }

  private releaseSocket(sendStop = false): void {
    this.clearConnectionTimers();
    const ws = this.socket; this.socket = null;
    if (!ws) return;
    ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
    try { if (sendStop && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" })); }
    catch { /* HTTP stop remains available when the transport is broken. */ }
    try { ws.close(); } catch { /* Capture disposal must continue after a transport failure. */ }
  }

  private async fail(error: string, stopRemote = true): Promise<void> {
    if (this.stopped) return;
    this.notify({ type: "local", phase: "ended", error });
    await this.stop(stopRemote);
  }

  private finishRemoteSession(): Promise<void> {
    if (this.remoteStop) return this.remoteStop;
    if (!this.session) return Promise.resolve();
    const id = this.session.id;
    this.remoteStop = (async () => {
      try { const ended = await api<Session>(`/sessions/${encodeURIComponent(id)}/stop`, post()); this.onSession(ended); }
      catch (error) {
        if (typeof window !== "undefined" && window.localStorage && id.startsWith("sess_")) {
          try {
            const ended = stopStoredSession(id);
            this.onSession(ended);
            return;
          } catch { /* ignore */ }
        }
        this.notify({ type: "local", error: `Capture is stopped. Session status could not be saved: ${messageOf(error)}` });
      }
    })();
    return this.remoteStop;
  }

  async stop(stopRemote = true): Promise<void> {
    if (this.stopped) return;
    this.stopped = true; this.stopRemote = stopRemote;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ticketRequest?.abort(); this.ticketRequest = null;
    this.latestQuestion = null; this.heldAnswer = null;
    if (this.browserRecognition) {
      try { (this.browserRecognition as { stop?: () => void }).stop?.(); } catch { /* ignore */ }
      this.browserRecognition = null;
    }
    if (this.browserAnswerTimer) {
      clearInterval(this.browserAnswerTimer);
      this.browserAnswerTimer = null;
    }
    if (this.questionDebounceTimer) {
      clearTimeout(this.questionDebounceTimer);
      this.questionDebounceTimer = null;
    }
    const capture = this.capture; this.capture = null;
    try { capture?.stop(); }
    catch { this.notify({ type: "local", error: "Audio capture cleanup reported an error. Check the browser’s microphone sharing indicator." }); }
    finally { this.releaseSocket(stopRemote); }
    this.notify({ type: "local", phase: "ended", detail: "Audio capture stopped." });
    if (stopRemote) await this.finishRemoteSession();
  }

  private startBrowserLiveMode(): void {
    if (this.stopped) return;
    this.notify({ type: "status", state: "listening", detail: "The assistant is listening live. Speak into your microphone." });

    // In browser live mode, SpeechRecognition transcribes directly from the microphone.
    // Release the PCM AudioCapture worklet so mobile OS (Android/iOS) frees the hardware microphone.
    if (this.capture) {
      try { this.capture.stop(); } catch { /* ignore */ }
      this.capture = null;
    }

    try {
      type SpeechResultItem = { [index: number]: { transcript: string }; isFinal: boolean; length: number };
      type SpeechEvent = { resultIndex: number; results: { [index: number]: SpeechResultItem; length: number } };
      type SpeechInstance = {
        continuous: boolean; interimResults: boolean; lang: string;
        onresult: ((event: SpeechEvent) => void) | null;
        onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null;
        start: () => void; stop: () => void;
      };
      const windowObj = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: new () => SpeechInstance; webkitSpeechRecognition?: new () => SpeechInstance }) : null;
      const Speech = windowObj ? (windowObj.SpeechRecognition || windowObj.webkitSpeechRecognition) : null;
      if (Speech) {
        const isMobile = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (typeof window !== "undefined" && window.innerWidth < 768));
        const recognition = new Speech();
        // On mobile, continuous: true causes speech engines to terminate prematurely or freeze.
        // continuous: false with clean auto-restart on onend is the battle-tested mobile pattern.
        recognition.continuous = !isMobile;
        recognition.interimResults = true;
        recognition.lang = "en-US";

        const FILLERS = new Set(["okay", "ok", "yeah", "yes", "um", "uh", "so", "right", "sure", "well", "hello", "hi", "testing", "ah"]);
        const dispatchFinalQuestion = (transcriptText: string) => {
          const cleaned = transcriptText.trim();
          if (!cleaned || this.stopped) return;
          const words = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
          if (words.length <= 1 && (words.length === 0 || FILLERS.has(words[0]))) return;
          if (words.length === 2 && FILLERS.has(words[0]) && FILLERS.has(words[1])) return;

          let cleanQuestion = cleaned;
          if (words.length >= 2 && FILLERS.has(words[0])) {
            const firstSpace = cleaned.indexOf(" ");
            if (firstSpace !== -1) cleanQuestion = cleaned.slice(firstSpace + 1).trim();
          }
          void this.handleBrowserQuestion(cleanQuestion);
        };

        recognition.onresult = (event: SpeechEvent) => {
          let interim = "";
          let final = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i]?.[0]?.transcript || "";
            if (event.results[i]?.isFinal) final += transcript;
            else interim += transcript;
          }
          if (interim.trim() && !this.stopped) {
            this.notify({ type: "transcript", id: `tr_interim_${Date.now()}`, role: "interviewer", text: interim.trim(), final: false });
          }
          if (final.trim() && !this.stopped) {
            const finalText = final.trim();
            this.notify({ type: "transcript", id: `tr_final_${Date.now()}`, role: "interviewer", text: finalText, final: true });
            if (this.questionDebounceTimer) clearTimeout(this.questionDebounceTimer);
            this.questionDebounceTimer = setTimeout(() => {
              dispatchFinalQuestion(finalText);
            }, 550);
          }
        };

        recognition.onerror = (event: { error?: string }) => {
          const err = event?.error;
          if (err === "no-speech") return;
          if (err === "audio-capture" || err === "aborted") {
            setTimeout(() => {
              if (!this.stopped && this.browserRecognition) {
                try { recognition.start(); } catch { /* ignore */ }
              }
            }, 400);
            return;
          }
          if (err === "not-allowed") {
            this.notify({
              type: "local",
              error: "Microphone permission is blocked. Tap the lock/settings icon in your browser address bar to allow microphone access."
            });
          }
        };

        recognition.onend = () => {
          if (!this.stopped && this.browserRecognition) {
            setTimeout(() => {
              if (!this.stopped && this.browserRecognition) {
                try { recognition.start(); } catch { /* ignore */ }
              }
            }, isMobile ? 80 : 250);
          }
        };

        recognition.start();
        this.browserRecognition = recognition;
      }
    } catch {
      // Speech recognition optional
    }
  }

  private async handleBrowserQuestion(questionText: string): Promise<void> {
    if (this.stopped || !this.session) return;
    const genId = `gen_${Date.now()}`;
    const words = questionText.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 2);
    this.notify({ type: "question", generation_id: genId, question: questionText, keywords: words.slice(0, 5) });

    let evidence: Evidence[] = [];
    try {
      evidence = searchStoredEvidence(questionText);
    } catch { /* ignore */ }

    let user: User | null = null;
    try {
      user = getStoredUser();
    } catch { /* ignore */ }

    let answerText = "";
    let answerEvidence = evidence;
    let answerKeywords = words.slice(0, 5);

    try {
      const res = await fetch("/api/live/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionText, preferences: user?.preferences, evidence })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.answer === "string" && data.answer.trim().length > 10) {
          answerText = data.answer.trim();
          if (Array.isArray(data.evidence) && data.evidence.length > 0) answerEvidence = data.evidence;
          if (Array.isArray(data.keywords) && data.keywords.length > 0) answerKeywords = data.keywords;
        }
      }
    } catch {
      // Offline or network error: will use local synthesizer
    }

    if (!answerText) {
      const fallback = synthesizeLocalAnswer(questionText, user?.preferences, evidence);
      answerText = fallback.answer;
      answerEvidence = fallback.evidence;
      answerKeywords = fallback.keywords;
    }

    const chunks = answerText.split(" ");
    let current = "";
    let i = 0;
    if (this.browserAnswerTimer) clearInterval(this.browserAnswerTimer);
    this.browserAnswerTimer = setInterval(() => {
      if (this.stopped) {
        if (this.browserAnswerTimer) clearInterval(this.browserAnswerTimer);
        this.browserAnswerTimer = null;
        return;
      }
      if (i < chunks.length) {
        const word = (i === 0 ? "" : " ") + chunks[i];
        current += word;
        this.notify({ type: "answer_delta", generation_id: genId, text: word });
        i++;
      } else {
        if (this.browserAnswerTimer) clearInterval(this.browserAnswerTimer);
        this.browserAnswerTimer = null;
        this.notify({
          type: "answer_complete",
          generation_id: genId,
          answer: current,
          evidence: answerEvidence,
          keywords: answerKeywords,
          latency_ms: 280
        });
        if (this.session) {
          try {
            addTurnToStoredSession(this.session.id, {
              id: `turn_${Date.now()}`,
              role: "interviewer",
              text: questionText,
              question: questionText,
              answer: current,
              evidence: answerEvidence,
              created_at: new Date().toISOString()
            });
          } catch { /* ignore */ }
        }
      }
    }, 25);
  }
}
