import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({ api: vi.fn(), stream: vi.fn(), audioStream: vi.fn(), captureStart: vi.fn(), captureStop: vi.fn(), ready: null as Promise<void> | null, onAudio: null as null | ((packet: ArrayBuffer) => void), onEnded: null as null | ((message: string) => void) }));
vi.mock("../lib/api", async importOriginal => ({ ...await importOriginal<typeof import("../lib/api")>(), api: doubles.api, streamApi: (path: string, ...args: unknown[]) => (path === "/live/transcribe" ? doubles.audioStream : doubles.stream)(path, ...args) }));
vi.mock("../lib/capture", () => ({ AudioCapture: class {
  ready: Promise<void>;
  constructor(mode: string, audio: (packet: ArrayBuffer) => void, ended: (message: string) => void) { doubles.captureStart(mode); doubles.onAudio = audio; doubles.onEnded = ended; this.ready = doubles.ready || Promise.resolve(); }
  stop() { doubles.captureStop(); }
} }));
import { LiveController, type LocalEvent } from "../lib/live-controller";
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
  doubles.stream.mockImplementation(async (path: string, options: RequestInit, onEvent: (value: unknown) => void) => {
    const result = await doubles.api(path, options); onEvent({ type: "complete", ...result });
  });
  doubles.audioStream.mockImplementation(async (path: string, options: RequestInit, onEvent: (value: unknown) => void) => {
    const result = await doubles.api(path, options); onEvent({ type: "complete", ...result });
  });
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

describe("English-only speech recognition and clean natural answer synthesis", () => {
  it("validates English speech and rejects foreign language scripts", () => {
    const live = new LiveController(vi.fn(), vi.fn());
    expect(live.isEnglishSpeech("What is a binary search tree?")).toBe(true);
    expect(live.isEnglishSpeech("I have 5 years of experience building microservices")).toBe(true);
    expect(live.isEnglishSpeech("Can you explain React useEffect hooks?")).toBe(true);

    // Foreign scripts: Cyrillic, Chinese, Arabic, Devanagari, Telugu
    expect(live.isEnglishSpeech("Что такое дерево поиска?")).toBe(false);
    expect(live.isEnglishSpeech("什么是二叉搜索树？")).toBe(false);
    expect(live.isEnglishSpeech("ما هي شجرة البحث الثنائية؟")).toBe(false);
    expect(live.isEnglishSpeech("बाइनरी सर्च ट्री क्या है?")).toBe(false);
    expect(live.isEnglishSpeech("బైనరీ సెర్చ్ ట్రీ అంటే ఏమిటి?")).toBe(false);
    expect(live.isEnglishSpeech("   ")).toBe(false);
    expect(live.isEnglishSpeech("???!!!")).toBe(false);
  });
});

