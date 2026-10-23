import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[...path]/route";
import { generateAnswerWithGemini } from "../lib/server-answer";
import { InterviewMemory } from "../lib/interview-memory";

const fetchMock = vi.fn<typeof fetch>();
const request = (path: string, body?: unknown, extra: Record<string, string> = {}) => new NextRequest(`https://workspace.test/api/${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { "X-InterviewPilot": "1", ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const reply = (value: Record<string, unknown>) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser"); vi.stubEnv("GEMINI_API_KEY", "test-only-placeholder"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("standalone answer boundary", () => {
  it.each(["Database means?", "SQL means", "Python means"])("keeps original keyword prompt %s and requests a simple relevant example", async speech => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "What does this topic mean?", answer: "A definition with a relevant example.", evidence_indices: [] }));
    await POST(request("live/answer", { question: speech }), params("live/answer"));
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(JSON.parse(payload.contents[0].parts[0].text)).toMatchObject({ latest_speech: speech, standalone_topic_request: expect.stringContaining("Explain") });
    expect(payload.systemInstruction.parts[0].text).toContain("Include exactly one short, simple, relevant example");
  });
  it("honors the example preference without overriding an explicit spoken request", async () => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "What is SQL?", answer: "SQL is a language for working with relational databases." }));
    await POST(request("live/answer", { question: "SQL means", preferences: { include_simple_example: false } }), params("live/answer"));
    const system = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).systemInstruction.parts[0].text;
    expect(system).toContain("Do not add an unsolicited example"); expect(system).not.toContain("Include exactly one short, simple, relevant example");
  });
  it("does not ask the provider to turn a clear candidate offer into an answer", async () => {
    const response = await POST(request("live/answer", { question: "I can describe polymorphism", request_focus: "describe polymorphism" }), params("live/answer"));
    expect(await response.json()).toMatchObject({ requests_answer: false, speaker_role: "unknown", answer: "" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps original narration beside an unverified focus hint", async () => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: false, speaker_role: "user", question: "", answer: "", evidence_indices: [] }));
    const speech = "The interviewer asked what is polymorphism";
    await POST(request("live/answer", { question: speech, request_focus: "what is polymorphism" }), params("live/answer"));
    const input = JSON.parse(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).contents[0].parts[0].text);
    expect(input.latest_speech).toBe(speech); expect(input.possible_request_focus).toBe("what is polymorphism");
  });
  it("attaches only actually used evidence, bounds its indices, and avoids blanket citations", async () => {
    const evidence = [{ id: "resume", text: "Alex lists DBMS as a skill." }, { id: "notes", text: "A DBMS is software for managing databases." }];
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "What is DBMS?", answer: "A DBMS manages a database.", evidence_indices: [1, 1, -1, 99] }));
    const response = await POST(request("live/answer", { question: "What is DBMS?", evidence }), params("live/answer"));
    expect((await response.json()).evidence.map((item: { id: string }) => item.id)).toEqual(["notes"]);
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "What is DBMS?", answer: "A DBMS manages a database.", evidence_indices: [] }));
    const general = await POST(request("live/answer", { question: "What is DBMS?", evidence }), params("live/answer"));
    expect((await general.json()).evidence).toEqual([]);
  });
  it.each([null, [], { question: 42 }, { question: "" }, { question: "Why?", evidence: {} }, { question: "Why?", preferences: [] }])("rejects malformed inputs before contacting AI: %j", async body => {
    const response = await POST(request("live/answer", body), params("live/answer"));
    expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not report successful server persistence for browser records", async () => {
    expect((await POST(request("projects", { name: "Project" }), params("projects"))).status).toBe(404);
  });
  it("checks cross-site access and reports missing provider credentials", async () => {
    expect((await POST(request("live/answer", { question: "What is Python?" }, { origin: "https://attacker.test" }), params("live/answer"))).status).toBe(403);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await POST(request("live/answer", { question: "What is Python?" }), params("live/answer"))).status).toBe(503);
    const response = await GET(request("health"), params("health"));
    expect(await response.json()).toMatchObject({ ai_configured: false });
  });
  it("accepts the actual browser host when Next uses a different internal request hostname", async () => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "Why?", answer: "A relevant answer for this question." }));
    const response = await POST(request("live/answer", { question: "Why?" }, { host: "127.0.0.1:3013", origin: "http://127.0.0.1:3013" }), params("live/answer"));
    expect(response.status).toBe(200);
  });
  it("passes code context and returns an answer even when speaker identity is uncertain", async () => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "Explain the earlier function", answer: "It uses a set to track previously seen values." }));
    const response = await POST(request("live/answer", { question: "Okay I see, explain that code", history: [{ question: "Find duplicates in JavaScript", answer: "```js\nconst seen = new Set();\n```" }] }), params("live/answer"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requests_answer: true, speaker_role: "unknown", answer: expect.stringContaining("set") });
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.contents[0].parts[0].text).toContain("new Set()");
    expect(payload.systemInstruction.parts[0].text).toContain("NEVER suppress");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("test-only-placeholder");
  });
  it("does not turn candidate narration into an unrelated answer", async () => {
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: false, speaker_role: "user", question: "", answer: "" }));
    const response = await POST(request("live/answer", { question: "I used Redis to cache our customer records." }), params("live/answer"));
    expect(await response.json()).toMatchObject({ requests_answer: false, answer: "" });
  });
  it("reports upstream failure instead of a generic fabricated answer", async () => {
    fetchMock.mockResolvedValue(new Response("provider private error", { status: 429 }));
    const response = await POST(request("live/answer", { question: "What is quantum entanglement?" }), params("live/answer"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("provider private error");
  });
  it("rejects truncated model output", async () => {
    fetchMock.mockResolvedValue(Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "incomplete" }] } }] }));
    expect(await generateAnswerWithGemini("Implement a parser")).toBeNull();
  });
  it("does not switch models after an answer preview has started", async () => {
    const partial = '{"requests_answer":true,"speaker_role":"unknown","question":"Why?","answer":"A useful partial answer';
    fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: partial }] } }] })}\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
    const preview = vi.fn();
    expect(await generateAnswerWithGemini("Why?", {}, [], [], [], preview)).toBeNull();
    expect(preview).toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("reports a provider-stopped stream accurately without presenting a partial answer as complete", async () => {
    const partial = '{"requests_answer":true,"speaker_role":"unknown","question":"Implement a stack","answer":"A partial implementation';
    fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "RECITATION", content: { parts: [{ text: partial }] } }] })}\n\n`));
    const response = await POST(request("live/answer", { question: "Implement a stack", stream: true }), params("live/answer"));
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "error", detail: expect.stringContaining("stopped before finishing") });
    expect(events.some(event => event.type === "complete")).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("uses supported thinking settings when falling back from an unavailable model", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "What is Python?", answer: "Python is a high-level programming language." }));
    expect(await generateAnswerWithGemini("What is Python?")).toMatchObject({ requests_answer: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.6-flash");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).generationConfig.thinkingConfig.thinkingLevel).toBe("minimal");
    expect(String(fetchMock.mock.calls[1][0])).toContain("gemini-3.8-flash");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).generationConfig.thinkingConfig.thinkingLevel).toBe("low");
  });
  it("passes exact earlier code through structured memory after recent history rolls over", async () => {
    const memory = new InterviewMemory();
    memory.recordAnswer("original", "Implement reversal in Python without recursion", "```python\ndef reverse(items):\n    return items[::-1]\n```");
    for (let i = 0; i < 7; i++) memory.recordAnswer(`e${i}`, "Explain that approach", "The original function returns a reversed copy.");
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question: "Explain that code", answer: "It returns a new reversed sequence." }));
    const response = await POST(request("live/answer", { question: "Explain that code", interview_context: memory.context() }), params("live/answer"));
    expect(response.status).toBe(200);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const context = JSON.parse(payload.contents[0].parts[0].text).interview_memory;
    expect(context.code_artifacts[0].code).toContain("return items[::-1]");
    expect(context.active_task.constraints.join(" ")).toContain("without recursion");
    expect(payload.systemInstruction.parts[0].text).toContain("ASSISTANT SUGGESTIONS");
  });
  it("rejects an unsupported structured memory schema", async () => {
    const response = await POST(request("live/answer", { question: "Why?", interview_context: { version: 99 } }), params("live/answer"));
    expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["In Go", "In C++", "In C#"])("reserves code output capacity for short contextual conversion %s", async question => {
    const memory = new InterviewMemory(); memory.recordAnswer("a", "Implement reversal in Python", "```python\ndef reverse(xs):\n    return xs[::-1]\n```");
    fetchMock.mockResolvedValueOnce(reply({ requests_answer: true, speaker_role: "unknown", question, answer: "A converted implementation." }));
    await generateAnswerWithGemini(question, {}, [], [], [], undefined, undefined, memory.context());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).generationConfig.maxOutputTokens).toBe(2048);
  });
});

describe("authenticated backend proxy", () => {
  beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "backend"); vi.stubEnv("BACKEND_INTERNAL_URL", "http://127.0.0.1:8001"); });
  it.each([401, 403, 404, 409, 422, 500])("preserves backend HTTP %i without falling back to fake success", async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "Refused" }, { status }));
    const response = await GET(request("auth/me"), params("auth/me"));
    expect(response.status).toBe(status);
  });
  it("preserves cookies and forwards authentication to local backends", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "user" }, { headers: { "Set-Cookie": "session=opaque; HttpOnly; Secure" } }));
    const response = await GET(request("auth/me", undefined, { cookie: "session=incoming" }), params("auth/me"));
    expect(response.headers.get("Set-Cookie")).toContain("session=opaque");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("cookie")).toBe("session=incoming");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8001/api/auth/me");
  });
});
