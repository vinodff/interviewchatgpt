import { AudioCapture } from "./capture";
import { api, messageOf, post, streamApi } from "./api";
import { enhancedWav, joinOverlappingSpeech, packetSamples, QuietAudioSegments, signalLevel, type VoiceSegment } from "./quiet-audio";
import { audioTaskKey, validAudioReply, type AudioAnswerContext, type AudioReply, type PreparedAudioReply } from "./audio-answer";

export type MicrophoneLevel = { rms: number; peak: number; gain: number };
type SpeechEvent = { resultIndex: number; results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }>; audio_start_ms: number; audio_end_ms: number; prepared?: PreparedAudioReply };

/** Web Speech-compatible events from continuous PCM capture and bounded server transcription. */
export class EnhancedRecognition {
  continuous = true; interimResults = true; lang = "en-US";
  onresult: ((event: SpeechEvent) => void) | null = null;
  onerror: ((event: { error?: string; detail?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  ready: Promise<void> = Promise.resolve();
  private capture: AudioCapture | null = null;
  private segments = new QuietAudioSegments();
  private queue: VoiceSegment[] = [];
  private request: AbortController | null = null;
  private stopped = false;
  private currentTurn = -1;
  private text = "";
  private gain = 1;
  private frames = 0;

  constructor(private onLevel: (level: MicrophoneLevel) => void, private getAnswerContext?: () => AudioAnswerContext | null) {}

  start(): void {
    if (this.stopped || this.capture) return; // Synthetic turn-end restarts keep the same microphone open.
    try {
      this.capture = new AudioCapture("microphone", packet => {
        if (this.stopped) return;
        let samples: Int16Array;
        try { samples = packetSamples(packet); } catch { this.fail("The microphone returned an unsupported audio format. Restart the session."); return; }
        if (++this.frames % 3 === 0) this.onLevel({ ...signalLevel(samples), gain: this.gain });
        const segment = this.segments.push(samples);
        if (segment) {
          if (this.queue.length >= 3) { this.fail("Audio transcription cannot keep up. Stop and restart, or use Standard microphone mode."); return; }
          this.queue.push(segment); void this.drain();
        }
      }, detail => this.fail(detail), { enhanced: true });
      this.ready = this.capture.ready;
      void this.ready.catch(error => { if (!this.stopped) this.fail(messageOf(error)); });
    } catch (error) { this.fail(messageOf(error)); }
  }

  private async drain(): Promise<void> {
    if (this.stopped || this.request) return;
    const segment = this.queue.shift(); if (!segment) return;
    const request = new AbortController(); this.request = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    let rejectCompletion: ((error: unknown) => void) | undefined;
    try {
      const encoded = enhancedWav(segment.samples); this.gain = encoded.gain;
      const context = this.getAnswerContext?.(); const startedAt = Date.now();
      let published = false;
      let prepared: PreparedAudioReply | undefined;
      const publish = (result: { text: string; reply?: unknown }) => {
        if (this.stopped || request.signal.aborted) return;
        if (typeof result.text !== "string" || result.text.length > 3000) throw new Error("The transcription service returned invalid speech.");
        if (context && result.reply !== undefined && !validAudioReply(result.reply)) throw new Error("The audio service returned an invalid answer decision.");
        if (segment.turn !== this.currentTurn) { this.currentTurn = segment.turn; this.text = ""; }
        if (result.text.trim()) this.text = segment.overlap ? joinOverlappingSpeech(this.text, result.text) : result.text.trim();
        if (this.text.length > 4000) throw new Error("The spoken turn is too long. Pause, then start a new session.");
        published = true;
        if (this.text) {
          this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: this.text }, isFinal: segment.final, length: 1 }], audio_start_ms: segment.audio_start_ms, audio_end_ms: segment.audio_end_ms, prepared });
          if (segment.final) { this.text = ""; this.onend?.(); }
        }
      };
      if (context) {
        let resolveCompletion!: (reply: AudioReply) => void;
        const completion = new Promise<AudioReply>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
        // An incomplete spoken prefix may never have an answer consumer.
        void completion.catch(() => undefined);
        const listeners = new Set<(reply: AudioReply) => void>();
        let completed = false;
        let clipText: string | undefined;
        await streamApi("/live/transcribe", { ...post({ audio: encoded.audio, fast_answer: true, stream: true, ...context, overlap: segment.overlap }), signal: request.signal }, event => {
          if (this.stopped || request.signal.aborted) return;
          if (event.type === "error") throw new Error(typeof event.detail === "string" ? event.detail : "Audio understanding was interrupted.");
          if (event.type !== "preview" && event.type !== "complete") throw new Error("The audio service returned an invalid event.");
          // A transcription-only completion still uses the normal contextual answer path.
          if (event.type === "complete" && event.reply === undefined && !published) {
            if (typeof event.text !== "string") throw new Error("The transcription service returned invalid speech.");
            publish({ text: event.text }); completed = true;
            resolveCompletion({ requests_answer: false, speaker_role: "unknown", question: "", answer: "" }); return;
          }
          if (typeof event.text !== "string" || event.text.length > 3000 || !validAudioReply(event.reply)) throw new Error("The audio service returned invalid speech or an answer decision.");
          if (clipText !== undefined && event.text !== clipText) throw new Error("The audio transcript changed while answering. Please repeat the question.");
          if (prepared && (event.reply.requests_answer !== prepared.reply.requests_answer || event.reply.question !== prepared.reply.question || event.reply.speaker_role !== prepared.reply.speaker_role)) throw new Error("The audio answer decision changed while streaming. Please repeat the question.");
          clipText = event.text;
          if (!prepared) {
            prepared = { reply: event.reply, started_at: startedAt, preferences_key: JSON.stringify(context.preferences), task_key: audioTaskKey(context.interview_context), stream: {
              completion, subscribe(listener) { listeners.add(listener); listener(prepared!.reply); return () => listeners.delete(listener); },
            } };
          } else { prepared.reply = event.reply; for (const listener of listeners) listener(event.reply); }
          if (!published) publish({ text: event.text, reply: event.reply });
          if (event.type === "complete") { completed = true; resolveCompletion(event.reply); }
        });
        if (!this.stopped && !request.signal.aborted && !completed) throw new Error("The audio stream ended before it completed. Please repeat the question.");
      } else publish(await api<{ text: string }>("/live/transcribe", { ...post({ audio: encoded.audio }), signal: request.signal }));
      if (this.stopped || request.signal.aborted) return;
    } catch (error) { rejectCompletion?.(error); if (!this.stopped) this.fail(request.signal.aborted ? "Audio transcription timed out. Restart the session or use Standard mode." : messageOf(error)); }
    finally { clearTimeout(timeout); this.request = null; if (!this.stopped) void this.drain(); }
  }

  private fail(detail: string): void { this.stop(); this.onerror?.({ error: "audio-capture", detail }); }
  stop(): void { this.stopped = true; this.capture?.stop(); this.capture = null; this.request?.abort(); this.queue = []; this.segments.reset(); this.text = ""; }
}
