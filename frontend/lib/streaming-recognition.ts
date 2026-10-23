import { api, post } from "./api";
import { AudioCapture } from "./capture";
import { packetSamples, signalLevel } from "./quiet-audio";
import { streamingSpeechSetup, type StreamingSpeechTicket } from "./streaming-speech-config";
import type { MicrophoneLevel } from "./enhanced-recognition";

type SpeechResult = { 0: { transcript: string }; isFinal: boolean; length: number };
type SpeechEvent = { resultIndex: number; results: SpeechResult[]; audio_start_ms: number; audio_end_ms: number };
type Frame = { data: string; end: boolean; at: number; voiced: boolean };

/** Persistent, text-only speech recognition. No long-lived provider key enters the browser. */
export class StreamingRecognition {
  continuous = true; interimResults = true; lang = "en-US";
  onresult: ((event: SpeechEvent) => void) | null = null;
  onerror: ((event: { error?: string; detail?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  ready: Promise<void> = Promise.resolve();
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private request: AbortController | null = null;
  private queue: Frame[] = [];
  private stopped = false;
  private connected = false;
  private connecting = false;
  private gain = 1;
  private frames = 0;
  private silence = 0;
  private audible = false;
  private lastAudibleAt = 0;
  private turnStartedAt = 0;
  private connectedAt = 0;
  private pendingTranscript = false;
  private sentFrames = 0;
  private lastVoicedFrame = 0;
  private confirmedAudioEnd = 0;
  private cloudActive = false;
  private cloudStarts = 0;
  private cloudEnds = 0;
  private cloudFinals = 0;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  private rotation: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((reason: Error) => void) | null = null;

  constructor(private onLevel: (level: MicrophoneLevel) => void, private onStatus: (detail: string) => void) {}

  start(): void {
    if (this.stopped || this.capture) return;
    this.ready = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.ready.catch(() => undefined);
    try {
      // Construct synchronously in Start's gesture so Android/iOS can grant capture.
      this.capture = new AudioCapture("microphone", packet => this.packet(packet), () => this.fail("Microphone capture was interrupted. Restart the session."), { enhanced: true });
      void this.capture.ready.then(() => this.connect()).catch(() => this.fail("Microphone access failed. Allow microphone access and restart."));
    } catch { this.fail("Microphone capture could not start. Check browser permissions."); }
  }

  private packet(packet: ArrayBuffer): void {
    if (this.stopped) return;
    let samples: Int16Array;
    try { samples = packetSamples(packet); } catch { this.fail("Unsupported microphone audio. Restart the session."); return; }
    const level = signalLevel(samples); const now = Date.now();
    // Fast attack, slower recovery; the peak ceiling always wins over smoothing.
    const target = level.rms > 0.00003 ? Math.max(1, Math.min(16, 0.07 / level.rms)) : 1;
    this.gain = Math.min(this.gain + (target - this.gain) * (target > this.gain ? 0.8 : 0.2), level.peak ? 0.95 / level.peak : 16);
    if (++this.frames % 3 === 0) this.onLevel({ ...level, gain: this.gain });
    const heard = level.rms >= 0.00012;
    if (heard) { this.lastAudibleAt = now; this.audible = true; this.silence = 0; if (!this.turnStartedAt) this.turnStartedAt = now - 100; }
    else this.silence++;
    const end = this.audible && this.silence >= 4;
    if (end) this.audible = false;
    const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setInt16(index * 2, Math.round(sample * this.gain), true));
    const frame = { data: btoa(String.fromCharCode(...bytes)), end, at: now, voiced: heard };
    if (this.queue.length >= 60) { this.fail("Streaming recognition could not keep up before its audio buffer filled. Select Enhanced microphone and restart."); return; }
    this.queue.push(frame); this.pump();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true; this.connected = false;
    const request = new AbortController(); this.request = request;
    this.handshake = setTimeout(() => this.fail("Streaming speech recognition timed out. Select Enhanced microphone and restart."), 8000);
    try {
      const ticket = await api<StreamingSpeechTicket>("/live/speech-ticket", { ...post({}), signal: request.signal });
      if (this.stopped || request.signal.aborted) return;
      if (typeof ticket.token !== "string" || !ticket.token.startsWith("auth_tokens/") || ticket.token.length > 8192 || !Number.isFinite(ticket.expires_at) || ticket.expires_at <= Date.now()) throw new Error();
      const ws = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(ticket.token)}`);
      this.socket = ws; ws.binaryType = "arraybuffer";
      ws.onopen = () => { if (this.current(ws)) { try { ws.send(JSON.stringify({ setup: streamingSpeechSetup() })); } catch { this.fail("Streaming speech setup failed. Restart the session."); } } };
      ws.onmessage = event => { if (this.current(ws)) this.receive(event.data); };
      ws.onerror = () => { /* onclose owns the bounded reconnect and error message. */ };
      ws.onclose = () => {
        if (!this.current(ws)) return;
        this.releaseSocket();
        // The provider has no per-packet acknowledgement. A broken socket
        // cannot safely replay speech or prove the last words were received.
        this.fail("Streaming recognition was interrupted. Please restart and repeat the last question, or select Enhanced microphone.");
      };
    } catch { if (!this.stopped) this.fail("Streaming recognition is unavailable. Select Enhanced microphone and restart."); }
  }

  private current(ws: WebSocket): boolean { return !this.stopped && this.socket === ws; }

  private receive(data: unknown): void {
    try {
      const raw = typeof data === "string" ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : "";
      if (!raw || raw.length > 65536) throw new Error();
      const message = JSON.parse(raw);
      if (!message || typeof message !== "object" || Array.isArray(message) || message.error) throw new Error();
      if (message.setupComplete) {
        if (this.connected) throw new Error();
        this.connected = true; this.connecting = false; this.connectedAt = Date.now();
        if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
        this.pump(); if (this.stopped) return;
        this.resolveReady?.(); this.resolveReady = null; this.rejectReady = null;
        this.onStatus("Streaming microphone active. Speech appears as it is heard; quiet input is amplified.");
        // Renew at a quiet boundary before the provider's ten-minute connection limit.
        this.rotation = setInterval(() => this.rotate(), 1000);
        this.deadline = setTimeout(() => this.fail("The speech connection reached its time limit during continuous audio. Restart the session to continue."), 9.5 * 60000);
      }
      const content = message.serverContent;
      if (content?.inputTranscription) this.transcript(content.inputTranscription.text, true);
      else if (content?.interimInputTranscription) this.transcript(content.interimInputTranscription.text, false);
      const activity = message.voiceActivity;
      if (activity?.type === "ACTIVITY_START") { this.cloudActive = true; this.cloudStarts++; }
      if (activity?.type === "ACTIVITY_END") {
        this.cloudActive = false; this.cloudEnds++;
        if (typeof activity.audioOffset === "string" && /^\d+(?:\.\d+)?s$/.test(activity.audioOffset)) {
          const seconds = Number(activity.audioOffset.slice(0, -1));
          if (seconds <= this.sentFrames / 10 + 0.1) this.confirmedAudioEnd = Math.max(this.confirmedAudioEnd, seconds);
        }
      }
      if (message.goAway && !this.stopped) {
        if (this.safeBoundary()) this.renew();
        else this.fail("The speech provider is renewing its connection. Restart and repeat the last question.");
      }
    } catch { this.fail("The streaming speech service returned an invalid response. Restart the session."); }
  }

  private transcript(value: unknown, final: boolean): void {
    if (typeof value !== "string" || value.length > 4000) throw new Error();
    const text = value.trim();
    if (final) {
      if (!text && this.pendingTranscript) throw new Error();
      this.pendingTranscript = false; this.cloudFinals++;
    }
    if (!text) { if (final) this.turnStartedAt = 0; return; }
    this.pendingTranscript = !final;
    this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: final, length: 1 }], audio_start_ms: this.turnStartedAt || Date.now(), audio_end_ms: this.lastAudibleAt || Date.now() });
    if (final) { this.turnStartedAt = 0; this.onend?.(); }
  }

  private send(frame: Frame): void {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN || Date.now() - frame.at > 6000) { this.fail("The speech connection cannot keep up with microphone audio. Restart the session."); return; }
    try {
      ws.send(JSON.stringify({ realtimeInput: { audio: { data: frame.data, mimeType: "audio/pcm;rate=16000" } } }));
      this.sentFrames++; if (frame.voiced) this.lastVoicedFrame = this.sentFrames;
      if (frame.end) ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
    } catch { this.fail("Microphone audio could not reach speech recognition. Restart the session."); }
  }

  private pump(): void {
    if (this.stopped || !this.connected || this.pumpTimer || !this.queue.length) return;
    if (Date.now() - this.queue[0].at > 6000) { this.fail("The speech connection cannot keep up with microphone audio. Restart the session."); return; }
    // Yield between buffered startup frames so a normal TLS socket can drain.
    // Later microphone frames join the same queue and cannot overtake them.
    if (this.socket && this.socket.bufferedAmount <= 64000) this.send(this.queue.shift()!);
    if (!this.stopped && this.queue.length) this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump(); }, 20);
  }

  private rotate(): void {
    if (Date.now() - this.connectedAt >= 8 * 60000 && this.safeBoundary()) this.renew();
  }
  private safeBoundary(): boolean {
    // A delayed final for an OLD turn cannot acknowledge newer voiced frames.
    // The provider's VAD audio offset must cover all locally detected speech.
    return !this.pendingTranscript && !this.cloudActive && !this.audible && !this.queue.length
      && this.cloudStarts === this.cloudEnds && this.cloudStarts === this.cloudFinals
      && this.lastVoicedFrame / 10 <= this.confirmedAudioEnd && Date.now() - this.lastAudibleAt > 2000;
  }
  private renew(): void {
    this.releaseSocket(); this.sentFrames = 0; this.lastVoicedFrame = 0; this.confirmedAudioEnd = 0; this.cloudActive = false;
    this.cloudStarts = 0; this.cloudEnds = 0; this.cloudFinals = 0;
    void this.connect();
  }
  private releaseSocket(): void {
    this.connected = false; this.connecting = false;
    if (this.handshake) clearTimeout(this.handshake); this.handshake = null;
    if (this.rotation) clearInterval(this.rotation); this.rotation = null;
    if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
    if (this.pumpTimer) clearTimeout(this.pumpTimer); this.pumpTimer = null;
    const ws = this.socket; this.socket = null;
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; try { ws.close(); } catch { /* Capture disposal must continue. */ } }
  }
  private fail(detail: string): void {
    if (this.stopped) return;
    const reject = this.rejectReady; this.rejectReady = null;
    this.stop(); reject?.(new Error(detail)); this.onerror?.({ error: "audio-capture", detail });
  }
  stop(): void {
    if (this.stopped) return;
    this.stopped = true; this.request?.abort(); this.request = null;
    this.releaseSocket(); this.queue = []; this.capture?.stop(); this.capture = null;
    this.rejectReady?.(new Error("Speech capture stopped.")); this.resolveReady = null; this.rejectReady = null;
  }
}
