/**
 * Desktop audio: the interviewer's voice from system audio (loopback) mixed with your microphone
 * into ONE mono PCM stream, in the packet format StreamingRecognition already consumes.
 * Each source keeps its own mute switch and level meter.
 */
export type AudioSource = "microphone" | "system";
export type DesktopAudioOptions = { microphoneId?: string; includeMicrophone: boolean; includeSystem: boolean };
export type DesktopAudioLevels = Record<AudioSource, number | null>;
/** Minimal surface StreamingRecognition needs from a capture. */
export type PacketCapture = { ready: Promise<void>; stop(): void };
export type CaptureFactory = (onPacket: (packet: ArrayBuffer) => void, onEnded: (message: string) => void) => PacketCapture;

const PCM_WORKLET = "/audio/pcm-processor.js";
const MUTE_RAMP_SECONDS = 0.02;

/** Convert an RMS level (0..1) to a 0..1 meter position on a -80..0 dBFS scale. */
export function meterPosition(rms: number | null): number {
  if (rms === null || !Number.isFinite(rms) || rms <= 0) return 0;
  return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(0.000001, rms)) + 80) / 80));
}

export async function listMicrophones(): Promise<Array<{ id: string; label: string }>> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(device => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default" && device.deviceId !== "communications")
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
}

export class DesktopAudioCapture implements PacketCapture {
  readonly ready: Promise<void>;
  private context: AudioContext;
  private streams: MediaStream[] = [];
  private nodes: AudioNode[] = [];
  private gains: Partial<Record<AudioSource, GainNode>> = {};
  private analysers: Partial<Record<AudioSource, AnalyserNode>> = {};
  private enabled: Record<AudioSource, boolean> = { microphone: true, system: true };
  private sample = new Float32Array(1024);
  private stopped = false;
  /** Why a source is missing, for the setup screen. Empty when the source works. */
  readonly problems: Partial<Record<AudioSource, string>> = {};

  /**
   * Construct inside a click handler: both permission requests start before any await.
   * Pass onPacket=null for a level-only test (no speech pipeline).
   */
  constructor(private onPacket: ((packet: ArrayBuffer) => void) | null, private onEnded: (message: string) => void, private options: DesktopAudioOptions) {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error("Audio capture is not available in this window.");
    this.context = new AudioContext({ latencyHint: "interactive" });
    const resume = this.context.resume();
    void resume.catch(() => undefined);
    const microphone = options.includeMicrophone ? navigator.mediaDevices.getUserMedia({
      audio: { ...(options.microphoneId ? { deviceId: { exact: options.microphoneId } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    }) : null;
    // The desktop app answers this request with system audio (loopback). The video track is
    // required by the API; it is never rendered, recorded or sent anywhere.
    const system = options.includeSystem && navigator.mediaDevices.getDisplayMedia ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : null;
    void microphone?.catch(() => undefined); void system?.catch(() => undefined);
    this.ready = this.initialize(resume, microphone, system);
  }

  get systemAvailable(): boolean { return Boolean(this.analysers.system); }
  get microphoneAvailable(): boolean { return Boolean(this.analysers.microphone); }

  private async initialize(resume: Promise<void>, microphone: Promise<MediaStream> | null, system: Promise<MediaStream> | null): Promise<void> {
    try {
      const [, mic, sys] = await Promise.allSettled([resume, microphone ?? Promise.resolve(null), system ?? Promise.resolve(null)]);
      const micStream = this.accept(mic, "microphone");
      const systemStream = this.accept(sys, "system");
      if (this.stopped) throw new Error("Capture was stopped.");
      if (!micStream && !systemStream) throw new Error(this.problems.microphone || this.problems.system || "No audio source is available. Check your microphone permission.");
      const processor = this.onPacket ? await this.createProcessor() : null;
      if (this.stopped) throw new Error("Capture was stopped.");
      if (micStream) this.connect("microphone", micStream, processor);
      if (systemStream) this.connect("system", systemStream, processor);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  /** Keep a granted stream, or record why the source is unavailable. */
  private accept(result: PromiseSettledResult<MediaStream | null>, source: AudioSource): MediaStream | null {
    if (result.status === "rejected") {
      const denied = result.reason instanceof DOMException && result.reason.name === "NotAllowedError";
      this.problems[source] = source === "microphone"
        ? denied ? "Microphone permission was denied. Allow it in your system privacy settings." : "The selected microphone could not be opened."
        : "System audio is not available on this computer. Your microphone will still work.";
      return null;
    }
    const stream = result.value;
    if (!stream) return null;
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); return null; }
    this.streams.push(stream);
    if (stream.getAudioTracks().length === 0) {
      this.problems[source] = "System audio is not available on this computer. Your microphone will still work.";
      return null;
    }
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (this.stopped) return;
        if (source === "microphone") this.onEnded("Your microphone was disconnected. Reconnect it and start a new session.");
        else this.problems.system = "System audio sharing ended.";
      });
    }
    return stream;
  }

  private async createProcessor(): Promise<AudioWorkletNode> {
    await this.context.audioWorklet.addModule(PCM_WORKLET);
    const processor = new AudioWorkletNode(this.context, "interviewpilot-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channel: 0 } });
    processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => { if (!this.stopped) this.onPacket?.(event.data); };
    // Pull the graph without playing anything: the processor feeds a muted output.
    const silent = this.context.createGain();
    silent.gain.value = 0;
    processor.connect(silent); silent.connect(this.context.destination);
    this.nodes.push(processor, silent);
    return processor;
  }

  private connect(source: AudioSource, stream: MediaStream, processor: AudioWorkletNode | null): void {
    const input = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const gain = this.context.createGain();
    gain.gain.value = this.enabled[source] ? 1 : 0;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = this.sample.length;
    input.connect(gain); gain.connect(analyser);
    // Both sources sum into the processor's single input: one mixed mono stream.
    if (processor) gain.connect(processor);
    this.gains[source] = gain; this.analysers[source] = analyser;
    this.nodes.push(input, gain, analyser);
  }

  /** Mute or unmute one source without restarting capture. */
  setEnabled(source: AudioSource, on: boolean): void {
    this.enabled[source] = on;
    this.gains[source]?.gain.setTargetAtTime(on ? 1 : 0, this.context.currentTime, MUTE_RAMP_SECONDS);
  }

  isEnabled(source: AudioSource): boolean { return this.enabled[source]; }

  /** Current RMS per source (after its mute switch); null when the source is unavailable. */
  levels(): DesktopAudioLevels {
    const read = (source: AudioSource): number | null => {
      const analyser = this.analysers[source];
      if (!analyser || this.stopped) return null;
      analyser.getFloatTimeDomainData(this.sample);
      let sum = 0;
      for (const value of this.sample) sum += value * value;
      return Math.sqrt(sum / this.sample.length);
    };
    return { microphone: read("microphone"), system: read("system") };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const node of this.nodes) {
      if (node instanceof AudioWorkletNode) { node.port.onmessage = null; node.port.close(); }
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
    this.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    this.streams = []; this.nodes = []; this.gains = {}; this.analysers = {};
    void this.context.close().catch(() => undefined);
  }
}
