import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../app/api/[...path]/route";
import { enhancedWav } from "../lib/quiet-audio";
import { transcribeMicrophone } from "../lib/server-transcription";
import { InterviewMemory } from "../lib/interview-memory";
const fetchMock = vi.fn<typeof fetch>();
const audio = enhancedWav(Int16Array.from({ length: 1600 }, (_, i) => Math.round(30 * Math.sin(i / 5)))).audio;
const request = (body: unknown, origin = "https://workspace.test") => new NextRequest("https://workspace.test/api/live/transcribe", { method: "POST", headers: { "Content-Type": "application/json", "X-InterviewPilot": "1", Origin: origin }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ path: ["live", "transcribe"] }) };
const reply = (text: string) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ text }) }] } }] });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser"); vi.stubEnv("GEMINI_API_KEY", "test-only-placeholder"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("bounded audio transcription boundary", () => {
  it.each([{}, { audio: 12 }, { audio: "invalid" }, { audio: "a".repeat(256068) }])("rejects malformed or oversized audio before provider access", async body => {
    expect((await POST(request(body), params)).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects cross-site audio and overlarge request bodies", async () => {
    expect((await POST(request({ audio }, "https://attacker.test"), params)).status).toBe(403);
    expect((await POST(request({ audio: "a".repeat(400001) }), params)).status).toBe(413); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends WAV inline with a server-only key and returns only the transcript", async () => {
    fetchMock.mockResolvedValueOnce(reply("What is a dictionary?"));
    const response = await POST(request({ audio }), params); expect(await response.json()).toEqual({ text: "What is a dictionary?" });
    const [url, options] = fetchMock.mock.calls[0]; expect(String(url)).not.toContain("placeholder");
    expect(JSON.parse(String(options?.body)).contents[0].parts[0].inlineData).toEqual({ mimeType: "audio/wav", data: audio });
    expect(new Headers(options?.headers).get("x-goog-api-key")).toBe("test-only-placeholder");
  });
  it("allows empty speech and rejects truncated or invalid generated data", async () => {
    fetchMock.mockResolvedValueOnce(reply("")); expect(await transcribeMicrophone(audio, new AbortController().signal)).toBe("");
    fetchMock.mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"text":"partial' }] } }] }));
    expect(await transcribeMicrophone(audio, new AbortController().signal)).toBeNull();
  });
  it("bounds provider failures without exposing diagnostics or inventing speech", async () => {
    fetchMock.mockResolvedValue(new Response("private provider diagnostic", { status: 503 }));
    const response = await POST(request({ audio }), params); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private provider"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("transcribes and prepares an answer in one provider call with bounded context", async () => {
    const value = { transcript: "What is a dictionary?", requests_answer: true, speaker_role: "unknown", question: "What is a dictionary?", answer: "A dictionary maps keys to values." };
    fetchMock.mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }));
    const response = await POST(request({ audio, fast_answer: true, preferences: {}, prefix: "", interview_context: new InterviewMemory().context() }), params);
    expect(await response.json()).toMatchObject({ text: value.transcript, reply: { requests_answer: true, answer: value.answer } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.1-flash-lite:");
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.contents[0].parts[1].inlineData).toEqual({ mimeType: "audio/wav", data: audio });
    expect(payload.generationConfig.maxOutputTokens).toBe(2048);
  });
  it("rejects invalid fast-answer context before contacting the provider", async () => {
    expect((await POST(request({ audio, fast_answer: true, preferences: {}, prefix: "", interview_context: { version: 99 } }), params)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not preview a candidate capability statement but retains a carried question prefix", async () => {
    const value = { transcript: "I can describe polymorphism", requests_answer: true, speaker_role: "unknown", question: "Describe polymorphism", answer: "Polymorphism uses one interface for multiple types.", evidence_indices: [] };
    const envelope = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] })}\n\n`;
    fetchMock.mockResolvedValueOnce(new Response(envelope));
    const response = await POST(request({ audio, fast_answer: true, stream: true, preferences: {}, prefix: "", interview_context: new InterviewMemory().context() }), params);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events.map(event => event.type)).toEqual(["complete"]); expect(events[0].reply).toMatchObject({ requests_answer: false, speaker_role: "unknown" });
    fetchMock.mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] }));
    const continued = await POST(request({ audio, fast_answer: true, preferences: {}, prefix: "Can you tell me how", interview_context: new InterviewMemory().context() }), params);
    expect((await continued.json()).reply.requests_answer).toBe(true);
  });
  it("uses the audio fallback model when the preferred provider fails before a preview", async () => {
    const value = { transcript: "What is a dictionary?", requests_answer: true, speaker_role: "unknown", question: "What is a dictionary?", answer: "A dictionary maps keys to values." };
    fetchMock.mockResolvedValueOnce(new Response("provider unavailable", { status: 503 })).mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] }));
    const response = await POST(request({ audio, fast_answer: true, preferences: {}, prefix: "", interview_context: new InterviewMemory().context() }), params);
    expect(response.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.1-flash-lite:");
    expect(String(fetchMock.mock.calls[1][0])).toContain("gemini-3.6-flash:");
  });
  it("streams an audio answer preview before its completion using a single provider request", async () => {
    const encoder = new TextEncoder(); let provider!: ReadableStreamDefaultController<Uint8Array>;
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start(controller) { provider = controller; } })));
    const response = await POST(request({ audio, fast_answer: true, stream: true, preferences: {}, prefix: "", interview_context: new InterviewMemory().context() }), params);
    const reader = response.body!.getReader(); const decoder = new TextDecoder();
    const raw = '{"transcript":"What is Python?","requests_answer":true,"speaker_role":"unknown","question":"What is Python?","answer":"Python is';
    const envelope = (text: string, finishReason?: string) => encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}) }] })}\n\n`);
    provider.enqueue(envelope(raw));
    const preview = JSON.parse(decoder.decode((await reader.read()).value).trim());
    expect(preview).toMatchObject({ type: "preview", text: "What is Python?", reply: { requests_answer: true, answer: "Python is" } });
    provider.enqueue(envelope(' a programming language."}', "STOP")); provider.close();
    let rest = "";
    while (true) { const { value, done } = await reader.read(); if (done) break; rest += decoder.decode(value); }
    expect(rest.trim().split("\n").map(line => JSON.parse(line)).at(-1)).toMatchObject({ type: "complete", reply: { answer: "Python is a programming language." } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("reports a truncated audio stream instead of completing or retrying an already visible answer", async () => {
    const raw = '{"transcript":"What is Python?","requests_answer":true,"speaker_role":"unknown","question":"What is Python?","answer":"Python is';
    fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: raw }] }, finishReason: "MAX_TOKENS" }] })}\n\n`));
    const response = await POST(request({ audio, fast_answer: true, stream: true, preferences: {}, prefix: "", interview_context: new InterviewMemory().context() }), params);
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events.map(event => event.type)).toEqual(["preview", "error"]); expect(fetchMock).toHaveBeenCalledOnce();
  });
});