describe("mobile voice buffering (predictable full-phrase capture)", () => {
  const memoryStorage = () => {
    const store = new Map<string, string>();
    return { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() };
  };
  class FakeRecognition {
    static instances: FakeRecognition[] = [];
    continuous = false; interimResults = false; lang = "";
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() { FakeRecognition.instances.push(this); }
    start() { /* listening */ }
    stop() { /* stopped */ }
  }
  type Chunk = { t: string; final: boolean };
  const speechEvent = (chunks: Chunk[], resultIndex = 0) => {
    const results: Record<string | number, unknown> = { length: chunks.length };
    chunks.forEach((chunk, i) => { results[i] = { 0: { transcript: chunk.t }, isFinal: chunk.final, length: 1 }; });
    return { resultIndex, results };
  };
  const startBrowserMode = async (notify: (event: LiveMessage | LocalEvent) => void, enhancedMicrophone = false, streamingMicrophone = false) => {
    FakeRecognition.instances = [];
    vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser");
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:3001", hostname: "localhost" },
      localStorage: memoryStorage(),
      SpeechRecognition: FakeRecognition,
    });
    doubles.api.mockImplementation(async (path: string) => {
      if (path === "/live/speech-ticket") return { token: "auth_tokens/unit-test", expires_at: Date.now() + 30 * 60000 };
      if (path === "/live/answer") return { answer: "A queue processes items in first in first out order.", evidence: [], keywords: [] };
      if (path === "/sessions") return { id: "session", status: "created" };
      if (String(path).endsWith("/ticket")) throw new ApiError("Unavailable", 503);
      return { id: "session", status: "ended" };
    });
    const live = new LiveController(notify, vi.fn());
    await live.start("microphone", "", false, { enhancedMicrophone, streamingMicrophone });
    expect(FakeRecognition.instances).toHaveLength(enhancedMicrophone || streamingMicrophone ? 0 : 1);
    return { live, rec: FakeRecognition.instances[0] };
  };

  const quietSpeechPackets = () => {
    for (let frame = 0; frame < 22; frame++) {
      const packet = new ArrayBuffer(3201); const view = new DataView(packet);
      if (frame < 10) for (let i = 0; i < 1600; i++) view.setInt16(1 + i * 2, Math.round(30 * Math.sin(i / 5)), true);
      doubles.onAudio?.(packet);
    }
  };
  it("accepts cloud-recognized quiet streaming speech after a manual choice even below the local activity threshold", async () => {
    const { live } = await startBrowserMode(vi.fn(), false, true); await vi.advanceTimersByTimeAsync(0);
    const socket = Socket.instances.at(-1)!; socket.open();
    const provider = (value: unknown) => socket.onmessage?.({ data: JSON.stringify(value) });
    provider({ setupComplete: {} }); quietSpeechPackets();
    provider({ serverContent: { inputTranscription: { text: "What is a list?" } } }); await vi.advanceTimersByTimeAsync(1000);
    live.askQuestion("What is DBMS?"); await vi.advanceTimersByTimeAsync(1000);
    const faint = new ArrayBuffer(3201); const view = new DataView(faint); for (let i = 0; i < 1600; i++) view.setInt16(1 + i * 2, Math.round(3 * Math.sin(i / 5)), true);
    doubles.onAudio?.(faint); provider({ serverContent: { inputTranscription: { text: "SQL means" } } }); await vi.advanceTimersByTimeAsync(500);
    expect(doubles.stream.mock.calls.some(([, options]) => JSON.parse(String(options.body)).question === "SQL means")).toBe(true); await live.stop();
  });
  it("keeps the next enhanced turn after a manual question at a completed audio boundary", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let segments = 0;
    doubles.api.mockImplementation(async (path: string) => path === "/live/transcribe" ? { text: ++segments === 1 ? "What is Python?" : "SQL means" } : { requests_answer: true, speaker_role: "unknown", question: "A requested definition", answer: "A simple technical definition with an example.", evidence: [], keywords: [] });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000); live.askQuestion("What is DBMS?"); await vi.advanceTimersByTimeAsync(1000);
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(String(doubles.stream.mock.calls.at(-1)![1].body)).question).toBe("SQL means"); await live.stop();
  });
  it("ignores pre-manual audio whose transcript arrives after the manual choice", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let resolve!: (value: unknown) => void;
    doubles.api.mockImplementation((path: string) => path === "/live/transcribe" ? new Promise(done => { resolve = done; }) : Promise.resolve({ requests_answer: true, speaker_role: "unknown", question: "What is DBMS?", answer: "A database management system.", evidence: [], keywords: [] }));
    quietSpeechPackets(); live.askQuestion("What is DBMS?"); await vi.advanceTimersByTimeAsync(1000);
    resolve({ text: "Abstract means" }); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream.mock.calls.map(([, options]) => JSON.parse(String(options.body)).question)).toEqual(["What is DBMS?"]); await live.stop();
  });
  it("submits a stable bare topic without waiting for Android's final transcript", async () => {
    const { live, rec } = await startBrowserMode(vi.fn());
    rec.onresult?.(speechEvent([{ t: "Abstract", final: false }]));
    await vi.advanceTimersByTimeAsync(500);
    expect(doubles.stream).toHaveBeenCalledOnce();
    expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).question).toBe("Abstract");
    rec.onresult?.(speechEvent([{ t: "Abstract", final: true }])); await vi.advanceTimersByTimeAsync(800);
    expect(doubles.stream).toHaveBeenCalledOnce(); await live.stop();
  });
  it("keeps consecutive means prompts separate when the next interim follows a final immediately", async () => {
    const { live, rec } = await startBrowserMode(vi.fn());
    rec.onresult?.(speechEvent([{ t: "Database means", final: false }])); await vi.advanceTimersByTimeAsync(500);
    rec.onresult?.(speechEvent([{ t: "Database means", final: true }]));
    rec.onresult?.(speechEvent([{ t: "Database means", final: true }, { t: "SQL means", final: false }], 1)); await vi.advanceTimersByTimeAsync(500);
    expect(doubles.stream.mock.calls.map(([, options]) => JSON.parse(String(options.body)).question)).toEqual(["Database means", "SQL means"]);
    rec.onresult?.(speechEvent([{ t: "Database means", final: true }, { t: "SQL means", final: true }], 1));
    rec.onresult?.(speechEvent([{ t: "Database means", final: true }, { t: "SQL means", final: true }, { t: "Python means", final: false }], 2)); await vi.advanceTimersByTimeAsync(500);
    expect(JSON.parse(String(doubles.stream.mock.calls.at(-1)![1].body)).question).toBe("Python means"); await live.stop();
  });
  it("lets a manual choice supersede old pending speech without losing the next keyword", async () => {
    const { live, rec } = await startBrowserMode(vi.fn());
    const old = "What is DBMS? What is DB? abstract class";
    rec.onresult?.(speechEvent([{ t: old, final: true }]));
    live.askQuestion("What is DBMS?"); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream.mock.calls.map(([, options]) => JSON.parse(String(options.body)).question)).toEqual(["What is DBMS?"]);
    rec.onresult?.(speechEvent([{ t: old, final: true }, { t: "SQL means", final: false }], 1)); await vi.advanceTimersByTimeAsync(500);
    expect(JSON.parse(String(doubles.stream.mock.calls.at(-1)![1].body)).question).toBe("SQL means"); await live.stop();
  });
  it("does not report an intentionally superseded answer as a timeout during a manual request", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify); let finishManual!: () => void;
    doubles.stream.mockImplementation((_path: string, options: RequestInit, onEvent: (event: unknown) => void) => {
      const question = JSON.parse(String(options.body)).question;
      if (question === "What is Python?") return new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
      return new Promise<void>(resolve => { finishManual = () => { onEvent({ type: "complete", requests_answer: true, speaker_role: "unknown", question, answer: "A database management system.", evidence: [], keywords: [] }); resolve(); }; });
    });
    rec.onresult?.(speechEvent([{ t: "What is Python?", final: true }])); await vi.advanceTimersByTimeAsync(500);
    live.askQuestion("What is DBMS?"); await vi.advanceTimersByTimeAsync(0);
    expect(notify.mock.calls.some(([event]) => event.type === "local" && /timed out/i.test(event.error || ""))).toBe(false);
    finishManual(); await vi.advanceTimersByTimeAsync(0); expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: "A database management system." })); await live.stop();
  });
  it("focuses the trailing abstract topic rather than searching a long candidate narration", async () => {
    const { live, rec } = await startBrowserMode(vi.fn());
    window.localStorage.setItem("interviewpilot_chunks_v1", JSON.stringify([{ id: "chunk", source_id: "cv", source_name: "resume.txt", project_id: null, text: "I built projects in Python and described my work with SQL.", locator: "Section 1" }]));
    const text = "Abstract classes okay. I built my project in Python. Tomorrow they concentrate on projects. What is DBMS? What is DB? what is DBMS abstract class";
    rec.onresult?.(speechEvent([{ t: text, final: false }])); await vi.advanceTimersByTimeAsync(500);
    const payload = JSON.parse(String(doubles.stream.mock.calls[0][1].body));
    expect(payload.question).toBe(text); expect(payload.request_focus).toBe("abstract class"); expect(payload.evidence).toEqual([]);
    rec.onresult?.(speechEvent([{ t: text, final: true }])); await vi.advanceTimersByTimeAsync(800);
    expect(doubles.stream).toHaveBeenCalledOnce(); await live.stop();
  });
  it("rejects an Enhanced prepared answer about the old topic when a new bare topic follows", async () => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true);
    doubles.api.mockImplementation(async (path: string) => path === "/live/transcribe" ? { text: "What is DBMS? abstract class", reply: { requests_answer: true, speaker_role: "unknown", question: "What is DBMS?", answer: "A database management system." } } : { requests_answer: true, speaker_role: "unknown", question: "What is an abstract class?", answer: "An abstract class defines an interface for subclasses.", evidence: [], keywords: [] });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(800);
    expect(doubles.stream).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(doubles.stream.mock.calls[0][1].body));
    expect(payload.question).toBe("What is DBMS? abstract class"); expect(payload.request_focus).toBe("abstract class");
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: expect.stringContaining("abstract class") })); await live.stop();
  });
  it("reuses a contextual audio answer without a second provider request", async () => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true);
    doubles.api.mockResolvedValue({ text: "What is a Python dictionary?", reply: { requests_answer: true, speaker_role: "unknown", question: "What is a Python dictionary?", answer: "A dictionary maps keys to values." } });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.api.mock.calls.filter(([path]) => path === "/live/transcribe")).toHaveLength(1);
    expect(doubles.stream).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: "A dictionary maps keys to values." }));
    await live.stop();
  });
  it("shows the streamed audio answer before completion without a second answer request", async () => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true);
    let finish: () => void = () => {};
    const text = "Okay what is Python?";
    const reply = { requests_answer: true, speaker_role: "unknown", question: "What is Python?", answer: "Python is" };
    doubles.audioStream.mockImplementation(async (_path: string, _options: RequestInit, onEvent: (value: unknown) => void) => {
      onEvent({ type: "preview", text, reply });
      await new Promise<void>(resolve => { finish = resolve; });
      onEvent({ type: "complete", text, reply: { ...reply, answer: "Python is a programming language." } });
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(500);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_delta", text: "Python is" }));
    expect(notify.mock.calls.filter(([event]) => event.type === "answer_complete")).toHaveLength(0);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: "Python is a programming language." }));
    expect(doubles.stream).not.toHaveBeenCalled(); await live.stop();
  });
  it("ignores late audio answer tokens after Stop", async () => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true);
    let finish: () => void = () => {}; let signal: AbortSignal | undefined;
    const text = "What is Python?"; const reply = { requests_answer: true, speaker_role: "unknown", question: text, answer: "Python is" };
    doubles.audioStream.mockImplementation(async (_path: string, options: RequestInit, onEvent: (value: unknown) => void) => {
      signal = options.signal as AbortSignal; onEvent({ type: "preview", text, reply });
      await new Promise<void>(resolve => { finish = resolve; });
      onEvent({ type: "complete", text, reply: { ...reply, answer: "Late answer." } });
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(500); await live.stop();
    expect(signal?.aborted).toBe(true); finish(); await vi.advanceTimersByTimeAsync(0);
    expect(notify.mock.calls.filter(([event]) => event.type === "answer_complete")).toHaveLength(0);
  });
  it.each(["provider error", "changed transcript", "changed decision"])("cancels a visible audio preview before capture ends on %s", async failure => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true);
    let finish: () => void = () => {};
    const text = "Write Python reversal code";
    const reply = { requests_answer: true, speaker_role: "unknown", question: text, answer: "```python\ndef unfinished(" };
    doubles.audioStream.mockImplementation(async (_path: string, _options: RequestInit, onEvent: (value: unknown) => void) => {
      onEvent({ type: "preview", text, reply });
      await new Promise<void>(resolve => { finish = resolve; });
      onEvent(failure === "provider error" ? { type: "error", detail: "Provider interrupted" } : failure === "changed transcript" ? { type: "complete", text: "What is Java?", reply: { ...reply, answer: "Unrelated Java answer." } } : { type: "complete", text, reply: { requests_answer: false, speaker_role: "user", question: "", answer: "" } });
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(500);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_delta", text: reply.answer }));
    finish(); await vi.advanceTimersByTimeAsync(0);
    const events = notify.mock.calls.map(([event]) => event);
    const cancelled = events.findIndex(event => event.type === "answer_cancelled");
    expect(cancelled).toBeGreaterThan(-1);
    expect(cancelled).toBeLessThan(events.findIndex(event => event.type === "local" && event.phase === "ended"));
    expect(events.filter(event => event.type === "answer_complete")).toHaveLength(0);
    expect(doubles.captureStop).toHaveBeenCalledOnce(); await live.stop();
  });
  it("keeps question-based evidence retrieval when uploaded sources are in use", async () => {
    const { live } = await startBrowserMode(vi.fn(), true);
    window.localStorage.setItem("interviewpilot_sources_v1", JSON.stringify([{ id: "source", name: "experience.txt", status: "ready" }]));
    doubles.api.mockImplementation(async (path: string) => path === "/live/transcribe" ? { text: "What is a Python dictionary?" } : { requests_answer: true, speaker_role: "unknown", question: "What is a dictionary?", answer: "A key-value mapping." });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(String(doubles.api.mock.calls.find(([path]) => path === "/live/transcribe")?.[1]?.body)).fast_answer).toBeUndefined();
    expect(doubles.stream).toHaveBeenCalledOnce(); await live.stop();
  });
  it("discards an audio answer generated with outdated answer preferences", async () => {
    const { live } = await startBrowserMode(vi.fn(), true);
    doubles.api.mockImplementation(async (path: string) => {
      if (path === "/live/transcribe") { live.setPreferences({ answer_style: "detailed" }); return { text: "What is a Python dictionary?", reply: { requests_answer: true, speaker_role: "unknown", question: "What is a dictionary?", answer: "Old concise answer." } }; }
      return { requests_answer: true, speaker_role: "unknown", question: "What is a dictionary?", answer: "A current detailed answer." };
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream).toHaveBeenCalledOnce();
    expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).preferences.answer_style).toBe("detailed"); await live.stop();
  });
  it("rechecks a contextual follow-up when the audio model conservatively declines to answer", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let segments = 0;
    doubles.api.mockImplementation(async (path: string) => {
      if (path === "/live/transcribe") return ++segments === 1 ? { text: "Implement reversal in Python", reply: { requests_answer: true, speaker_role: "unknown", question: "Implement reversal in Python", answer: "```python\ndef reverse(xs):\n    return xs[::-1]\n```" } } : { text: "Now in JavaScript", reply: { requests_answer: false, speaker_role: "unknown", question: "", answer: "" } };
      return { requests_answer: true, speaker_role: "unknown", question: "Implement reversal in JavaScript", answer: "```javascript\nconst reverse = xs => [...xs].reverse();\n```" };
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000); quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream).toHaveBeenCalledOnce();
    expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).question).toBe("Now in JavaScript"); await live.stop();
  });
  it("holds an incomplete enhanced question across transcription delays without restarting the microphone", async () => {
    const notify = vi.fn(); const { live } = await startBrowserMode(notify, true); let segments = 0;
    doubles.api.mockImplementation(async (path: string) => path === "/live/transcribe" ? { text: ++segments === 1 ? "what is" : "a Python dictionary?" } : { requests_answer: true, speaker_role: "unknown", question: "What is a Python dictionary?", answer: "A key-value mapping.", evidence: [], keywords: [] });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(5000);
    expect(doubles.stream).not.toHaveBeenCalled();
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream).toHaveBeenCalledOnce();
    expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).question).toBe("what is a Python dictionary?");
    expect(doubles.captureStart).toHaveBeenCalledOnce(); await live.stop(); expect(doubles.captureStop).toHaveBeenCalledOnce();
  });
  it("does not carry incomplete candidate narration into the next enhanced question", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let segments = 0;
    doubles.api.mockImplementation(async (path: string) => path === "/live/transcribe" ? { text: ++segments === 1 ? "I built the" : "What is a Python dictionary?" } : { requests_answer: false, speaker_role: "user", question: "", answer: "" });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000); quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream.mock.calls.map(([, options]) => JSON.parse(String(options.body)).question)).toEqual(["I built the", "What is a Python dictionary?"]);
    await live.stop();
  });
  it("retains a slow contextual language prefix across final recognition boundaries", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let segments = 0;
    doubles.api.mockImplementation(async (path: string) => {
      if (path === "/live/transcribe") return { text: ["Implement reversal in Python", "now in", "JavaScript"][segments++] };
      return { requests_answer: true, speaker_role: "unknown", question: "Implement reversal", answer: "```python\ndef reverse(xs):\n    return xs[::-1]\n```", evidence: [], keywords: [] };
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000); doubles.stream.mockClear();
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(3000); expect(doubles.stream).not.toHaveBeenCalled();
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(1000);
    expect(doubles.stream).toHaveBeenCalledOnce(); expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).question).toBe("now in JavaScript"); await live.stop();
  });
  it("uses capture times to retain a prompt continuation delayed by transcription", async () => {
    const { live } = await startBrowserMode(vi.fn(), true); let segments = 0; let complete: (value: unknown) => void = () => {};
    doubles.api.mockImplementation((path: string) => {
      if (path === "/live/transcribe") return ++segments === 1 ? Promise.resolve({ text: "Compare arrays with" }) : new Promise(resolve => { complete = resolve; });
      return Promise.resolve({ requests_answer: true, speaker_role: "unknown", question: "Compare arrays with linked lists", answer: "Arrays are contiguous; linked lists use pointers.", evidence: [], keywords: [] });
    });
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(5000);
    quietSpeechPackets(); await vi.advanceTimersByTimeAsync(11000);
    complete({ text: "linked lists" }); await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(String(doubles.stream.mock.calls[0][1].body)).question).toBe("Compare arrays with linked lists");
    await live.stop();
  });

  it("keeps continuous listening on (mobile emulated as narrow viewport has no bearing) and stitches split finals into one question", async () => {
    const notify = vi.fn();
    const { live, rec } = await startBrowserMode(notify);
    expect(rec.continuous).toBe(true);
    // First chunk finalizes early as "what is ".
    rec.onresult?.(speechEvent([{ t: "what is ", final: true }]));
    await vi.advanceTimersByTimeAsync(500);
    // Tail word arrives as the next final chunk in the same window.
    rec.onresult?.(speechEvent([{ t: "what is ", final: true }, { t: "algorithm", final: true }], 1));
    await vi.advanceTimersByTimeAsync(1300);
    const questions = notify.mock.calls.map(([event]) => event).filter(event => event.type === "question");
    expect(questions).toHaveLength(1);
    expect(questions[0].question.toLowerCase()).toContain("what is");
    expect(questions[0].question.toLowerCase()).toContain("algorithm");
    await live.stop();
  });

  it("does not drop a lone substantive word as filler", async () => {
    const notify = vi.fn();
    const { live, rec } = await startBrowserMode(notify);
    rec.onresult?.(speechEvent([{ t: "algorithm", final: true }]));
    await vi.advanceTimersByTimeAsync(1500);
    const questions = notify.mock.calls.map(([event]) => event).filter(event => event.type === "question");
    expect(questions).toHaveLength(1);
    expect(questions[0].question.toLowerCase()).toContain("algorithm");
    await live.stop();
  });

  it("does not replay consumed finals from a continuous recognition window", async () => {
    const notify = vi.fn();
    const { live, rec } = await startBrowserMode(notify);
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }]));
    await vi.advanceTimersByTimeAsync(1300);
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }, { t: "How does a stack differ?", final: true }], 1));
    await vi.advanceTimersByTimeAsync(1300);
    const questions = notify.mock.calls.map(([event]) => event).filter(event => event.type === "question");
    expect(questions.map(event => event.question)).toEqual(["What is a queue?", "How does a stack differ?"]);
    await live.stop();
  });
  it("waits for a complete request rather than answering an unfinished interim prefix", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    rec.onresult?.(speechEvent([{ t: "what is", final: false }]));
    await vi.advanceTimersByTimeAsync(1500);
    expect(doubles.stream).not.toHaveBeenCalled();
    rec.onresult?.(speechEvent([{ t: "what is a data structure", final: true }]));
    await vi.advanceTimersByTimeAsync(700);
    expect(notify.mock.calls.filter(([event]) => event.type === "question").map(([event]) => event.question)).toEqual(["what is a data structure"]);
    await live.stop();
  });
  it("answers an embedded question after candidate speech even while recognition remains interim", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    const speech = "The time complexity measures how execution grows with input size and predicts bottlenecks before production what is list";
    doubles.api.mockImplementation(async (path: string) => path === "/live/answer" ? { requests_answer: true, speaker_role: "unknown", question: "What is a list?", answer: "A list is an ordered collection of elements.", evidence: [], keywords: [] } : { id: "session", status: "ended" });
    rec.onresult?.(speechEvent([{ t: speech, final: false }]));
    await vi.advanceTimersByTimeAsync(700);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "question", question: "What is a list?" }));
    rec.onresult?.(speechEvent([{ t: speech, final: true }]));
    await vi.advanceTimersByTimeAsync(700);
    expect(doubles.stream).toHaveBeenCalledOnce();
    await live.stop();
  });
  it.each([{ text: "In Go", final: true }, { text: "Why?", final: false }, { text: "In C++", final: false }, { text: "In C#", final: false }])("submits contextual $text and includes prior code in structured memory", async followUp => {
    const { live, rec } = await startBrowserMode(vi.fn());
    doubles.api.mockImplementation(async () => ({ requests_answer: true, speaker_role: "unknown", question: "Implement reversal in Python without recursion", answer: "```python\ndef reverse(xs):\n    return xs[::-1]\n```", evidence: [], keywords: [] }));
    const first = { t: "Implement reversal in Python without recursion", final: true };
    rec.onresult?.(speechEvent([first])); await vi.advanceTimersByTimeAsync(800);
    rec.onresult?.(speechEvent([first, { t: followUp.text, final: followUp.final }], 1)); await vi.advanceTimersByTimeAsync(800);
    expect(doubles.stream).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(String(doubles.stream.mock.calls[1][1].body));
    expect(payload.interview_context.code_artifacts[0].code).toContain("xs[::-1]");
    expect(payload.interview_context.active_task.constraints.join(" ")).toContain("without recursion");
    expect(payload.history).toBeUndefined(); expect(payload.speechHistory).toBeUndefined();
    await live.stop();
  });
  it("resubmits a corrected C# final after a provisional C++ conversion", async () => {
    const { live, rec } = await startBrowserMode(vi.fn());
    const first = { t: "Implement reversal in Python", final: true };
    rec.onresult?.(speechEvent([first])); await vi.advanceTimersByTimeAsync(800);
    rec.onresult?.(speechEvent([first, { t: "In C++", final: false }], 1)); await vi.advanceTimersByTimeAsync(800);
    rec.onresult?.(speechEvent([first, { t: "In C#", final: true }], 1)); await vi.advanceTimersByTimeAsync(800);
    expect(doubles.stream.mock.calls.map(([, options]) => JSON.parse(String(options.body)).question)).toEqual([first.t, "In C++", "In C#"]);
    await live.stop();
  });
  it("does not regenerate a cumulative interim question as the candidate reads, and accepts the next question", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    rec.onresult?.(speechEvent([{ t: "What is a list?", final: false }]));
    await vi.advanceTimersByTimeAsync(700);
    rec.onresult?.(speechEvent([{ t: "What is a list? A list is an ordered collection", final: false }]));
    await vi.advanceTimersByTimeAsync(700);
    rec.onresult?.(speechEvent([{ t: "What is a list? A list is an ordered collection with indexed access", final: false }]));
    await vi.advanceTimersByTimeAsync(700);
    expect(doubles.stream).toHaveBeenCalledOnce();
    rec.onresult?.(speechEvent([{ t: "What is a list? A list is an ordered collection with indexed access what is a tuple?", final: false }]));
    await vi.advanceTimersByTimeAsync(700);
    expect(doubles.stream).toHaveBeenCalledTimes(2);
    await live.stop();
  });

  it("holds browser answers until the reader releases the answer lock", async () => {
    const notify = vi.fn();
    const { live, rec } = await startBrowserMode(notify);
    live.setAnswerLocked(true);
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }]));
    await vi.advanceTimersByTimeAsync(1300);
    expect(notify.mock.calls.filter(([event]) => event.type === "answer_complete")).toHaveLength(0);
    live.setAnswerLocked(false);
    expect(notify.mock.calls.filter(([event]) => event.type === "question")).toHaveLength(1);
    await live.stop();
  });

  it("stops the session when recognition permission is denied", async () => {
    const notify = vi.fn();
    const { live, rec } = await startBrowserMode(notify);
    rec.onerror?.({ error: "not-allowed" });
    await vi.advanceTimersByTimeAsync(500);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended" }));
    await live.stop();
  });

  it("keeps a pending interview answer when candidate narration arrives", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    let resolveQuestion: (value: unknown) => void = () => {};
    doubles.api.mockImplementation((path: string, options?: RequestInit) => {
      if (path !== "/live/answer") return Promise.resolve({ id: "session", status: "ended" });
      const body = JSON.parse(String(options?.body));
      if (body.question.startsWith("What")) return new Promise(resolve => { resolveQuestion = resolve; });
      return Promise.resolve({ requests_answer: false, speaker_role: "user", question: "", answer: "" });
    });
    rec.onresult?.(speechEvent([{ t: "What is caching?", final: true }]));
    await vi.advanceTimersByTimeAsync(1300);
    rec.onresult?.(speechEvent([{ t: "What is caching?", final: true }, { t: "I used Redis in my last project.", final: true }], 1));
    await vi.advanceTimersByTimeAsync(1300);
    const pendingSignal = doubles.api.mock.calls.find(([path, options]) => path === "/live/answer" && String(options?.body).includes("What is caching"))?.[1]?.signal;
    expect(pendingSignal?.aborted).toBe(false);
    resolveQuestion({ requests_answer: true, speaker_role: "unknown", question: "What is caching?", answer: "Caching stores reusable results to reduce repeated work.", evidence: [], keywords: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: expect.stringContaining("reusable") }));
    await live.stop();
  });
  it("displays incoming answer tokens before generation finishes", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    let finish: () => void = () => {};
    doubles.stream.mockImplementation(async (_path: string, _options: RequestInit, event: (value: unknown) => void) => {
      event({ type: "preview", question: "What is a queue?", answer: "A queue is", speaker_role: "unknown" });
      await new Promise<void>(resolve => { finish = resolve; });
      event({ type: "complete", requests_answer: true, question: "What is a queue?", answer: "A queue is first in first out.", speaker_role: "unknown", evidence: [], keywords: [] });
    });
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }]));
    await vi.advanceTimersByTimeAsync(1300);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_delta", text: "A queue is" }));
    expect(notify.mock.calls.filter(([event]) => event.type === "answer_complete")).toHaveLength(0);
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "answer_complete", answer: "A queue is first in first out." }));
    await live.stop();
  });

  it("ignores a stale answer after a newer question completes", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    let resolveFirst: (value: unknown) => void = () => {};
    doubles.api.mockImplementation((path: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body));
      if (body.question === "What is a queue?") return new Promise(resolve => { resolveFirst = resolve; });
      return Promise.resolve({ requests_answer: true, speaker_role: "unknown", question: "What is a stack?", answer: "A stack is last in first out.", evidence: [], keywords: [] });
    });
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }]));
    await vi.advanceTimersByTimeAsync(1300);
    rec.onresult?.(speechEvent([{ t: "What is a queue?", final: true }, { t: "What is a stack?", final: true }], 1));
    await vi.advanceTimersByTimeAsync(1300);
    resolveFirst({ requests_answer: true, speaker_role: "interviewer", question: "What is a queue?", answer: "Old answer", evidence: [], keywords: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(notify.mock.calls.filter(([event]) => event.type === "answer_complete").map(([event]) => event.answer)).toEqual(["A stack is last in first out."]);
    await live.stop();
  });

  it("gives each corrected cross-pause utterance its own transcript identity", async () => {
    const notify = vi.fn(); const { live, rec } = await startBrowserMode(notify);
    rec.onresult?.(speechEvent([{ t: "what is", final: true }]));
    await vi.advanceTimersByTimeAsync(2000);
    rec.onresult?.(speechEvent([{ t: "what is", final: true }, { t: "algorithm", final: true }], 1));
    await vi.advanceTimersByTimeAsync(1300);
    rec.onresult?.(speechEvent([{ t: "what is", final: true }, { t: "algorithm", final: true }, { t: "How does it work?", final: true }], 2));
    await vi.advanceTimersByTimeAsync(1300);
    const final = notify.mock.calls.map(([event]) => event).filter(event => event.type === "transcript" && event.final);
    const corrected = final.find(event => event.text === "what is algorithm");
    const followup = final.find(event => event.text === "How does it work?");
    expect(corrected).toBeDefined(); expect(followup).toBeDefined(); expect(corrected?.id).not.toBe(followup?.id);
    await live.stop();
  });
});
