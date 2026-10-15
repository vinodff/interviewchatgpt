import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({ api: vi.fn(), captureStart: vi.fn(), captureStop: vi.fn(), ready: null as Promise<void> | null, onAudio: null as null | ((packet: ArrayBuffer) => void), onEnded: null as null | ((message: string) => void) }));
vi.mock("../lib/api", async importOriginal => ({ ...await importOriginal<typeof import("../lib/api")>(), api: doubles.api }));
vi.mock("../lib/capture", () => ({ AudioCapture: class {
  ready: Promise<void>;
  constructor(mode: string, audio: (packet: ArrayBuffer) => void, ended: (message: string) => void) { doubles.captureStart(mode); doubles.onAudio = audio; doubles.onEnded = ended; this.ready = doubles.ready || Promise.resolve(); }
  stop() { doubles.captureStop(); }
} }));
import { LiveController } from "../lib/live-controller";
import { ApiError } from "../lib/api";
import type { LiveMessage } from "../lib/protocol";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0; bufferedAmount = 0;
  onopen: (() => void) | null = null; onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor(public url: string) { Socket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(message: LiveMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
  disconnect(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}
const question = (id: string): LiveMessage => ({ type: "question", generation_id: id, question: `Question ${id}?`, keywords: [] });
const delta = (id: string, text: string): LiveMessage => ({ type: "answer_delta", generation_id: id, text });
const complete = (id: string, answer: string): LiveMessage => ({ type: "answer_complete", generation_id: id, answer, evidence: [], keywords: [], latency_ms: 100 });

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); doubles.ready = null; Socket.instances = [];
  vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
  vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:3001", hostname: "localhost" } });
  vi.stubGlobal("WebSocket", Socket);
  doubles.api.mockImplementation(async (path: string) => path === "/sessions" ? { id: "session", status: "created" } : path.endsWith("/ticket") ? { ticket: `ticket-${doubles.api.mock.calls.length}` } : { id: "session", status: "ended" });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("authenticated backend transport on every hostname", () => {
  it.each(["localhost:3001", "127.0.0.1:3001", "interview.example.com"])("uses audio capture and a real ticket on %s without browser or stored-data access", async host => {
    const storage = vi.fn(() => { throw new Error("Storage must not be accessed"); });
    const recognition = vi.fn(() => { throw new Error("Browser speech must not be started"); });
    vi.stubGlobal("window", { location: { protocol: host.includes("example") ? "https:" : "http:", host, hostname: host.split(":")[0] }, get localStorage() { return storage(); }, SpeechRecognition: recognition, webkitSpeechRecognition: recognition });
    const live = new LiveController(vi.fn(), vi.fn()); const pending = live.start("tab", "Interview", true);
    expect(doubles.captureStart).toHaveBeenCalledWith("tab"); expect(doubles.api).not.toHaveBeenCalled();
    await pending;
    expect(doubles.api.mock.calls.map(([path]) => path)).toEqual(["/sessions", "/sessions/session/ticket"]);
    expect(Socket.instances[0].url).toContain(`${host}/api/live/session/ws?ticket=`);
    expect(storage).not.toHaveBeenCalled(); expect(recognition).not.toHaveBeenCalled(); await live.stop();
  });

  it("keeps server speaker labels and question text exactly instead of classifying topic keywords in the browser", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false);
    const ws = Socket.instances[0];
    ws.message({ type: "transcript", id: "t", role: "unknown", text: "dictionary key value pairs", final: true });
    ws.message({ type: "transcript", id: "u", role: "user", text: "What I built was a queue.", final: true });
    ws.message({ type: "question", generation_id: "q", question: "Could you explain the durable retries?", keywords: ["retries"] });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "transcript", role: "unknown" }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "transcript", role: "user" }));
    expect(notify.mock.calls.filter(([event]) => event.type === "question")).toEqual([[expect.objectContaining({ question: "Could you explain the durable retries?" })]]);
    expect(doubles.api.mock.calls.every(([path]) => !String(path).includes("generate"))).toBe(true); await live.stop();
  });
});

