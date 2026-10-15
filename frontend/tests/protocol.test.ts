import { describe, expect, it } from "vitest";
import { initialLiveState, parseLiveMessage, reduceLiveMessage, websocketUrl } from "../lib/protocol";

describe("live answer generations", () => {
  it("never replaces an authoritative final transcript with a delayed interim", () => {
    const state = reduceLiveMessage(initialLiveState, { type: "transcript", id: "turn", role: "user", text: "I chose PostgreSQL for transactions.", final: true });
    expect(reduceLiveMessage(state, { type: "transcript", id: "turn", role: "unknown", text: "I chose", final: false })).toBe(state);
    expect(reduceLiveMessage(state, { type: "transcript", id: "turn", role: "user", text: "I chose PostgreSQL for transactions.", final: true }).transcripts).toHaveLength(1);
  });
  it("preserves a streamed answer while one transcription channel renews", () => {
    let state = reduceLiveMessage({ ...initialLiveState, phase: "listening" }, { type: "question", generation_id: "current", question: "Explain retry safety", keywords: [] });
    state = reduceLiveMessage(state, { type: "answer_delta", generation_id: "current", text: "Use idempotent " });
    state = reduceLiveMessage(state, { type: "transcription_status", channel: 0, state: "reconnecting", detail: "Renewing interviewer transcription" });
    expect(state.phase).toBe("listening"); expect(state.generation).toBe("current"); expect(state.answer).toBe("Use idempotent ");
    state = reduceLiveMessage(state, { type: "transcription_status", channel: 1, state: "reconnecting", detail: "Reconnecting microphone" });
    state = reduceLiveMessage(state, { type: "transcription_status", channel: 0, state: "listening", detail: "Ready" });
    expect(Object.keys(state.transcriptionWarnings)).toEqual(["1"]);
    state = reduceLiveMessage(state, { type: "answer_complete", generation_id: "current", answer: "Use idempotent operations.", evidence: [], keywords: [], latency_ms: 25 });
    expect(state.answer).toBe("Use idempotent operations."); expect(state.answering).toBe(false);
  });
  it("validates provider status without accepting unknown channels or states", () => {
    expect(parseLiveMessage(JSON.stringify({ type: "transcription_status", channel: 0, state: "reconnecting", detail: "Renewing" }))).not.toBeNull();
    for (const patch of [{ channel: 2 }, { channel: "0" }, { state: "invalid" }, { detail: 5 }]) {
      expect(parseLiveMessage(JSON.stringify({ type: "transcription_status", channel: 0, state: "reconnecting", detail: "Renewing", ...patch }))).toBeNull();
    }
  });
  it("ignores late deltas, completions and cancellation from a superseded question", () => {
    let state = reduceLiveMessage(initialLiveState, { type: "question", generation_id: "first", question: "First?", keywords: [] });
    state = reduceLiveMessage(state, { type: "answer_delta", generation_id: "first", text: "Old answer" });
    state = reduceLiveMessage(state, { type: "question", generation_id: "second", question: "Second?", keywords: ["architecture"] });
    const before = state;
    for (const message of [
      { type: "answer_delta" as const, generation_id: "first", text: " late text" },
      { type: "answer_complete" as const, generation_id: "first", answer: "late answer", evidence: [], keywords: [], latency_ms: 1 },
      { type: "answer_cancelled" as const, generation_id: "first" },
    ]) state = reduceLiveMessage(state, message);
    expect(state).toBe(before);
    state = reduceLiveMessage(state, { type: "answer_delta", generation_id: "second", text: "Current answer" });
    state = reduceLiveMessage(state, { type: "answer_complete", generation_id: "second", answer: "Current answer complete", evidence: [], keywords: [], latency_ms: 120 });
    expect(state.question).toBe("Second?"); expect(state.answer).toBe("Current answer complete"); expect(state.answering).toBe(false);
  });
  it("updates a partial transcript in place and bounds conversation memory", () => {
    let state = reduceLiveMessage(initialLiveState, { type: "transcript", id: "one", role: "unknown", text: "What", final: false });
    state = reduceLiveMessage(state, { type: "transcript", id: "one", role: "interviewer", text: "What did you build?", final: true });
    expect(state.transcripts).toHaveLength(1); expect(state.transcripts[0].final).toBe(true);
    for (let i = 0; i < 100; i++) state = reduceLiveMessage(state, { type: "transcript", id: String(i), role: "user", text: "speech", final: true });
    expect(state.transcripts).toHaveLength(80);
  });
  it("removes incomplete code after cancellation and rejects any late completion", () => {
    let state = reduceLiveMessage(initialLiveState, { type: "question", generation_id: "code", question: "Write Python", keywords: [] });
    state = reduceLiveMessage(state, { type: "answer_delta", generation_id: "code", text: "```python\ndef incomplete(" });
    state = reduceLiveMessage(state, { type: "answer_cancelled", generation_id: "code" });
    expect(state.answer).toBe(""); expect(state.generation).toBeNull(); expect(state.answering).toBe(false);
    expect(reduceLiveMessage(state, { type: "answer_complete", generation_id: "code", answer: "late partial code", evidence: [], keywords: [], latency_ms: 12 })).toBe(state);
  });
  it("invalidates interrupted answers and clears an error after successful reconnection", () => {
    let state = reduceLiveMessage(initialLiveState, { type: "question", generation_id: "first", question: "First?", keywords: [] });
    state = reduceLiveMessage(state, { type: "answer_delta", generation_id: "first", text: "Partial" });
    state = reduceLiveMessage(state, { type: "status", state: "reconnecting" });
    expect(state.answering).toBe(false); expect(state.generation).toBeNull(); expect(state.answer).toBe("");
    state = reduceLiveMessage(state, { type: "error", code: "network", message: "Retrying", recoverable: true });
    state = reduceLiveMessage(state, { type: "status", state: "listening" }); expect(state.error).toBe("");
    expect(reduceLiveMessage(state, { type: "answer_delta", generation_id: "first", text: "Late" }).answer).toBe("");
  });
  it("rejects malformed messages while accepting actual protocol events", () => {
    for (const raw of ["bad json", "null", "{}", '{"type":"question","generation_id":9}', '{"type":"status","state":"made_up"}', '{"type":"transcript","role":"made_up"}', '{"type":"question","generation_id":"g","question":"Q?","keywords":"oops"}', '{"type":"answer_complete","generation_id":"g","answer":"a","evidence":[null],"keywords":[],"latency_ms":2}']) expect(parseLiveMessage(raw)).toBeNull();
    expect(parseLiveMessage('{"type":"pong"}')).toEqual({ type: "pong" });
    expect(parseLiveMessage('{"type":["question"],"generation_id":"g"}')).toBeNull();
    expect(parseLiveMessage('{"type":"status","state":["ended"]}')).toBeNull();
  });
});
describe("WebSocket URL construction", () => {
  it("constructs direct local connection and encodes the one-use ticket", () => {
    expect(websocketUrl("session-id", "a+b/", "ws://localhost:8000", { protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:8000/api/live/session-id/ws?ticket=a%2Bb%2F");
  });
  it("uses a secure same-origin path and supports explicit path templates", () => {
    expect(websocketUrl("session-id", "ticket", "wss://example.com/api/live/{id}/ws", { protocol: "https:", host: "example.com" })).toBe("wss://example.com/api/live/session-id/ws?ticket=ticket");
    expect(() => websocketUrl("id", "ticket", "ws://example.com", { protocol: "https:", host: "example.com" })).toThrow("secure");
  });
});
