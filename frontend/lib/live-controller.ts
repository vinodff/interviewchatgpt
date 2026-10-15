import { api, ApiError, messageOf, post } from "./api";
import { AudioCapture, type AudioMode } from "./capture";
import { parseLiveMessage, websocketUrl, type LiveMessage } from "./protocol";
import type { Session } from "./types";

export type LocalEvent = { type: "local"; phase?: "capturing" | "connecting" | "reconnecting" | "ended"; detail?: string; error?: string; dropped?: number };

export class LiveController {
  private capture: AudioCapture | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
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