describe("connection ownership, bounded recovery and disposal", () => {
  it("refreshes one-use tickets on reconnect without creating another session or capture", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("tab", "Interview", true);
    const first = Socket.instances[0]; first.open(); const audio = new ArrayBuffer(3201);
    doubles.onAudio?.(audio); expect(first.send).toHaveBeenCalledWith(audio);
    first.bufferedAmount = 63000; doubles.onAudio?.(audio); expect(first.send.mock.calls.filter(([data]) => data === audio)).toHaveLength(1);
    first.disconnect(); await vi.advanceTimersByTimeAsync(750);
    expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1].url).not.toBe(first.url);
    expect(doubles.captureStart).toHaveBeenCalledOnce(); expect(doubles.api.mock.calls.filter(([path]) => path === "/sessions")).toHaveLength(1);
    await live.stop(); await vi.advanceTimersByTimeAsync(120000); expect(Socket.instances).toHaveLength(2);
  });

  it("preserves terminal 409 handling and never creates another session", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false);
    doubles.api.mockRejectedValue(new ApiError("This session has ended", 409)); Socket.instances[0].disconnect();
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.stringMatching(/session has ended.*start a new session/i) }));
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(2);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(0);
    expect(doubles.api.mock.calls.filter(([path]) => path === "/sessions")).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 405, 410, 422])("treats HTTP %i tickets as terminal without mutating another active connection", async status => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    doubles.api.mockRejectedValue(new ApiError("Refused", status)); Socket.instances[0].disconnect();
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(2);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(0);
  });

  it("does not stop another browser’s session after a duplicate WebSocket refusal", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("tab", "", false);
    Socket.instances[0].disconnect(4409); await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.stringMatching(/already active|another browser/i) }));
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(0);
  });

  it.each([408, 429, 500, 503, 0])("bounds transient HTTP/network %i retries and stops capture after exhaustion", async status => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false);
    doubles.api.mockImplementation(async (path: string) => { if (path.endsWith("/ticket")) throw new ApiError("Unavailable", status); return { id: "session", status: "ended" }; });
    Socket.instances[0].disconnect(); await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(9);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/several reconnect attempts/i) }));
    const calls = doubles.api.mock.calls.length; await vi.advanceTimersByTimeAsync(120000); expect(doubles.api.mock.calls).toHaveLength(calls);
  });

  it("recovers an initial transient ticket failure without changing session ownership", async () => {
    doubles.api.mockImplementationOnce(async () => ({ id: "session", status: "created" })).mockRejectedValueOnce(new ApiError("Unavailable", 503));
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    expect(Socket.instances).toHaveLength(0); await vi.advanceTimersByTimeAsync(750); expect(Socket.instances).toHaveLength(1);
    expect(doubles.captureStart).toHaveBeenCalledOnce(); await live.stop();
  });

  it("resets retry backoff when an actual transcription channel starts listening", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("tab", "", false);
    Socket.instances[0].disconnect(); await vi.advanceTimersByTimeAsync(750);
    const second = Socket.instances[1]; second.open();
    second.onmessage?.({ data: JSON.stringify({ type: "transcription_status", channel: 1, state: "listening", detail: "Microphone transcription online" }) });
    second.disconnect(); await vi.advanceTimersByTimeAsync(750);
    expect(Socket.instances).toHaveLength(3); await live.stop();
  });

  it("stops immediately on terminal server errors and on revoked capture", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    Socket.instances[0].message({ type: "error", code: "quota", message: "Usage limit reached", recoverable: false });
    await vi.advanceTimersByTimeAsync(120000); expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(1);
    expect(Socket.instances).toHaveLength(1);
  });

  it("disposes all transport timers and capture on browser permission revocation", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("tab", "", true); Socket.instances[0].open();
    doubles.onEnded?.("Permission revoked"); await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce(); expect(Socket.instances[0].close).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(1);
  });

  it("stops capture and cancels a pending retry without opening a late ticket", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    let finish!: (value: { ticket: string }) => void; let signal: AbortSignal | undefined;
    doubles.api.mockImplementationOnce((_path: string, options: RequestInit) => { signal = options.signal as AbortSignal; return new Promise(resolve => { finish = resolve; }); });
    Socket.instances[0].disconnect(); await vi.advanceTimersByTimeAsync(750); await live.stop();
    expect(signal?.aborted).toBe(true); finish({ ticket: "late" }); await vi.advanceTimersByTimeAsync(120000);
    expect(Socket.instances).toHaveLength(1); expect(doubles.captureStop).toHaveBeenCalledOnce();
  });

  it("closes a session created after Stop without reopening capture or reporting a stale created state", async () => {
    let create!: (value: { id: string; status: string }) => void;
    doubles.api.mockImplementationOnce(() => new Promise(resolve => { create = resolve; }));
    const onSession = vi.fn(); const live = new LiveController(vi.fn(), onSession); const start = live.start("microphone", "", true);
    await Promise.resolve(); await live.stop(); create({ id: "session", status: "created" }); await start;
    expect(onSession).toHaveBeenCalledTimes(1); expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ status: "ended" }));
    expect(Socket.instances).toHaveLength(0); expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(1);
  });

  it("does not make any HTTP request if Stop precedes capture permission completion", async () => {
    let ready!: () => void; doubles.ready = new Promise(resolve => { ready = resolve; });
    const live = new LiveController(vi.fn(), vi.fn()); const start = live.start("microphone", "", false); await live.stop(); ready(); await start;
    expect(doubles.api).not.toHaveBeenCalled(); expect(doubles.captureStop).toHaveBeenCalledOnce();
  });

  it("ignores stale socket events after reconnect and cleans up a stalled handshake", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false);
    const first = Socket.instances[0]; const oldMessage = first.onmessage; first.disconnect(); await vi.advanceTimersByTimeAsync(750);
    notify.mockClear(); oldMessage?.({ data: JSON.stringify(question("stale")) }); expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000); await vi.advanceTimersByTimeAsync(1500);
    expect(Socket.instances).toHaveLength(3); await live.stop();
  });

  it("attempts the real remote stop even if the capture or WebSocket cleanup throws", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false); Socket.instances[0].open();
    doubles.captureStop.mockImplementationOnce(() => { throw new Error("Cleanup failed"); }); Socket.instances[0].send.mockImplementationOnce(() => { throw new Error("Transport failed"); });
    await live.stop(); expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(1); expect(Socket.instances[0].close).toHaveBeenCalledOnce();
  });
});

