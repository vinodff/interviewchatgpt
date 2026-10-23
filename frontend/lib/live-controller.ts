import { api, ApiError, messageOf, post, streamApi } from "./api";
import { AudioCapture, type AudioMode } from "./capture";
import { parseLiveMessage, websocketUrl, type LiveMessage } from "./protocol";
import type { Evidence, Preferences, Session, User } from "./types";
import { addTurnToStoredSession, createStoredSession, getStoredUser, getStoredSources, searchStoredEvidence, stopStoredSession } from "./browser-storage";
import { isBrowserWorkspace } from "./workspace-mode";
import { embeddedRequest, trailingTopicRequest, speechRequestFocus } from "./speech-request";
import { InterviewMemory } from "./interview-memory";
import { isContextFollowUp, isIncompleteSpeech, speechTiming } from "./speech-timing";
import { EnhancedRecognition, type MicrophoneLevel } from "./enhanced-recognition";
import { StreamingRecognition } from "./streaming-recognition";
import { audioTaskKey, type AudioAnswerContext, type PreparedAudioReply } from "./audio-answer";
import { questionMentionsTopic } from "./question-options";

export type LocalEvent = { type: "local"; phase?: "capturing" | "connecting" | "reconnecting" | "ended"; detail?: string; error?: string; dropped?: number; level?: MicrophoneLevel };
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
  private currentAnswerText = "";
  private answeringQuestion = false;
  private currentPreferences: Preferences | null = null;
  private answerRequests = new Map<number, AbortController>();
  private latestAnsweredSequence = 0;
  private queuedSpeech: Array<{ text: string; transcriptId?: string; transcriptFinal: boolean }> = [];
  private generationSequence = 0;
  private recognitionRestart: ReturnType<typeof setTimeout> | null = null;
  private browserMode = false;
  private interviewMemory = new InterviewMemory();
  private enhancedMicrophone = false;
  private streamingMicrophone = false;
  private pendingAudioSpeech = "";
  private audioReplies = new Map<string, { text: string; prepared: PreparedAudioReply }>();
  private removeVisibilityListener: (() => void) | null = null;
  private resetPendingBrowserSpeech: (() => void) | null = null;
  private manualSpeechCutoff = 0;

  constructor(private notify: (event: LiveMessage | LocalEvent) => void, private onSession: (session: Session) => void) {}

  public setPreferences(preferences?: Preferences): void {
    this.currentPreferences = preferences || null;
  }

  private audioAnswerContext(): AudioAnswerContext | null {
    try {
      const preferences = this.currentPreferences || getStoredUser().preferences || {};
      // Evidence retrieval needs the recognized question. Keep that path when
      // uploaded knowledge is in use, rather than guessing which source applies.
      if (preferences.personalization !== "technical" && getStoredSources().some(source => source.status === "ready")) return null;
      return { preferences, interview_context: this.interviewMemory.context(), prefix: this.pendingAudioSpeech };
    } catch { return null; }
  }

  askQuestion(questionText: string): void {
    const trimmed = questionText.trim();
    if (!trimmed || this.stopped || !this.started || !this.browserMode) return;
    this.manualSpeechCutoff = Date.now();
    this.resetPendingBrowserSpeech?.();
    this.cancelPendingBrowserAnswer();
    this.latestAnsweredSequence = this.generationSequence + 1;
    for (const request of this.answerRequests.values()) request.abort();
    this.answerRequests.clear(); this.queuedSpeech = [];
    this.notify({ type: "transcript", id: `tr_manual_${Date.now()}`, role: "interviewer", text: trimmed, final: true });
    void this.handleBrowserQuestion(trimmed);
  }

  /**
   * Validates that speech is strictly English.
   * Rejects non-Latin characters and foreign language scripts (Cyrillic, Arabic, Chinese, Devanagari, Telugu, Tamil, Japanese, Korean, Thai, etc.)
   */
  public isEnglishSpeech(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    // Reject non-Latin characters / foreign scripts
    if (/[^\u0000-\u024F\u2000-\u206F\u2E00-\u2E7F]/u.test(trimmed)) {
      return false;
    }
    // Must contain Latin letters
    return /[a-zA-Z]/.test(trimmed);
  }

  /**
   * Distinguishes between Candidate Speech (answering/narrating) and Interviewer Questions.
   * If the candidate is speaking their answer, we do NOT trigger a new question generation.
   */
  private classifySpeech(text: string): "candidate" | "question" | "filler" {
    const cleaned = text.trim();
    if (!cleaned || !this.isEnglishSpeech(cleaned)) return "filler";
    const lower = cleaned.toLowerCase().replace(/[^a-z0-9 ?]/g, " ");
    const words = lower.split(/\s+/).filter(Boolean);

    const FILLERS = new Set(["okay", "ok", "yeah", "yes", "um", "uh", "so", "right", "sure", "well", "hello", "hi", "testing", "ah"]);
    if (words.length <= 1 && (words.length === 0 || FILLERS.has(words[0]))) return "filler";
    if (words.length === 2 && FILLERS.has(words[0]) && FILLERS.has(words[1])) return "filler";

    // First-person narrative markers indicating the candidate is answering
    const candidateMarkers = /\b(i|i'm|i've|i'd|i'll|my|myself|we|we've|we'd|our|ours)\b/i;
    const candidateStarters = /^(yes|yeah|sure|so basically|basically|definitely|absolutely|in my experience|what i did|i worked on|i built|i designed|let me explain|as you know|in this case)\b/i;

    // Interviewer question markers directed at candidate
    const strongQuestionStarters = /^(what|why|how|who|where|when|can you|could you|would you|tell me|explain|describe|walk me through|have you|is there|are there|what's the difference|which)\b/i;
    const hasQuestionMark = text.includes("?");

    // Questions always survive echo filtering. Reading an answer requires an
    // exact consecutive phrase, rather than incidental vocabulary overlap.
    if (!strongQuestionStarters.test(cleaned) && !hasQuestionMark && this.currentAnswerText) {
      const answer = this.currentAnswerText.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
      for (let i = 0; i <= words.length - 5; i++) {
        if (` ${answer} `.includes(` ${words.slice(i, i + 5).join(" ")} `)) return "candidate";
      }
      if (candidateStarters.test(cleaned)) return "candidate";
    }

    if (strongQuestionStarters.test(cleaned) || hasQuestionMark || /\b(can you explain|could you tell|tell me about|how would you)\b/i.test(cleaned)) {
      return "question";
    }

    if (candidateMarkers.test(cleaned) && !strongQuestionStarters.test(cleaned)) {
      return "candidate";
    }

    // Every word matters in an interview: a 1-2 word substantive utterance
    // ("algorithm?", "recursion?") is a real question, not filler.
    // Only pure filler vocabulary is dropped here.
    const substantive = words.some(w => w.length > 3 && !FILLERS.has(w));
    if (words.length >= 3) return "question";
    if (substantive) return "question";
    return "filler";
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

  async start(mode: AudioMode, title: string, retention: boolean, options: { enhancedMicrophone?: boolean; streamingMicrophone?: boolean } = {}): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    try {
      if (isBrowserWorkspace()) {
        if (mode !== "microphone") throw new Error("This workspace supports microphone speech only. Shared-tab transcription requires the full backend.");
        this.browserMode = true;
        this.enhancedMicrophone = options.enhancedMicrophone === true;
        this.streamingMicrophone = options.streamingMicrophone === true;
        this.session = createStoredSession({ title, audio_mode: mode, retention });
        this.onSession(this.session);
        this.startBrowserLiveMode();
        return;
      }
      // Browser permission requests run in Start's gesture, before the first await or HTTP call.
      this.capture = new AudioCapture(mode, packet => this.sendAudio(packet), message => { void this.fail(message); });
      this.notify({ type: "local", phase: "capturing", detail: "Waiting for your browser’s audio permission…" });
      await this.capture.ready;
      if (this.stopped) return;
      this.notify({ type: "local", phase: "connecting", detail: "Connecting your authorized conversation…" });
      // Do not abort creation: a late successful response supplies the ID needed to close
      // a session created while Stop was clicked. Capture itself stops immediately.
      const session = await api<Session>("/sessions", post({ consent: true, audio_mode: mode, title: title.trim() || "Live conversation", retention }));
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
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
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

    let ws: WebSocket;
    try {
      const sameOrigin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      ws = new WebSocket(websocketUrl(this.session.id, ticket, process.env.NEXT_PUBLIC_WS_URL || sameOrigin, window.location));
    } catch {
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

  private cancelPendingBrowserAnswer(): void {
    for (const sequence of this.answerRequests.keys()) {
      const id = `gen_${sequence}`;
      if (this.latestQuestion?.generation_id === id && this.cancelledGeneration !== id) this.deliver({ type: "answer_cancelled", generation_id: id });
    }
  }

  private async fail(error: string, stopRemote = true): Promise<void> {
    if (this.stopped) return;
    this.cancelPendingBrowserAnswer();
    this.notify({ type: "local", phase: "ended", error });
    await this.stop(stopRemote);
  }

  private finishRemoteSession(): Promise<void> {
    if (this.remoteStop) return this.remoteStop;
    if (!this.session) return Promise.resolve();
    const id = this.session.id;
    this.remoteStop = (async () => {
      try {
        const ended = this.browserMode ? stopStoredSession(id) : await api<Session>(`/sessions/${encodeURIComponent(id)}/stop`, post());
        this.onSession(ended);
      } catch (error) {
        this.notify({ type: "local", error: `Capture is stopped. Session status could not be saved: ${messageOf(error)}` });
      }
    })();
    return this.remoteStop;
  }

  async stop(stopRemote = true): Promise<void> {
    if (this.stopped) return;
    this.cancelPendingBrowserAnswer();
    this.stopped = true; this.stopRemote = stopRemote;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ticketRequest?.abort(); this.ticketRequest = null;
    this.latestQuestion = null; this.heldAnswer = null;
    for (const request of this.answerRequests.values()) request.abort();
    this.answerRequests.clear(); this.queuedSpeech = []; this.interviewMemory.reset();
    this.audioReplies.clear(); this.pendingAudioSpeech = "";
    if (this.recognitionRestart) clearTimeout(this.recognitionRestart);
    this.recognitionRestart = null;
    this.removeVisibilityListener?.(); this.removeVisibilityListener = null;
    this.resetPendingBrowserSpeech = null;
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
    this.currentAnswerText = "";
    this.answeringQuestion = false;
    const capture = this.capture; this.capture = null;
    try { capture?.stop(); }
    catch { this.notify({ type: "local", error: "Audio capture cleanup reported an error. Check the browser’s microphone sharing indicator." }); }
    finally { this.releaseSocket(stopRemote); }
    this.notify({ type: "local", phase: "ended", detail: "Audio capture stopped." });
    if (stopRemote) await this.finishRemoteSession();
  }

  private startBrowserLiveMode(): void {
    if (this.stopped) return;


    // In browser live mode, SpeechRecognition transcribes directly from the microphone.
    // Release the PCM AudioCapture worklet so mobile OS (Android/iOS) frees the hardware microphone.
    if (this.capture) {
      try { this.capture.stop(); } catch { /* ignore */ }
      this.capture = null;
    }

    try {
      type SpeechResultItem = { [index: number]: { transcript: string }; isFinal: boolean; length: number };
      type SpeechEvent = { resultIndex: number; results: { [index: number]: SpeechResultItem; length: number }; audio_start_ms?: number; audio_end_ms?: number; prepared?: PreparedAudioReply };
      type SpeechInstance = {
        continuous: boolean; interimResults: boolean; lang: string;
        onresult: ((event: SpeechEvent) => void) | null;
        onerror: ((event: { error?: string; detail?: string }) => void) | null; onend: (() => void) | null;
        start: () => void; stop: () => void;
        ready?: Promise<void>;
      };
      const windowObj = typeof window !== "undefined" ? (window as unknown as { SpeechRecognition?: new () => SpeechInstance; webkitSpeechRecognition?: new () => SpeechInstance }) : null;
      const enhanced = this.enhancedMicrophone || this.streamingMicrophone;
      const streaming = this.streamingMicrophone;
      const microphoneStatus = streaming ? "Streaming microphone active. Quiet input is amplified; speech is recognized continuously." : "Enhanced microphone active. Quiet audio is boosted before transcription.";
      const onMicrophoneLevel = (level: MicrophoneLevel) => { if (!this.stopped) this.notify({ type: "local", level }); };
      const getAudioContext = () => this.audioAnswerContext();
      const onSpeechStatus = (detail: string) => { if (!this.stopped) this.notify({ type: "status", state: "listening", detail }); };
      const Speech = streaming ? class extends StreamingRecognition {
        constructor() { super(onMicrophoneLevel, onSpeechStatus); }
      } : enhanced ? class extends EnhancedRecognition {
        constructor() { super(onMicrophoneLevel, getAudioContext); }
      } : windowObj ? (windowObj.SpeechRecognition || windowObj.webkitSpeechRecognition) : null;
      if (Speech) {
        const recognition = new Speech();
        // Request continuous recognition where implemented. Android Chrome can
        // ignore it; Enhanced mode owns continuous capture independently.
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        try { (recognition as unknown as { maxAlternatives?: number }).maxAlternatives = 1; } catch { /* optional */ }

        // Utterance buffering: the Web Speech API fragments one spoken
        // sentence into several final chunks ("what is" + "algorithm").
        // Dispatching each chunk immediately both splits the question and
        // drops the tail (a lone "algorithm" looks like filler). Instead we
        // accumulate accumulated_final_chunks + current_interim_chunk per the
        // speech-pipeline invariant and finalize only after a real silence
        // pause, so every word is included. Interim replaces (stable id),
        // never concatenates.
        let utteranceId = `tr_live_${++this.generationSequence}`;
        let consumedResults = 0;
        let finalResultCount = 0;
        let restartAttempts = 0;
        const DEDUP_WINDOW_MS = 4000;
        let windowFinal = "";
        let windowInterim = "";
        let carry = "";
        let carryExpiresAt = 0;
        let lastAudioEnd = 0;
        let lastDispatchedText = "";
        let lastDispatchedAt = 0;
        let lastDispatchedRole: string | null = null;
        let interimRequestKey: string | null = null;
        let recognitionCorrections = 0;
        let previousInterim = "";
        let lastResultsLength = 0;

        const currentPhrase = (): string =>
          `${carry ? `${carry} ` : ""}${windowFinal ? `${windowFinal} ` : ""}${windowInterim}`.replace(/\s+/g, " ").trim();

        const dispatchProcessedSpeech = (transcriptText: string) => {
          const cleaned = transcriptText.trim().replace(/\s+/g, " ");
          if (!cleaned || this.stopped || !this.isEnglishSpeech(cleaned)) return;

          // Self-echo / duplicate protection: only exact (or near-exact)
          // consecutive repeats within 4s are dropped, per invariant.
          const now = Date.now();
          const norm = cleaned.toLowerCase();
          const lastNorm = lastDispatchedText.toLowerCase();
          if (lastNorm && now - lastDispatchedAt < DEDUP_WINDOW_MS && (norm === lastNorm || (lastNorm.startsWith(norm) && norm.length >= lastNorm.length - 2) || (norm.startsWith(lastNorm) && norm.length <= lastNorm.length + 2))) return;

          const classification = this.classifySpeech(cleaned);
          if (classification === "filler" && !trailingTopicRequest(cleaned) && !(this.interviewMemory.hasContext && isContextFollowUp(cleaned))) {
            this.notify({ type: "transcript", id: utteranceId, role: "unknown", text: cleaned, final: true });
            return;
          }

          lastDispatchedText = cleaned;
          lastDispatchedAt = now;

          // The contextual model decides whether this speech needs an answer.
          lastDispatchedRole = classification === "candidate" ? "user" : "interviewer";
          let cleanQuestion = cleaned;
          const words = cleaned.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
          const FILLERS = new Set(["okay", "ok", "yeah", "yes", "um", "uh", "so", "right", "sure", "well", "hello", "hi", "testing", "ah"]);
          if (!enhanced && words.length >= 2 && FILLERS.has(words[0])) {
            const firstSpace = cleaned.indexOf(" ");
            if (firstSpace !== -1) cleanQuestion = cleaned.slice(firstSpace + 1).trim();
          }

          this.notify({
            type: "transcript",
            id: utteranceId,
            role: "unknown",
            text: cleaned,
            final: true
          });
          void this.handleBrowserQuestion(cleanQuestion, utteranceId);
        };

        const flushUtterance = () => {
          if (this.questionDebounceTimer) clearTimeout(this.questionDebounceTimer);
          this.questionDebounceTimer = null;
          const phrase = currentPhrase();
          if (enhanced && carry && !windowFinal && !windowInterim) return;
          const followUp = this.interviewMemory.hasContext && isContextFollowUp(phrase);
          const requestKey = (trailingTopicRequest(phrase) || embeddedRequest(phrase, true) || (followUp ? phrase : "")).toLowerCase().replace(/[^a-z0-9 +#]/g, "").trim() || null;
          if (windowInterim) {
            // Mobile engines can leave a complete question interim for a long time.
            // A stable embedded request must not wait for the entire speaker turn.
            if (!requestKey || !speechTiming({ text: phrase, final: false, hasContext: this.interviewMemory.hasContext }).allow_interim || requestKey === interimRequestKey || (interimRequestKey && requestKey.startsWith(`${interimRequestKey} `))) return;
            interimRequestKey = requestKey;
            void this.handleBrowserQuestion(phrase, utteranceId, false);
            return;
          }
          const submittedInterim = requestKey !== null && requestKey === interimRequestKey;
          interimRequestKey = null; recognitionCorrections = 0; previousInterim = "";
          if (phrase) this.interviewMemory.recordSpeech({ id: utteranceId, role: "unknown", text: phrase, final: true });
          consumedResults = finalResultCount;
          windowFinal = "";
          windowInterim = "";
          carry = "";
          this.pendingAudioSpeech = "";
          if (!phrase) return;
          if (submittedInterim) {
            this.notify({ type: "transcript", id: utteranceId, role: "unknown", text: phrase, final: true });
            utteranceId = `tr_live_${++this.generationSequence}`;
            return;
          }
          // Cross-pause stitching (speaker-isolation invariant): never stitch
          // onto candidate speech. If the previously dispatched interviewer
          // turn ended on an explicit incomplete connector ("tell me about",
          // "what is") and the new fragment arrives promptly, combine them so
          // the tail word is not lost as a separate orphan utterance.
          if (
            lastDispatchedRole === "interviewer" &&
            lastDispatchedText &&
            Date.now() - lastDispatchedAt < DEDUP_WINDOW_MS &&
            isIncompleteSpeech(lastDispatchedText)
          ) {
            const combined = `${lastDispatchedText} ${phrase}`.replace(/\s+/g, " ").trim();
            // Bypass the near-duplicate guard for this intentional combine:
            // dispatch the lengthened question as the corrected turn.
            lastDispatchedText = "";
            dispatchProcessedSpeech(combined);
            utteranceId = `tr_live_${++this.generationSequence}`;
            return;
          }
          dispatchProcessedSpeech(phrase);
          utteranceId = `tr_live_${++this.generationSequence}`;
        };

        this.resetPendingBrowserSpeech = () => {
          if (this.questionDebounceTimer) clearTimeout(this.questionDebounceTimer);
          this.questionDebounceTimer = null;
          // A manually selected question supersedes this already-heard window,
          // including its later final update, while capture keeps running.
          consumedResults = Math.max(finalResultCount, lastResultsLength);
          finalResultCount = consumedResults;
          windowFinal = ""; windowInterim = ""; carry = ""; carryExpiresAt = 0;
          interimRequestKey = null; previousInterim = ""; recognitionCorrections = 0;
          this.pendingAudioSpeech = ""; this.audioReplies.delete(utteranceId);
          utteranceId = `tr_live_${++this.generationSequence}`;
        };

        const armSilenceTimer = (phrase: string) => {
          if (this.questionDebounceTimer) clearTimeout(this.questionDebounceTimer);
          // Incomplete prefix ("what is") gets a longer hold so the tail
          // word ("algorithm") lands in the SAME utterance instead of
          // firing early as a truncated question.
          const plan = speechTiming({ text: phrase, final: !windowInterim, hasContext: this.interviewMemory.hasContext, corrections: recognitionCorrections });
          this.questionDebounceTimer = setTimeout(flushUtterance, plan.delay_ms);
        };

        recognition.onresult = (event: SpeechEvent) => {
          if (this.stopped) return;
          if (!streaming && event.audio_end_ms !== undefined && event.audio_end_ms <= this.manualSpeechCutoff) return;
          lastResultsLength = event.results.length;
          let expiredCarry = false;
          // Enhanced requests may queue or retry: compare actual capture times,
          // not model response times, when deciding whether a pause was too long.
          if (enhanced && carry && carryExpiresAt && event.audio_start_ms !== undefined && event.audio_start_ms > carryExpiresAt) {
            this.notify({ type: "transcript", id: utteranceId, role: "unknown", text: carry, final: true });
            this.interviewMemory.recordSpeech({ id: utteranceId, role: "unknown", text: carry, final: true });
            carry = ""; carryExpiresAt = 0; utteranceId = `tr_live_${++this.generationSequence}`;
            expiredCarry = true;
          }
          if (event.audio_end_ms !== undefined) lastAudioEnd = event.audio_end_ms;
          // Per invariant: current phrase = accumulated_final_chunks (ALL
          // finals in this recognition window, not just from resultIndex)
          // + current_interim_chunk. Interim replaces, never concatenates.
          let finals = "";
          let interimChunk = "";
          restartAttempts = 0;
          finalResultCount = consumedResults;
          for (let i = consumedResults; i < event.results.length; ++i) {
            const transcript = event.results[i]?.[0]?.transcript || "";
            if (!transcript) continue;
            if (event.results[i]?.isFinal) { finals += `${transcript} `; finalResultCount = i + 1; }
            else interimChunk += `${transcript} `;
          }
          windowFinal = finals.replace(/\s+/g, " ").trim();
          windowInterim = interimChunk.replace(/\s+/g, " ").trim();
          if (previousInterim && windowInterim && !windowInterim.toLowerCase().startsWith(previousInterim.toLowerCase())) recognitionCorrections++;
          previousInterim = windowInterim;
          const phrase = currentPhrase();
          if (enhanced) {
            this.pendingAudioSpeech = phrase;
            if (event.prepared && !expiredCarry) this.audioReplies.set(utteranceId, { text: phrase, prepared: event.prepared });
            while (this.audioReplies.size > 8) this.audioReplies.delete(this.audioReplies.keys().next().value!);
          }
          if (!phrase) return;
          // Live interim preview with a STABLE id so the UI replaces the
          // previous preview in place (same pattern as the backend's
          // transcript_id reuse). Predictable, no transcript-list flooding.
          if (this.isEnglishSpeech(phrase)) {
            this.interviewMemory.recordSpeech({ id: utteranceId, role: "unknown", text: phrase, final: false });
            this.notify({
              type: "transcript",
              id: utteranceId,
              role: "unknown",
              text: phrase,
              final: false
            });
          }
          // Every onresult restarts the silence clock: the utterance only
          // finalizes after the speaker actually pauses, so tail words are
          // never cut off.
          const finalizedRequestKey = !windowInterim && (trailingTopicRequest(phrase) || embeddedRequest(phrase, true) || (this.interviewMemory.hasContext && isContextFollowUp(phrase) ? phrase : "")).toLowerCase().replace(/[^a-z0-9 +#]/g, "").trim();
          if (finalizedRequestKey && finalizedRequestKey === interimRequestKey) {
            // This exact request already started from a stable interim. Commit
            // its final now so the next keyword cannot merge into its window.
            flushUtterance();
          } else armSilenceTimer(phrase);
        };

        recognition.onerror = (event: { error?: string; detail?: string }) => {
          if (event.detail) { void this.fail(event.detail); return; }
          const err = event.error;
          if (err === "no-speech" || err === "aborted") return;
          if (err === "network") {
            this.notify({ type: "local", phase: "reconnecting", error: "Speech recognition lost its network connection. Retrying…" });
            return;
          }
          void this.fail(err === "not-allowed" || err === "service-not-allowed"
            ? "Microphone or speech permission is blocked. Allow access in your browser settings, then start again."
            : "Speech recognition is unavailable. Check your microphone and browser speech support, then start again.");
        };

        recognition.onend = () => {
          if (this.stopped || !this.browserRecognition) return;
          // Some engines end without marking the final hypothesis as isFinal.
          windowFinal = `${windowFinal} ${windowInterim}`.trim(); windowInterim = "";
          // Mobile OS stops recognition at pauses/auto-limits: flush what
          // was heard (carries "algorithm" with it) BEFORE restarting, then
          // restart fast so the next words are captured. Pending audio is
          // preserved in `carry` when the flush was an incomplete prefix.
          const pending = currentPhrase();
          if (pending) {
            // Give the engine a beat to deliver a trailing final chunk
            // before we finalize, then restart listening.
            const contextualPrefix = this.interviewMemory.hasContext && /^(?:(?:okay|ok|and|so|now|instead)[, ]+)*(?:in|do the)\s*[,.?]?$/i.test(pending.trim());
            if (isIncompleteSpeech(pending) && (!enhanced || embeddedRequest(pending) || this.interviewMemory.hasContext && isContextFollowUp(pending) || contextualPrefix)) {
              carry = carry ? `${carry} ${windowFinal} ${windowInterim}`.replace(/\s+/g, " ").trim() : `${windowFinal} ${windowInterim}`.replace(/\s+/g, " ").trim();
              windowFinal = "";
              windowInterim = "";
              if (enhanced) {
                carryExpiresAt = lastAudioEnd + 10000;
                if (this.questionDebounceTimer) clearTimeout(this.questionDebounceTimer);
                this.questionDebounceTimer = null;
              } else armSilenceTimer(carry);
            } else {
              flushUtterance();
            }
          }
          consumedResults = 0; finalResultCount = 0; lastResultsLength = 0;
          if (enhanced) {
            // This is a transcript boundary only; PCM capture never stopped.
            this.notify({ type: "status", state: "listening", detail: microphoneStatus });
            return;
          }
          if (++restartAttempts > 5) { void this.fail("Speech recognition could not restart. Check your connection and start a new session."); return; }
          this.recognitionRestart = setTimeout(() => {
            this.recognitionRestart = null;
            if (!this.stopped && this.browserRecognition) {
              try {
                recognition.start();
                this.notify({ type: "status", state: "listening", detail: enhanced ? microphoneStatus : "Listening through browser speech recognition." });
              } catch { void this.fail("Speech recognition could not restart. Start a new session to continue."); }
            }
          }, Math.min(250 * 2 ** (restartAttempts - 1), 4000));
        };

        this.browserRecognition = recognition;
        recognition.start();
        if (this.stopped) return;
        if (enhanced && recognition.ready) {
          this.notify({ type: "local", phase: "capturing", detail: "Waiting for microphone permission…" });
          void recognition.ready.then(() => { if (!this.stopped) this.notify({ type: "status", state: "listening", detail: `${microphoneStatus} Keep this page visible.` }); }).catch(() => undefined);
        } else this.notify({ type: "status", state: "listening", detail: "Listening through browser speech recognition. Keep this page visible." });
        if (typeof document !== "undefined") {
          const visibility = () => { if (document.hidden) void this.fail("Your browser moved this page to the background. Capture stopped; return here and start again."); };
          document.addEventListener("visibilitychange", visibility);
          this.removeVisibilityListener = () => document.removeEventListener("visibilitychange", visibility);
        }
      } else {
        void this.fail("This browser does not support speech recognition. Use Safari on iPhone or Chrome/Edge, with microphone and speech permissions enabled.");
      }
    } catch (error) {
      void this.fail(`Speech recognition could not start: ${messageOf(error)}`);
    }
  }

  private async handleBrowserQuestion(questionText: string, transcriptId?: string, transcriptFinal = true): Promise<void> {
    if (this.stopped || !this.session) return;
    if (this.answerRequests.size >= 3) {
      if (this.queuedSpeech.length >= 8) {
        this.notify({ type: "local", error: "Speech is arriving faster than the AI service can process it. Pause briefly, then repeat the latest question." });
        return;
      }
      this.queuedSpeech.push({ text: questionText, transcriptId, transcriptFinal });
      return;
    }
    const request = new AbortController();
    const requestSequence = ++this.generationSequence;
    this.answerRequests.set(requestSequence, request);
    const genId = `gen_${requestSequence}`;
    const cachedAudio = transcriptId ? this.audioReplies.get(transcriptId) : undefined;
    if (transcriptId) this.audioReplies.delete(transcriptId);
    const liveContext = cachedAudio ? this.audioAnswerContext() : null;
    const trailingTopic = trailingTopicRequest(questionText);
    const wrongAudioTopic = cachedAudio?.prepared.reply.requests_answer && trailingTopic && !questionMentionsTopic(cachedAudio.prepared.reply.question, trailingTopic);
    const requestNeedsTextCheck = cachedAudio && !cachedAudio.prepared.reply.requests_answer && !isIncompleteSpeech(questionText)
      && (trailingTopicRequest(questionText) || embeddedRequest(questionText) || this.interviewMemory.hasContext && isContextFollowUp(questionText));
    const prepared = cachedAudio?.text === questionText && liveContext && cachedAudio.prepared.preferences_key === JSON.stringify(liveContext.preferences) && cachedAudio.prepared.task_key === audioTaskKey(liveContext.interview_context)
      && !requestNeedsTextCheck && !wrongAudioTopic ? cachedAudio.prepared : undefined;
    const startedAt = prepared?.started_at || Date.now();
    const focusText = speechRequestFocus(questionText).slice(-4000);
    const words = focusText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    this.notify({ type: "local", detail: "Understanding the latest speech and conversation context…", error: "" });
    const speechId = transcriptId || genId;
    this.interviewMemory.recordSpeech({ id: speechId, role: "unknown", text: questionText, final: transcriptFinal });
    this.answeringQuestion = true;
    let evidence: Evidence[] = [];
    let user: User | null = null;
    try { evidence = searchStoredEvidence(focusText); user = getStoredUser(); }
    catch (error) { this.notify({ type: "local", error: messageOf(error) }); }
    const preferences = this.currentPreferences || user?.preferences;
    const timeout = setTimeout(() => request.abort(), 25000);
    try {
      type Reply = { requests_answer: boolean; speaker_role: "user" | "interviewer" | "unknown"; question: string; answer: string; evidence: Evidence[]; keywords: string[] };
      let completed: Reply | null = null;
      let previewStarted = false;
      let previewText = "";
      let firstTokenMs: number | null = null;
      const claimQuestion = (question: string) => {
        if (requestSequence < this.latestAnsweredSequence) return false;
        this.latestAnsweredSequence = requestSequence;
        for (const [sequence, pending] of this.answerRequests) if (sequence < requestSequence) pending.abort();
        if (!previewStarted) {
          previewStarted = true;
          firstTokenMs = Date.now() - startedAt;
          this.deliver({ type: "question", generation_id: genId, question, keywords: words.slice(0, 5) });
          this.notify({ type: "metrics", questions: this.interviewMemory.context().answered_count + 1, reconnects: 0, audio_dropped: 0, first_token_ms: firstTokenMs });
        }
        return true;
      };
      const acceptEvent = (event: Record<string, unknown>) => {
        if (this.stopped || request.signal.aborted || requestSequence < this.latestAnsweredSequence) return;
        if (event.type === "error") throw new Error(typeof event.detail === "string" ? event.detail : "The answer stream was interrupted.");
        if (event.type === "complete") { completed = event as unknown as Reply; return; }
        if (event.type === "preview" && typeof event.question === "string" && typeof event.answer === "string" && claimQuestion(event.question)) {
          if (event.answer.startsWith(previewText)) {
            const delta = event.answer.slice(previewText.length);
            if (delta) this.deliver({ type: "answer_delta", generation_id: genId, text: delta });
            previewText = event.answer;
          }
        }
      };
      if (prepared) {
        let reply = prepared.reply;
        if (prepared.stream) {
          const unsubscribe = prepared.stream.subscribe(value => { if (value.requests_answer) acceptEvent({ type: "preview", ...value }); });
          let abort: () => void = () => {};
          try {
            reply = await new Promise((resolve, reject) => {
              abort = () => reject(new DOMException("Aborted", "AbortError"));
              request.signal.addEventListener("abort", abort, { once: true });
              if (request.signal.aborted) abort();
              prepared.stream!.completion.then(resolve, reject);
            });
          } finally { unsubscribe(); request.signal.removeEventListener("abort", abort); }
        } else if (reply.requests_answer) acceptEvent({ type: "preview", ...reply });
        acceptEvent({ type: "complete", ...reply, evidence: [], keywords: [] });
      } else await streamApi("/live/answer", {
        ...post({ question: questionText.length <= 4000 ? questionText : `${questionText.slice(0, 900)} … ${questionText.slice(-3000)}`, request_focus: focusText, preferences, evidence, interview_context: this.interviewMemory.context(), stream: true }), signal: request.signal,
      }, acceptEvent);
      const result = completed as Reply | null;
      if (!result) throw new Error("The answer stream ended before it completed. Please repeat the question.");
      if (this.stopped || request.signal.aborted) return;
      const speaker = result.speaker_role === "user" || result.speaker_role === "interviewer" ? result.speaker_role : "unknown";
      const classified = this.interviewMemory.classifySpeech(speechId, questionText, speaker);
      if (transcriptId && classified) this.notify({ type: "transcript", id: transcriptId, role: speaker, text: questionText, final: transcriptFinal });
      if (result.requests_answer === false) {
        addTurnToStoredSession(this.session.id, { id: genId, role: result.speaker_role || "unknown", text: questionText, created_at: new Date().toISOString() });
        return;
      }
      if (requestSequence < this.latestAnsweredSequence) return;
      const resolvedQuestion = typeof result.question === "string" && result.question.trim() ? result.question.trim() : questionText;
      if (!claimQuestion(resolvedQuestion)) return;
      if (typeof result.answer !== "string" || !result.answer.trim()) throw new Error("The AI service returned no answer. Try the question again.");
      const answer = result.answer.trim();
      const usedEvidence = Array.isArray(result.evidence) ? result.evidence : evidence;
      this.currentAnswerText = answer;
      this.deliver({ type: "answer_complete", generation_id: genId, answer,
        evidence: usedEvidence,
        keywords: Array.isArray(result.keywords) ? result.keywords : words.slice(0, 5), latency_ms: Date.now() - startedAt });
      this.interviewMemory.recordAnswer(genId, resolvedQuestion, answer, questionText);
      this.notify({ type: "metrics", questions: this.interviewMemory.context().answered_count, reconnects: 0, audio_dropped: 0, first_token_ms: firstTokenMs ?? Date.now() - startedAt, total_ms: Date.now() - startedAt });
      addTurnToStoredSession(this.session.id, { id: genId, role: "interviewer", text: questionText, question: resolvedQuestion,
        answer, evidence: usedEvidence, created_at: new Date().toISOString() });
    } catch (error) {
      if (this.stopped || requestSequence < this.latestAnsweredSequence) return;
      this.deliver({ type: "answer_cancelled", generation_id: genId });
      this.notify({ type: "local", error: request.signal.aborted ? "The answer service timed out. Try the question again." : messageOf(error) });
    } finally {
      clearTimeout(timeout);
      this.answerRequests.delete(requestSequence);
      this.answeringQuestion = this.answerRequests.size > 0;
      const next = this.queuedSpeech.shift();
      if (next && !this.stopped) void this.handleBrowserQuestion(next.text, next.transcriptId, next.transcriptFinal);
    }
  }
}
