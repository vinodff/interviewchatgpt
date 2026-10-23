export type AudioMode = "microphone" | "tab";

export class AudioCapture {
  private streams: MediaStream[] = [];
  private nodes: AudioNode[] = [];
  private context: AudioContext;
  private stopped = false;
  private running = false;
  readonly ready: Promise<void>;

  // Construct synchronously in a click handler: permission calls precede any HTTP request.
  constructor(mode: AudioMode, private onPacket: (packet: ArrayBuffer) => void, private onEnded: (message: string) => void, options: { enhanced?: boolean } = {}) {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) throw new Error("Live audio needs a secure browser with microphone and AudioWorklet support.");
    if (mode === "tab" && !navigator.mediaDevices.getDisplayMedia) throw new Error("Tab audio is supported in desktop Chrome or Edge. Choose microphone on this browser.");
    this.context = new AudioContext({ latencyHint: "interactive" });
    // Resume while transient user activation is still present.
    let resume: Promise<void>;
    let display: Promise<MediaStream> | null = null;
    let microphone: Promise<MediaStream>;
    try {
      resume = this.context.resume();
      void resume.catch(() => undefined);
      display = mode === "tab" ? this.track(navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })) : null;
      void display?.catch(() => undefined);
      // Enhanced room capture should retain quiet remote voices from speakers.
      // It never plays captured audio, so no monitoring feedback loop is created.
      microphone = this.track(navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: !options.enhanced, noiseSuppression: !options.enhanced, autoGainControl: true }, video: false }));
      void microphone.catch(() => undefined);
    } catch (error) { this.stop(); throw error; }
    this.context.onstatechange = () => {
      if (this.context.state === "running") this.running = true;
      else if (!this.stopped && this.running && ["suspended", "interrupted"].includes(this.context.state as string)) this.onEnded("Your browser interrupted audio capture. The session has stopped; keep this page active when restarting.");
    };
    this.ready = this.initialize(mode, display, microphone, resume);
  }

  private async track(request: Promise<MediaStream>): Promise<MediaStream> {
    const stream = await request;
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); throw new Error("Capture was stopped."); }
    this.streams.push(stream);
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => { if (!this.stopped) this.onEnded("Audio sharing ended or permission was revoked. Start a new session to resume."); });
    }
    return stream;
  }

  private async initialize(mode: AudioMode, display: Promise<MediaStream> | null, microphone: Promise<MediaStream>, resume: Promise<void>) {
    try {
      const results = await Promise.allSettled([resume, microphone, ...(display ? [display] : [])]);
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (this.stopped) throw new Error("Capture was stopped.");
      const mic = (results[1] as PromiseFulfilledResult<MediaStream>).value;
      const tab = display ? (results[2] as PromiseFulfilledResult<MediaStream>).value : null;
      if (tab && tab.getAudioTracks().length === 0) throw new Error("No tab audio was shared. Select a browser tab and enable “Share tab audio”, then start again.");
      await this.context.audioWorklet.addModule("/audio/pcm-processor.js");
      if (this.stopped) return;
      const silent = this.context.createGain();
      silent.gain.value = 0;
      silent.connect(this.context.destination);
      this.nodes.push(silent);
      this.connect(mic, mode === "tab" ? 1 : 0, silent);
      if (tab) this.connect(tab, 0, silent);
      // The display video track remains alive for browser sharing permission.
      // It is never attached to a video element, encoded, or sent to the server.
    } catch (error) {
      this.stop();
      if (error instanceof DOMException && error.name === "NotAllowedError") throw new Error("Audio permission was denied or sharing was cancelled. Allow audio to start a live session.");
      throw error;
    }
  }

  private connect(stream: MediaStream, channel: number, silent: GainNode) {
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const source = this.context.createMediaStreamSource(audioOnly);
    const processor = new AudioWorkletNode(this.context, "interviewpilot-pcm", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channel } });
    processor.port.onmessage = (event: MessageEvent<ArrayBuffer>) => { if (!this.stopped) this.onPacket(event.data); };
    source.connect(processor);
    processor.connect(silent);
    this.nodes.push(source, processor);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.context.onstatechange = null;
    for (const node of this.nodes) { if (node instanceof AudioWorkletNode) { node.port.onmessage = null; node.port.close(); } node.disconnect(); }
    this.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    this.streams = [];
    this.nodes = [];
    void this.context.close().catch(() => undefined);
  }
}