describe("display-only answer hold", () => {
  it("keeps transcripts and status flowing while holding only the latest generation", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", true); const ws = Socket.instances[0];
    ws.message(question("first")); ws.message(complete("first", "First answer")); live.setAnswerLocked(true); notify.mockClear();
    ws.message(question("second")); ws.message(delta("second", "old partial")); ws.message(question("latest"));
    ws.message(delta("second", "late stale text")); ws.message(delta("latest", "Current")); ws.message(complete("latest", "Latest answer"));
    ws.message({ type: "transcript", id: "user", role: "user", text: "My experience…", final: true }); ws.message({ type: "status", state: "listening" });
    expect(notify.mock.calls.map(([event]) => event.type)).toEqual(["transcript", "status"]);
    live.setAnswerLocked(false);
    expect(notify.mock.calls.slice(2)).toEqual([[question("latest")], [complete("latest", "Latest answer")]]);
    await live.stop();
  });

  it("holds new tokens in an already displayed generation without replaying its question", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false); const ws = Socket.instances[0];
    ws.message(question("g")); ws.message(delta("g", "Shown ")); live.setAnswerLocked(true); notify.mockClear();
    ws.message(delta("g", "held ")); ws.message(delta("g", "tokens")); live.setAnswerLocked(false);
    expect(notify.mock.calls).toEqual([[delta("g", "held tokens")]]); await live.stop();
  });

  it("forwards channel renewal statuses during a hold without clearing the current generation", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("tab", "", false); const ws = Socket.instances[0];
    ws.message(question("g")); live.setAnswerLocked(true); notify.mockClear();
    const reconnecting = { type: "transcription_status", channel: 0, state: "reconnecting", detail: "Renewing interviewer transcription" };
    const listening = { type: "transcription_status", channel: 0, state: "listening", detail: "Interviewer transcription resumed" };
    ws.onmessage?.({ data: JSON.stringify(reconnecting) }); ws.onmessage?.({ data: JSON.stringify(listening) });
    ws.message(complete("g", "Current answer")); live.setAnswerLocked(false);
    expect(notify.mock.calls).toEqual([[reconnecting], [listening], [complete("g", "Current answer")]]); await live.stop();
  });

  it("honors cancellation and never resurrects a held answer after reconnect", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false); const ws = Socket.instances[0];
    ws.message(question("g")); live.setAnswerLocked(true); notify.mockClear(); ws.message({ type: "answer_cancelled", generation_id: "g" }); ws.message(complete("g", "Stale")); live.setAnswerLocked(false);
    expect(notify.mock.calls).toEqual([[{ type: "answer_cancelled", generation_id: "g" }]]);
    live.setAnswerLocked(true); ws.message(question("new")); ws.message(complete("new", "Held")); ws.message({ type: "status", state: "reconnecting" }); notify.mockClear(); live.setAnswerLocked(false);
    expect(notify).not.toHaveBeenCalled(); await live.stop();
  });

  it("bounds queued answer memory and never invents a replacement answer on overflow", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn()); await live.start("microphone", "", false); const ws = Socket.instances[0];
    live.setAnswerLocked(true); ws.message(question("g")); ws.message(delta("g", "x".repeat(128001))); notify.mockClear(); live.setAnswerLocked(false);
    expect(notify).not.toHaveBeenCalled(); await live.stop();
  });
});
