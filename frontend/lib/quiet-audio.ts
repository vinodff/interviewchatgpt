export const VOICE_RATE = 16000;
const FRAME_SAMPLES = 1600;
const SILENCE_FRAMES = 6; // Incomplete question prefixes are retained by the turn controller.
const MAX_FRAMES = 40;
const OVERLAP_FRAMES = 5;

export function packetSamples(packet: ArrayBuffer): Int16Array {
  if (packet.byteLength !== 3201 || new DataView(packet).getUint8(0) !== 0) throw new Error("Invalid microphone audio packet");
  const view = new DataView(packet); const samples = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(1 + i * 2, true);
  return samples;
}

export function signalLevel(samples: Int16Array): { rms: number; peak: number } {
  let sum = 0; let peak = 0;
  for (const sample of samples) { const value = sample / 32768; sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  return { rms: samples.length ? Math.sqrt(sum / samples.length) : 0, peak };
}

/** Normalize only this in-memory segment. Peak limiting prevents clipping; silence stays silent. */
export function enhancedWav(samples: Int16Array): { audio: string; gain: number } {
  const { rms, peak } = signalLevel(samples);
  const gain = rms > 0.00003 ? Math.min(16, 0.09 / rms, 0.95 / peak) : 1;
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const label = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); label(8, "WAVE"); label(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, VOICE_RATE, true);
  view.setUint32(28, VOICE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain))), true);
  let binary = ""; const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { audio: btoa(binary), gain };
}

export type VoiceSegment = { samples: Int16Array; turn: number; final: boolean; overlap: boolean; audio_start_ms: number; audio_end_ms: number };

/** Continuous capture; tiny packets are kept even below speech level, with pre-roll and overlap. */
export class QuietAudioSegments {
  private frames: Int16Array[] = [];
  private preRoll: Int16Array[] = [];
  private active = false;
  private silence = 0;
  private turn = 0;
  private overlap = false;
  private startedAt = 0;

  push(samples: Int16Array): VoiceSegment | null {
    const audible = signalLevel(samples).rms >= 0.00012;
    if (!this.active) {
      this.preRoll.push(samples); this.preRoll = this.preRoll.slice(-3);
      if (!audible) return null;
      this.active = true; this.turn++; this.frames = this.preRoll; this.preRoll = []; this.overlap = false;
      this.startedAt = Date.now() - this.frames.length * 100;
    } else this.frames.push(samples);
    this.silence = audible ? 0 : this.silence + 1;
    if (this.silence < SILENCE_FRAMES && this.frames.length < MAX_FRAMES) return null;
    const final = this.silence >= SILENCE_FRAMES;
    const combined = new Int16Array(this.frames.length * FRAME_SAMPLES);
    this.frames.forEach((frame, index) => combined.set(frame, index * FRAME_SAMPLES));
    const endedAt = Date.now();
    const segment = { samples: combined, turn: this.turn, final, overlap: this.overlap, audio_start_ms: this.startedAt, audio_end_ms: endedAt };
    this.frames = final ? [] : this.frames.slice(-OVERLAP_FRAMES);
    this.startedAt = endedAt - OVERLAP_FRAMES * 100;
    this.active = !final; this.overlap = !final; this.silence = 0;
    return segment;
  }

  reset(): void { this.frames = []; this.preRoll = []; this.active = false; this.silence = 0; this.overlap = false; }
}

/** Only remove a matching boundary inside one overlapping audio turn, never across speakers/pauses. */
export function joinOverlappingSpeech(previous: string, next: string): string {
  const left = previous.trim().split(/\s+/); const right = next.trim().split(/\s+/);
  const normalize = (word: string) => word.toLowerCase().replace(/[^a-z0-9+#]/g, "");
  // One word can span the entire known 500ms audio overlap for a slow speaker.
  for (let size = Math.min(12, left.length, right.length); size >= 1; size--) {
    if (left.slice(-size).map(normalize).join(" ") === right.slice(0, size).map(normalize).join(" ")) return [...left, ...right.slice(size)].join(" ");
  }
  return `${previous} ${next}`.trim();
}
