import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({ api: vi.fn(), stream: vi.fn(), captureStart: vi.fn() }));
vi.mock("../lib/api", async importOriginal => ({ ...await importOriginal<typeof import("../lib/api")>(), api: doubles.api, streamApi: doubles.stream }));
vi.mock("../lib/capture", () => ({ AudioCapture: class {
  ready = Promise.resolve();
  constructor(mode: string) { doubles.captureStart(mode); }
  stop() { /* stopped */ }
} }));
import { LiveController, type LocalEvent } from "../lib/live-controller";
import type { LiveMessage } from "../lib/protocol";

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
const memoryStorage = () => { const store = new Map<string, string>(); return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() }; };
const finalSpeech = (text: string) => ({ resultIndex: 0, results: { length: 1, 0: { 0: { transcript: text }, isFinal: true, length: 1 } } });
const answers = (notify: ReturnType<typeof vi.fn>) => notify.mock.calls.map(([event]) => event as LiveMessage | LocalEvent).filter((event): event is Extract<LiveMessage, { type: "answer_complete" }> => event.type === "answer_complete");
const askedQuestions = () => doubles.stream.mock.calls.filter(([path]) => path === "/live/answer").map(([, options]) => JSON.parse(String((options as RequestInit).body)).question);

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); FakeRecognition.instances = [];
  vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser");
  vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:3001", hostname: "localhost" }, localStorage: memoryStorage(), SpeechRecognition: FakeRecognition });
  doubles.api.mockImplementation(async (path: string) => {
    if (path === "/live/answer") return { requests_answer: true, speaker_role: "interviewer", question: "What is a queue?", answer: "A queue processes items first in, first out.", evidence: [], keywords: [] };
    if (path === "/live/analyze") return { question: "Reverse a list in Python", answer: "```python\nxs[::-1]\n```" };
    if (path === "/live/speech-ticket") return { token: "auth_tokens/unit-test", expires_at: Date.now() + 60000 };
    return undefined;
  });
  doubles.stream.mockImplementation(async (path: string, options: RequestInit, onEvent: (value: unknown) => void) => {
    const result = await doubles.api(path, options);
    onEvent({ type: "complete", ...result });
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function startDesktop(notify = vi.fn(), options: Parameters<LiveController["start"]>[3] = {}) {
  const live = new LiveController(notify, vi.fn());
  await live.start("microphone", "Desktop", true, { keepListeningInBackground: true, ...options });
  return { live, notify, rec: FakeRecognition.instances[0] };
}

describe("desktop auto-answer switch", () => {
  it("holds a heard question until Answer is pressed, without echoing it as a new transcript", async () => {
    const { live, notify, rec } = await startDesktop(vi.fn(), { autoAnswer: false });
    rec.onresult?.(finalSpeech("What is a queue?")); await vi.advanceTimersByTimeAsync(1500);
    expect(askedQuestions()).toEqual([]);
    expect(notify).toHaveBeenCalledWith({ type: "local", pendingQuestion: "What is a queue?" });
    const transcriptsBefore = notify.mock.calls.filter(([event]) => event.type === "transcript").length;
    expect(live.answerLatest("ignored fallback")).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(askedQuestions()).toEqual(["What is a queue?"]);
    expect(notify.mock.calls.filter(([event]) => event.type === "transcript")).toHaveLength(transcriptsBefore);
    expect(answers(notify)).toHaveLength(1);
    await live.stop();
  });

  it("uses the caller's transcript when nothing is pending, and reports when there is nothing to answer", async () => {
    const { live } = await startDesktop(vi.fn(), { autoAnswer: false });
    expect(live.answerLatest("")).toBe(false);
    expect(live.answerLatest("Explain recursion")).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(askedQuestions()).toEqual(["Explain recursion"]);
    await live.stop();
  });

  it("answers automatically again once auto-answer is switched back on", async () => {
    const { live, rec } = await startDesktop(vi.fn(), { autoAnswer: false });
    live.setAutoAnswer(true);
    rec.onresult?.(finalSpeech("What is a stack?")); await vi.advanceTimersByTimeAsync(1500);
    expect(askedQuestions()).toEqual(["What is a stack?"]);
    await live.stop();
  });
});

describe("desktop evidence scope", () => {
  it("skips knowledge search entirely when the session has no resume or documents", async () => {
    const { live } = await startDesktop(vi.fn(), { knowledgeSources: [] });
    live.askQuestion("Tell me about your project"); await vi.advanceTimersByTimeAsync(500);
    expect(doubles.api.mock.calls.some(([path]) => String(path).startsWith("/knowledge/search"))).toBe(false);
    await live.stop();
  });

  it("limits knowledge search to the selected sources", async () => {
    const { live } = await startDesktop(vi.fn(), { knowledgeSources: ["11111111-1111-1111-1111-111111111111"] });
    live.askQuestion("Tell me about your project"); await vi.advanceTimersByTimeAsync(500);
    const search = doubles.api.mock.calls.map(([path]) => String(path)).find(path => path.startsWith("/knowledge/search"));
    expect(search).toContain("&sources=11111111-1111-1111-1111-111111111111");
    await live.stop();
  });
});

describe("desktop capture and background listening", () => {
  it("keeps listening when the window is hidden instead of stopping the session", async () => {
    const listeners = vi.fn();
    vi.stubGlobal("document", { hidden: true, addEventListener: listeners, removeEventListener: vi.fn() });
    const { live } = await startDesktop();
    expect(listeners).not.toHaveBeenCalledWith("visibilitychange", expect.anything());
    await live.stop();
    const { live: web } = await startDesktop(vi.fn(), { keepListeningInBackground: false });
    expect(listeners).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    await web.stop();
  });

  it("feeds streaming recognition from the supplied capture instead of opening the plain microphone", async () => {
    const stop = vi.fn();
    const createCapture = vi.fn(() => ({ ready: Promise.resolve(), stop }));
    const { live } = await startDesktop(vi.fn(), { streamingMicrophone: true, createCapture });
    expect(createCapture).toHaveBeenCalledOnce();
    expect(doubles.captureStart).not.toHaveBeenCalled();
    await live.stop();
    expect(stop).toHaveBeenCalled();
  });
});

describe("desktop screen analysis", () => {
  it("delivers the on-screen task as a question with its answer and saves the turn", async () => {
    const { live, notify } = await startDesktop();
    await live.analyzeImage({ image: "AAAA", mime: "image/jpeg" });
    const analyze = doubles.stream.mock.calls.find(([path]) => path === "/live/analyze");
    expect(JSON.parse(String((analyze?.[1] as RequestInit).body))).toMatchObject({ image: "AAAA", mime: "image/jpeg" });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "question", question: "Reverse a list in Python" }));
    expect(answers(notify)[0]?.answer).toContain("xs[::-1]");
    await live.stop();
  });

  it("explains when nothing on screen could be answered", async () => {
    doubles.api.mockImplementation(async (path: string) => path === "/live/analyze" ? { question: "", answer: "" } : undefined);
    const { live, notify } = await startDesktop();
    await live.analyzeImage({ image: "AAAA", mime: "image/png" });
    expect(answers(notify)).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "local", error: "No question or task was found on your screen." }));
    await live.stop();
  });
});
