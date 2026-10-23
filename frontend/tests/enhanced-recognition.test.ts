import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const doubles = vi.hoisted(() => ({ api: vi.fn(), packet: null as null | ((value: ArrayBuffer) => void), ended: null as null | ((value: string) => void), stop: vi.fn(), capture: vi.fn(), ready: null as null | Promise<void> }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: doubles.api }));
vi.mock("../lib/capture", () => ({ AudioCapture: class {
  ready = doubles.ready || Promise.resolve();
  constructor(...args: unknown[]) { doubles.capture(...args); doubles.packet = args[1] as typeof doubles.packet; doubles.ended = args[2] as typeof doubles.ended; }
  stop = doubles.stop;
} }));
import { EnhancedRecognition } from "../lib/enhanced-recognition";
const frame = (amplitude: number) => { const buffer = new ArrayBuffer(3201); const view = new DataView(buffer); for (let i = 0; i < 1600; i++) view.setInt16(i * 2 + 1, Math.round(amplitude * Math.sin(i / 6)), true); return buffer; };
const speech = () => { for (let i = 0; i < 10; i++) doubles.packet?.(frame(30)); for (let i = 0; i < 12; i++) doubles.packet?.(frame(0)); };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); doubles.ready = null; });
afterEach(() => { vi.useRealTimers(); });
describe("enhanced continuous microphone lifecycle", () => {
  it("transcribes amplified audio and emits a final turn while reusing capture on restart", async () => {
    doubles.api.mockResolvedValue({ text: "What is a Python dictionary?" });
    const recognition = new EnhancedRecognition(vi.fn()); const result = vi.fn(); const ended = vi.fn(); recognition.onresult = result; recognition.onend = ended;
    recognition.start(); await recognition.ready; speech(); await vi.advanceTimersByTimeAsync(0);
    expect(doubles.capture.mock.calls[0][3]).toEqual({ enhanced: true });
    expect(result.mock.calls[0][0].results[0]).toMatchObject({ isFinal: true, 0: { transcript: "What is a Python dictionary?" } });
    expect(ended).toHaveBeenCalledOnce(); recognition.start(); expect(doubles.capture).toHaveBeenCalledOnce();
    recognition.stop(); expect(doubles.stop).toHaveBeenCalledOnce();
  });
  it("does not synthesize speech or restart churn from background noise", async () => {
    doubles.api.mockResolvedValue({ text: "" });
    const recognition = new EnhancedRecognition(vi.fn()); recognition.onresult = vi.fn(); recognition.onend = vi.fn(); recognition.start();
    speech(); await vi.advanceTimersByTimeAsync(0);
    expect(recognition.onresult).not.toHaveBeenCalled(); expect(recognition.onend).not.toHaveBeenCalled(); recognition.stop();
  });
  it("aborts pending transcription on Stop and ignores its late response", async () => {
    let resolve: (value: unknown) => void = () => {}; doubles.api.mockImplementation(() => new Promise(done => { resolve = done; }));
    const recognition = new EnhancedRecognition(vi.fn()); recognition.onresult = vi.fn(); recognition.start(); speech();
    const signal = doubles.api.mock.calls[0][1].signal; recognition.stop(); expect(signal.aborted).toBe(true);
    resolve({ text: "late question" }); await vi.advanceTimersByTimeAsync(0); expect(recognition.onresult).not.toHaveBeenCalled();
  });
  it("surfaces capture failure and transcription errors instead of silent fallback", async () => {
    const recognition = new EnhancedRecognition(vi.fn()); recognition.onerror = vi.fn(); recognition.start(); doubles.ended?.("Microphone permission ended");
    expect(recognition.onerror).toHaveBeenCalledWith({ error: "audio-capture", detail: "Microphone permission ended" });
    doubles.api.mockRejectedValue(new Error("Provider unavailable")); const second = new EnhancedRecognition(vi.fn()); second.onerror = vi.fn(); second.start(); speech(); await vi.advanceTimersByTimeAsync(0);
    expect(second.onerror).toHaveBeenCalledWith(expect.objectContaining({ detail: "Provider unavailable" }));
  });
});
