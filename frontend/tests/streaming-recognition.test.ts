import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn(), packet: null as null | ((value: ArrayBuffer) => void), stop: vi.fn(), capture: vi.fn(), captureReady: null as null | Promise<void> }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: mocks.api }));
vi.mock("../lib/capture", () => ({ AudioCapture: class {
  ready = mocks.captureReady || Promise.resolve();
  constructor(...args: unknown[]) { mocks.capture(...args); mocks.packet = args[1] as typeof mocks.packet; }
  stop = mocks.stop;
} }));
import { StreamingRecognition } from "../lib/streaming-recognition";
class Socket {
  static OPEN = 1; static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0; binaryType = "";
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send = vi.fn(); close = vi.fn();
  constructor(public url: string) { Socket.instances.push(this); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const frame = (amplitude: number) => { const buffer = new ArrayBuffer(3201); const view = new DataView(buffer); for (let i = 0; i < 1600; i++) view.setInt16(i * 2 + 1, Math.round(amplitude * Math.sin(i / 6)), true); return buffer; };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); Socket.instances = []; mocks.captureReady = null; vi.stubGlobal("WebSocket", Socket); mocks.api.mockResolvedValue({ token: "auth_tokens/temporary-test", expires_at: Date.now() + 30 * 60000 }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
async function connected() {
  const recognition = new StreamingRecognition(vi.fn(), vi.fn()); recognition.onerror = vi.fn(); recognition.onresult = vi.fn(); recognition.onend = vi.fn(); recognition.start();
  await vi.advanceTimersByTimeAsync(0); const socket = Socket.instances.at(-1)!; socket.onopen?.(); socket.message({ setupComplete: {} }); await recognition.ready;
  return { recognition, socket };
}
describe("continuous streaming recognition", () => {
  it("starts capture in the gesture, buffers initial phonemes and sends boosted PCM after setup", async () => {
    const recognition = new StreamingRecognition(vi.fn(), vi.fn()); recognition.start(); expect(mocks.capture).toHaveBeenCalledOnce();
    mocks.packet?.(frame(30)); await vi.advanceTimersByTimeAsync(0); const socket = Socket.instances[0]; socket.onopen?.();
    expect(socket.send).toHaveBeenCalledOnce(); expect(socket.url).toContain("Constrained?access_token=auth_tokens%2F");
    socket.message({ setupComplete: {} }); await recognition.ready;
    const audio = JSON.parse(socket.send.mock.calls[1][0]).realtimeInput.audio;
    expect(audio.mimeType).toBe("audio/pcm;rate=16000");
    const pcm = Buffer.from(audio.data, "base64"); expect(pcm.length).toBe(3200); expect(Math.abs(pcm.readInt16LE(20))).toBeGreaterThan(100);
    recognition.stop(); expect(mocks.stop).toHaveBeenCalledOnce(); expect(socket.close).toHaveBeenCalledOnce();
  });
  it("replaces interim text, commits the final once and reuses capture at turn boundaries", async () => {
    const { recognition, socket } = await connected();
    socket.message({ serverContent: { interimInputTranscription: { text: "What is a list" } } });
    socket.message({ serverContent: { interimInputTranscription: { text: "What is a linked list?" } } });
    socket.message({ serverContent: { inputTranscription: { text: "What is a linked list?" } } });
    socket.message({ serverContent: { generationComplete: true } });
    expect(recognition.onresult).toHaveBeenCalledTimes(3); expect(recognition.onresult).toHaveBeenLastCalledWith(expect.objectContaining({ results: [{ 0: { transcript: "What is a linked list?" }, isFinal: true, length: 1 }] }));
    expect(recognition.onend).toHaveBeenCalledOnce(); recognition.start(); expect(mocks.capture).toHaveBeenCalledOnce(); recognition.stop();
  });
  it("signals a pause without stopping capture and keeps silence silent", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 8; i++) mocks.packet?.(frame(0));
    const sent = socket.send.mock.calls.map(call => JSON.parse(call[0]));
    expect(sent.filter(value => value.realtimeInput?.audioStreamEnd)).toHaveLength(1);
    const silent = Buffer.from(sent.at(-1).realtimeInput.audio.data, "base64"); expect(silent.every(value => value === 0)).toBe(true);
    expect(mocks.stop).not.toHaveBeenCalled(); recognition.stop();
  });
  it("cancels token provisioning and ignores its late result on Stop", async () => {
    let resolve!: (value: unknown) => void; mocks.api.mockImplementation(() => new Promise(done => { resolve = done; }));
    const recognition = new StreamingRecognition(vi.fn(), vi.fn()); recognition.start(); await vi.advanceTimersByTimeAsync(0);
    const signal = mocks.api.mock.calls[0][1].signal; recognition.stop(); expect(signal.aborted).toBe(true);
    resolve({ token: "auth_tokens/late", expires_at: Date.now() + 10000 }); await vi.advanceTimersByTimeAsync(0); expect(Socket.instances).toHaveLength(0);
  });
  it.each(["broken", JSON.stringify({ error: { message: "private upstream details" } }), JSON.stringify({ serverContent: { inputTranscription: { text: 42 } } })])("stops with a safe explicit error for invalid messages", async raw => {
    const { recognition, socket } = await connected(); socket.onmessage?.({ data: raw });
    expect(recognition.onerror).toHaveBeenCalledWith({ error: "audio-capture", detail: expect.stringContaining("invalid response") }); expect(mocks.stop).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(recognition.onerror!).mock.calls)).not.toContain("private upstream");
  });
  it("bounds pending audio, handshake time and transport backpressure", async () => {
    const { recognition, socket } = await connected(); socket.bufferedAmount = 64001; mocks.packet?.(frame(30)); expect(recognition.onerror).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6020); expect(recognition.onerror).toHaveBeenCalled();
    const pending = new StreamingRecognition(vi.fn(), vi.fn()); pending.onerror = vi.fn(); pending.start(); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(8000); expect(pending.onerror).toHaveBeenCalled();
    const full = new StreamingRecognition(vi.fn(), vi.fn()); full.onerror = vi.fn(); full.start(); for (let i = 0; i < 61; i++) mocks.packet?.(frame(30)); expect(full.onerror).toHaveBeenCalled();
  });
  it("does not replay unacknowledged words on a broken connection", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); socket.onclose?.();
    expect(recognition.onerror).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining("repeat the last question") })); expect(mocks.stop).toHaveBeenCalledOnce();
  });
  it("drains a startup backlog without overtaking packets or overflowing the socket", async () => {
    const recognition = new StreamingRecognition(vi.fn(), vi.fn()); recognition.onerror = vi.fn(); recognition.start();
    for (let i = 0; i < 25; i++) mocks.packet?.(frame(20 + i));
    await vi.advanceTimersByTimeAsync(0); const socket = Socket.instances.at(-1)!; socket.onopen?.(); socket.message({ setupComplete: {} }); await recognition.ready;
    expect(socket.send).toHaveBeenCalledTimes(2); mocks.packet?.(frame(100));
    await vi.advanceTimersByTimeAsync(520); expect(socket.send).toHaveBeenCalledTimes(27); expect(recognition.onerror).not.toHaveBeenCalled(); recognition.stop();
  });
  it("renews at a quiet boundary without releasing hardware or replaying old audio", async () => {
    const { recognition, socket } = await connected(); await vi.advanceTimersByTimeAsync(8 * 60000);
    expect(socket.close).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(2); expect(mocks.capture).toHaveBeenCalledOnce();
    mocks.packet?.(frame(30)); const next = Socket.instances[1]; next.onopen?.(); next.message({ setupComplete: {} }); expect(next.send).toHaveBeenCalledTimes(2); recognition.stop();
  });
  it("does not renew across unfinished audio and stops before provider expiration", async () => {
    const { recognition } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 5; i++) mocks.packet?.(frame(0));
    await vi.advanceTimersByTimeAsync(8 * 60000); expect(Socket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1.5 * 60000); expect(recognition.onerror).toHaveBeenCalled();
  });
  it("renews when the provider final arrives before the local pause detector", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30));
    socket.message({ voiceActivity: { type: "ACTIVITY_START", audioOffset: "0s" } });
    socket.message({ serverContent: { inputTranscription: { text: "What is DBMS?" } } });
    for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    socket.message({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "0.5s" } });
    await vi.advanceTimersByTimeAsync(8 * 60000); expect(Socket.instances).toHaveLength(2); recognition.stop();
  });
  it("acknowledges an empty finalized non-speech segment but rejects lost interim text", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    socket.message({ voiceActivity: { type: "ACTIVITY_START", audioOffset: "0s" } });
    socket.message({ serverContent: { inputTranscription: { text: "" } } }); socket.message({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "0.5s" } }); await vi.advanceTimersByTimeAsync(8 * 60000);
    expect(Socket.instances).toHaveLength(2); recognition.stop();
    const next = await connected(); next.socket.message({ serverContent: { interimInputTranscription: { text: "What is Python?" } } }); next.socket.message({ serverContent: { inputTranscription: { text: "" } } }); expect(next.recognition.onerror).toHaveBeenCalled();
  });
  it("does not let a delayed final and cloud end acknowledge newer audio", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    for (let i = 0; i < 6; i++) mocks.packet?.(frame(30));
    socket.message({ serverContent: { inputTranscription: { text: "First question?" } } });
    socket.message({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "0.5s" } });
    for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    await vi.advanceTimersByTimeAsync(8 * 60000); expect(Socket.instances).toHaveLength(1); expect(socket.close).not.toHaveBeenCalled();
    socket.message({ goAway: { timeLeft: "30s" } }); expect(recognition.onerror).toHaveBeenCalled(); expect(Socket.instances).toHaveLength(1);
  });
  it("clears an empty final's old start time before later speech", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    socket.message({ serverContent: { inputTranscription: { text: "" } } }); await vi.advanceTimersByTimeAsync(11000);
    const now = Date.now(); mocks.packet?.(frame(30)); socket.message({ serverContent: { inputTranscription: { text: "What is a list?" } } });
    expect(recognition.onresult).toHaveBeenLastCalledWith(expect.objectContaining({ audio_start_ms: now - 100 })); recognition.stop();
  });
  it("waits for the authoritative final when cloud END arrives first", async () => {
    const { recognition, socket } = await connected(); mocks.packet?.(frame(30)); for (let i = 0; i < 4; i++) mocks.packet?.(frame(0));
    socket.message({ voiceActivity: { type: "ACTIVITY_START", audioOffset: "0s" } });
    socket.message({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "0.5s" } });
    await vi.advanceTimersByTimeAsync(8 * 60000); expect(Socket.instances).toHaveLength(1); expect(socket.close).not.toHaveBeenCalled();
    socket.message({ serverContent: { inputTranscription: { text: "Database means?" } } }); await vi.advanceTimersByTimeAsync(1000);
    expect(Socket.instances).toHaveLength(2); recognition.stop();
  });
});
