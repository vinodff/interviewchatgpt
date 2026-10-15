import { api, ApiError, messageOf, post } from "./api";
import { AudioCapture, type AudioMode } from "./capture";
import { parseLiveMessage, websocketUrl, type LiveMessage } from "./protocol";
import type { Session, Evidence } from "./types";
import { getStoredUser, searchStoredEvidence, addTurnToStoredSession } from "./browser-storage";
import { generateHumanAnswer } from "./knowledge-engine";

export type LocalEvent = { type: "local"; phase?: "capturing" | "connecting" | "reconnecting" | "ended"; detail?: string; error?: string; dropped?: number };

export class LiveController {
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private speechRecognition: { stop: () => void; start: () => void } | null = null;
  private segmentMap = new Map<number, string>();
  private speechBuffer: string[] = [];
  private speechDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private reconnects = 0;
  private dropped = 0;
  private session: Session | null = null;
  private lastServerAt = Date.now();

  constructor(private notify: (event: LiveMessage | LocalEvent) => void, private onSession: (session: Session) => void) {}

  async start(mode: AudioMode, title: string, retention: boolean) {
    try {
      // This constructor invokes browser permissions synchronously before the first await.
      this.capture = new AudioCapture(mode, packet => this.sendAudio(packet), message => { void this.fail(message); });
      this.notify({ type: "local", phase: "capturing", detail: "Waiting for your browser’s audio permission…" });
      await this.capture.ready;
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
      detail: "Live browser assistant active. Listening for questions via your microphone…"
    });

    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition
        || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

      if (SpeechRecognition) {
        try {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "en-US";
          recognition.onresult = (event: any) => {
            if (this.stopped) return;
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const res = event.results[i];
              const text = res[0]?.transcript?.trim() || "";
              if (!text) continue;

              // Maintain stable transcript row ID for ongoing utterance
              let transcriptId = this.segmentMap.get(i);
              if (!transcriptId) {
                transcriptId = `tr_${i}_${Date.now()}`;
                this.segmentMap.set(i, transcriptId);
              }

              const isFinal = res.isFinal;
              this.notify({
                type: "transcript",
                id: transcriptId,
                role: "interviewer",
                text,
                final: isFinal
              });

              if (isFinal) {
                this.segmentMap.delete(i);
                this.queueUtterance(text);
              }
            }
          };
          recognition.onerror = () => { /* Non-fatal */ };
          recognition.onend = () => {
            if (!this.stopped && this.session && this.session.status !== "ended") {
              try { recognition.start(); } catch { /* ignore */ }
            }
          };
          recognition.start();
          this.speechRecognition = recognition;
        } catch { /* SpeechRecognition not allowed */ }
      }
    }
  }

  private queueUtterance(text: string) {
    const cleaned = text.trim();
    if (!cleaned) return;

    // Ignore conversational filler acknowledgments
    if (/^(ok|okay|ok\s+ok|yeah|yep|sure|right|uh\s*huh|mhm|cool|got\s+it)[\s.!,?]*$/i.test(cleaned)) {
      return;
    }

    this.speechBuffer.push(cleaned);

    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
    }

    // Debounce to allow user to complete multi-part speech naturally
    this.speechDebounceTimer = setTimeout(() => {
      void this.processSpeechBuffer();
    }, 850);
  }

  private async processSpeechBuffer() {
    if (this.stopped || !this.speechBuffer.length) return;
    const fullText = this.speechBuffer.join(" ").trim();
    this.speechBuffer = [];

    // Filter filler prefixes like "okay let me know what is", "can you tell me"
    let question = fullText
      .replace(/^(okay|ok|so|now|alright|well|and|um|uh|please)\s*,?\s*/i, "")
      .replace(/^(let me know|can you tell me|could you tell me|tell me|i want to know|can you explain|could you explain)\s*,?\s*/i, "")
      .replace(/^(your|about|what)\s+(what is|what are)/i, "$2")
      .trim();

    if (question.length < 5) return;

    const isQuestion = fullText.includes("?")
      || /^(what|how|why|when|where|which|who|can|could|would|is|are|do|does|did|explain|describe|tell|walk me through|difference)/i.test(fullText)
      || /^(what|how|why|when|where|which|who|can|could|would|is|are|do|does|did|explain|describe|tell|walk me through|difference)/i.test(question)
      || /(python|javascript|react|database|dataset|dictionary|sql|api|system|service|memory|class|function|design|scale|code|git|docker)/i.test(question);

    if (isQuestion) {
      await this.respondToQuestion(question, fullText);
    }
  }

  async respondToQuestion(question: string, rawUtterance?: string) {
    if (this.stopped) return;
    const genId = `gen_${Date.now()}`;
    const displayQuestion = question.length > 5 ? question : (rawUtterance || question);
    const words = displayQuestion.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3).slice(0, 5);

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

    // Fast, natural streaming (20ms cadence)
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
    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    this.speechBuffer = [];
    this.segmentMap.clear();
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
