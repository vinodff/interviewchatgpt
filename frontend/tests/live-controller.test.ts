import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({ api: vi.fn(), captureStart: vi.fn(), captureStop: vi.fn(), onAudio: null as null | ((packet: ArrayBuffer) => void) }));
vi.mock("../lib/api", async importOriginal => ({ ...await importOriginal<typeof import("../lib/api")>(), api: doubles.api }));
vi.mock("../lib/capture", () => ({ AudioCapture: class { ready = Promise.resolve(); constructor(_mode: string, audio: (packet: ArrayBuffer) => void) { doubles.captureStart(); doubles.onAudio = audio; } stop() { doubles.captureStop(); } } }));
import { LiveController, mergeUtterances, cleanQuestion, isLikelyQuestion } from "../lib/live-controller";
import { findMatchingTopic, generateHumanAnswer, isCodeRequest } from "../lib/knowledge-engine";
import { ApiError } from "../lib/api";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1; bufferedAmount = 0;
  onopen: (() => void) | null = null; onclose: ((event: { code: number }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null; onerror = null;
  send = vi.fn(); close = vi.fn();
  constructor(public url: string) { Socket.instances.push(this); }
}
describe("live connection lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); Socket.instances = [];
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:3000" } }); vi.stubGlobal("WebSocket", Socket);
    doubles.api.mockImplementation(async (path: string) => path === "/sessions" ? { id: "session", status: "created" } : path.endsWith("/ticket") ? { ticket: `ticket-${doubles.api.mock.calls.length}` } : { id: "session", status: "ended" });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("requests capture before any HTTP call, refreshes tickets on reconnect, and bounds output", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn());
    const pending = live.start("tab", "Interview", true);
    expect(doubles.captureStart).toHaveBeenCalledOnce(); expect(doubles.api).not.toHaveBeenCalled();
    await pending;
    const first = Socket.instances[0]; first.onopen?.();
    const audio = new ArrayBuffer(3201); doubles.onAudio?.(audio); expect(first.send).toHaveBeenCalledWith(audio);
    first.bufferedAmount = 64000; doubles.onAudio?.(audio); expect(first.send.mock.calls.filter(call => call[0] === audio)).toHaveLength(1);
    first.onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(750);
    expect(Socket.instances).toHaveLength(2); expect(Socket.instances[1].url).not.toBe(first.url);
    expect(doubles.captureStart).toHaveBeenCalledOnce();
    await live.stop(); expect(doubles.captureStop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000); expect(Socket.instances).toHaveLength(2);
  });
  it("stops resources after a terminal server error instead of reconnecting", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: "error", code: "quota", message: "Usage limit reached", recoverable: false }) });
    await vi.advanceTimersByTimeAsync(60000);
    expect(doubles.captureStop).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(1);
    expect(doubles.api).toHaveBeenCalledWith("/sessions/session/stop", expect.anything());
  });
  it("ends a closed session after one rejected reconnect ticket and asks for a new session", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn());
    await live.start("microphone", "", false);
    doubles.api.mockRejectedValue(new ApiError("This session has ended", 409));
    Socket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(750);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.stringMatching(/session has ended.*start a new session/i) }));
    const requests = doubles.api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls).toHaveLength(requests);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(2);
    expect(doubles.api.mock.calls.filter(([path]) => path === "/sessions")).toHaveLength(1);
    expect(Socket.instances).toHaveLength(1);
  });
  it.each([400, 401, 403, 404, 405, 410, 422])("stops reconnecting on a terminal HTTP %i without further session mutations", async status => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn());
    await live.start("microphone", "", false);
    doubles.api.mockRejectedValue(new ApiError("The ticket was refused", status));
    Socket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(2);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.any(String) }));
    expect(Socket.instances).toHaveLength(1);
  });
  it("stops a refused duplicate WebSocket without ending the other browser's session", async () => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn());
    await live.start("tab", "", false);
    Socket.instances[0].onclose?.({ code: 4409 });
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(1);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/stop"))).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.stringMatching(/already active|another browser/i) }));
  });
  it.each([
    ["HTTP 408", new ApiError("Request timed out", 408)],
    ["HTTP 429", new ApiError("Too many requests", 429)],
    ["HTTP 500", new ApiError("Server failed", 500)],
    ["HTTP 503", new ApiError("Service unavailable", 503)],
    ["network failure", new TypeError("Failed to fetch")],
  ])("keeps %s retries bounded and releases capture after exhaustion", async (_name, failure) => {
    const notify = vi.fn(); const live = new LiveController(notify, vi.fn());
    await live.start("microphone", "", false);
    doubles.api.mockImplementation(async (path: string) => { if (path.endsWith("/ticket")) throw failure; return { id: "session", status: "ended" }; });
    Socket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls.filter(([path]) => path.endsWith("/ticket"))).toHaveLength(9);
    expect(doubles.captureStop).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ phase: "ended", error: expect.stringMatching(/several reconnect attempts/i) }));
    const requests = doubles.api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls).toHaveLength(requests);
  });
  it("recovers from a temporary 503 using the same capture and session", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    doubles.api.mockRejectedValueOnce(new ApiError("Service unavailable", 503));
    Socket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(750);
    expect(doubles.captureStop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(Socket.instances).toHaveLength(2);
    expect(doubles.captureStart).toHaveBeenCalledOnce();
    expect(doubles.api.mock.calls.filter(([path]) => path === "/sessions")).toHaveLength(1);
    await live.stop();
  });
  it("cancels a pending retry when the user stops capture", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    Socket.instances[0].onclose?.({ code: 1006 });
    await live.stop(); const requests = doubles.api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls).toHaveLength(requests);
    expect(doubles.captureStop).toHaveBeenCalledOnce(); expect(Socket.instances).toHaveLength(1);
  });
  it("does not open a late reconnect ticket after manual stop", async () => {
    const live = new LiveController(vi.fn(), vi.fn()); await live.start("microphone", "", false);
    let finishTicket!: (value: { ticket: string }) => void;
    doubles.api.mockImplementationOnce(() => new Promise(resolve => { finishTicket = resolve; }));
    Socket.instances[0].onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(750);
    await live.stop(); const requests = doubles.api.mock.calls.length;
    finishTicket({ ticket: "late" });
    await vi.advanceTimersByTimeAsync(120000);
    expect(doubles.api.mock.calls).toHaveLength(requests);
    expect(Socket.instances).toHaveLength(1); expect(doubles.captureStop).toHaveBeenCalledOnce();
  });
});

