import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCapture } from "../lib/capture";

class Track { stop = vi.fn(); addEventListener = vi.fn(); }
class Stream {
  constructor(public audio: Track[] = [new Track()], public video: Track[] = []) {}
  getTracks() { return [...this.audio, ...this.video]; } getAudioTracks() { return this.audio; }
}
class Node { connect = vi.fn(); disconnect = vi.fn(); }
class Worklet extends Node { port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() }; }
class Context {
  static instances: Context[] = [];
  state = "running"; onstatechange: (() => void) | null = null;
  destination = {}; audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  resume = vi.fn().mockResolvedValue(undefined); close = vi.fn().mockResolvedValue(undefined);
  createGain() { return Object.assign(new Node(), { gain: { value: 1 } }); }
  createMediaStreamSource = vi.fn(() => new Node());
  constructor() { Context.instances.push(this); }
}
describe("capture permissions and disposal", () => {
  const media = { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); Context.instances = [];
    vi.stubGlobal("window", { AudioContext: Context }); vi.stubGlobal("AudioContext", Context);
    vi.stubGlobal("AudioWorkletNode", Worklet); vi.stubGlobal("MediaStream", class extends Stream { constructor(tracks: Track[]) { super(tracks); } });
    vi.stubGlobal("navigator", { mediaDevices: media });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("requests tab and microphone in the constructor, keeps video alive, and stops all tracks", async () => {
    const tab = new Stream([new Track()], [new Track()]); const mic = new Stream();
    media.getDisplayMedia.mockResolvedValue(tab); media.getUserMedia.mockResolvedValue(mic);
    const capture = new AudioCapture("tab", vi.fn(), vi.fn());
    expect(media.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true }); expect(media.getUserMedia).toHaveBeenCalledOnce();
    await capture.ready; expect(tab.video[0].stop).not.toHaveBeenCalled();
    expect(Context.instances[0].createMediaStreamSource).toHaveBeenCalledTimes(2);
    capture.stop(); for (const track of [...tab.getTracks(), ...mic.getTracks()]) expect(track.stop).toHaveBeenCalledOnce();
    expect(Context.instances[0].close).toHaveBeenCalledOnce();
  });
  it("releases the granted display when microphone permission fails", async () => {
    const tab = new Stream([new Track()], [new Track()]); media.getDisplayMedia.mockResolvedValue(tab); media.getUserMedia.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    const capture = new AudioCapture("tab", vi.fn(), vi.fn()); await expect(capture.ready).rejects.toThrow("permission");
    tab.getTracks().forEach(track => expect(track.stop).toHaveBeenCalledOnce());
  });
  it("rejects silent screen sharing and releases capture", async () => {
    const tab = new Stream([], [new Track()]); const mic = new Stream(); media.getDisplayMedia.mockResolvedValue(tab); media.getUserMedia.mockResolvedValue(mic);
    const capture = new AudioCapture("tab", vi.fn(), vi.fn()); await expect(capture.ready).rejects.toThrow("No tab audio");
    expect(tab.video[0].stop).toHaveBeenCalledOnce(); expect(mic.audio[0].stop).toHaveBeenCalledOnce();
  });
  it("visibly terminates suspended and interrupted contexts", async () => {
    media.getUserMedia.mockResolvedValue(new Stream()); const ended = vi.fn(); const capture = new AudioCapture("microphone", vi.fn(), ended); await capture.ready;
    const context = Context.instances[0]; context.onstatechange?.(); context.state = "interrupted"; context.onstatechange?.(); expect(ended).toHaveBeenCalledWith(expect.stringContaining("interrupted"));
    capture.stop();
  });
  it("closes the AudioContext if a permission call throws synchronously", () => {
    media.getDisplayMedia.mockImplementation(() => { throw new Error("Browser rejected activation"); });
    expect(() => new AudioCapture("tab", vi.fn(), vi.fn())).toThrow("activation"); expect(Context.instances[0].close).toHaveBeenCalledOnce();
  });
});