describe("smart utterance deduplication and question cleaning", () => {
  it("merges progressive speech recognition hypotheses without stuttering", () => {
    // Exact sequence from User Screenshot 1:
    let utterance = "";
    utterance = mergeUtterances(utterance, "ok can you write the");
    expect(utterance).toBe("ok can you write the");

    utterance = mergeUtterances(utterance, "ok can you write the");
    expect(utterance).toBe("ok can you write the");

    utterance = mergeUtterances(utterance, "ok can you write the python");
    expect(utterance).toBe("ok can you write the python");

    utterance = mergeUtterances(utterance, "ok can you write the python code");
    expect(utterance).toBe("ok can you write the python code");

    utterance = mergeUtterances(utterance, "ok can you write the python code for");
    expect(utterance).toBe("ok can you write the python code for");

    utterance = mergeUtterances(utterance, "ok can you write the python code for linked list");
    expect(utterance).toBe("ok can you write the python code for linked list");
  });

  it("merges restarted and overlapping question fragments without repeating phrases", () => {
    // Exact sequence from User Screenshot 2:
    let utterance = "can you";
    utterance = mergeUtterances(utterance, "so how can you");
    utterance = mergeUtterances(utterance, "so how can you implement");
    utterance = mergeUtterances(utterance, "so how can you implement the");
    utterance = mergeUtterances(utterance, "so how can you implement the");
    utterance = mergeUtterances(utterance, "so how can you implement the dictionary");
    utterance = mergeUtterances(utterance, "so how can you implement the dictionary in");
    utterance = mergeUtterances(utterance, "so how can you implement the dictionary in Python");

    expect(utterance).toBe("so how can you implement the dictionary in Python");
  });

  it("cleans conversational prefixes and collapses speech stutters", () => {
    const raw = "okay let me know how can you how can you implement the dictionary in Python";
    const cleaned = cleanQuestion(raw);
    expect(cleaned).toBe("how can you implement the dictionary in Python");
  });

  it("prioritizes linked list topic over generic list vs tuple topic", () => {
    const topic = findMatchingTopic("ok can you write the python code for linked list");
    expect(topic).not.toBeNull();
    expect(topic?.title).toBe("Linked List in Python");

    const dictTopic = findMatchingTopic("so how can you implement the dictionary in Python");
    expect(dictTopic).not.toBeNull();
    expect(dictTopic?.title).toBe("Python Dictionary");
  });

  it("isLikelyQuestion correctly identifies real interview questions and rejects candidate explanations", () => {
    // Real questions
    expect(isLikelyQuestion("can you write python code for palindrome?", "can you write python code for palindrome?")).toBe(true);
    expect(isLikelyQuestion("how do you implement binary search", "how do you implement binary search")).toBe(true);
    expect(isLikelyQuestion("what is the difference between list and tuple", "what is the difference between list and tuple")).toBe(true);
    expect(isLikelyQuestion("write code for palindrome", "write code for palindrome")).toBe(true);
    expect(isLikelyQuestion("palindrome in python", "palindrome in python")).toBe(true);

    // Candidate reading aloud / explaining - MUST BE REJECTED to prevent overwriting answers!
    expect(isLikelyQuestion("In Python, a dictionary is like a real-world dictionary", "In Python a dictionary is like a real-world dictionary")).toBe(false);
    expect(isLikelyQuestion("I use a Python dictionary when I need O(1) lookups", "I use a Python dictionary when I need O(1) lookups")).toBe(false);
    expect(isLikelyQuestion("We can clean the string and check if it equals its reverse slice", "We can clean the string and check if it equals its reverse slice")).toBe(false);
    expect(isLikelyQuestion("Basically, for example here is how I would explain it", "Basically for example here is how I would explain it")).toBe(false);
  });

  it("generates simple, clean, explainable palindrome code with clean == clean[::-1]", () => {
    expect(isCodeRequest("write python code for palindrome")).toBe(true);
    expect(isCodeRequest("palindrome")).toBe(true);

    const result = generateHumanAnswer("write python code for palindrome", "Software Engineer", { response_delivery: "natural" });
    expect(result.answer).toContain("```python");
    expect(result.answer).toContain("clean == clean[::-1]");
    expect(result.answer).toContain("def is_palindrome");
  });

  it("matches the Palindrome topic in the knowledge engine", () => {
    const topic = findMatchingTopic("can you explain palindrome in python");
    expect(topic).not.toBeNull();
    expect(topic?.title).toBe("Palindrome in Python");
    expect(topic?.simple).toContain("clean == clean[::-1]");
  });
});

