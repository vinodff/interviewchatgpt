import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const account = vi.hoisted(() => ({ supabase: {} as unknown, auth: vi.fn() }));
vi.mock("../lib/server-supabase", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/server-supabase")>(),
  getServerSupabase: () => account.supabase,
  getAuthenticatedUser: account.auth,
}));
import { POST } from "../app/api/[...path]/route";
import { generateAnswerWithGemini } from "../lib/server-answer";
import { validScreenImage } from "../lib/server-analyze";

const fetchMock = vi.fn<typeof fetch>();
const request = (path: string, body: unknown, extra: Record<string, string> = {}) => new NextRequest(`https://workspace.test/api/${path}`, { method: "POST", headers: { "X-InterviewPilot": "1", ...extra }, body: JSON.stringify(body) });
const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
const reply = (value: Record<string, unknown>) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
const sse = (value: Record<string, unknown>) => new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
const system = (call = 0) => JSON.parse(String(fetchMock.mock.calls[call][1]?.body)).systemInstruction.parts[0].text as string;
const input = (call = 0) => JSON.parse(JSON.parse(String(fetchMock.mock.calls[call][1]?.body)).contents[0].parts[0].text);
const ok = { requests_answer: true, speaker_role: "unknown", question: "What is Python?", answer: "Python is a readable programming language.", evidence_indices: [] };
// Smallest real headers: JPEG starts FF D8 FF, PNG starts 89 50 4E 47.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56, 2)]).toString("base64");

const signedIn = (minutesUsed = 2, id = `user-${Math.random()}`) => ({ authId: id, token: "t", user: { id, minute_limit: 10, minutes_used: minutesUsed } });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser"); vi.stubEnv("GEMINI_API_KEY", "test-only-placeholder");
  account.supabase = {}; account.auth.mockResolvedValue(signedIn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("desktop session settings in the answer prompt", () => {
  it("answers in the chosen language and passes session settings to the model", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Python?", { language: "Hindi", session_type: "meeting", custom_instructions: "Use bullet points", humanize: true, answer_model: "smart" });
    expect(input().preferences).toMatchObject({ language: "Hindi", session_type: "meeting", custom_instructions: "Use bullet points" });
    expect(input().preferences).not.toHaveProperty("answer_model");
    expect(system()).toContain("language named by preferences.language");
    expect(system()).toContain("live work meeting");
    expect(system()).toContain("Humanize");
    expect(system()).toContain("custom_instructions are the user's own style");
  });

  it("adds no session rules for the web workspace's existing preferences", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Python?", { role: "SWE" });
    expect(system()).not.toContain("Humanize");
    expect(system()).not.toContain("live work meeting");
    expect(system()).not.toContain("custom_instructions are");
  });

  it("caps custom instructions at 2000 characters", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Python?", { custom_instructions: "x".repeat(5000) });
    expect(input().preferences.custom_instructions).toHaveLength(2000);
  });

  it("uses the deeper model for Smart and the fast model otherwise", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok)).mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Python?", { answer_model: "smart" });
    await generateAnswerWithGemini("What is Python?", { answer_model: "fast" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.8-flash");
    expect(String(fetchMock.mock.calls[1][0])).toContain("gemini-3.6-flash");
  });

  it("never lets a caller choose an arbitrary model name", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Python?", { answer_model: "gemini-ultra-unbounded" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("gemini-3.6-flash");
  });
});

describe("screenshot validation", () => {
  it("accepts real JPEG and PNG headers only for their declared type", () => {
    expect(validScreenImage(JPEG, "image/jpeg")).toEqual({ data: JPEG, mime: "image/jpeg" });
    expect(validScreenImage(PNG, "image/png")).toEqual({ data: PNG, mime: "image/png" });
    expect(validScreenImage(PNG, "image/jpeg")).toBeNull();
    expect(validScreenImage(JPEG, "image/gif")).toBeNull();
    expect(validScreenImage("not base64!", "image/jpeg")).toBeNull();
    expect(validScreenImage(42, "image/jpeg")).toBeNull();
  });
});

describe("live/analyze route", () => {
  it("rejects a bad image before contacting the AI provider", async () => {
    const response = await POST(request("live/analyze", { image: PNG, mime: "image/jpeg" }), params("live/analyze"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses cross-site requests", async () => {
    const response = await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }, { origin: "https://attacker.test" }), params("live/analyze"));
    expect(response.status).toBe(403);
  });

  it("streams the task found on screen and its answer", async () => {
    fetchMock.mockResolvedValueOnce(sse({ requests_answer: true, question: "Reverse a list", answer: "```python\nxs[::-1]\n```" }));
    const response = await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg", preferences: { language: "English" } }), params("live/analyze"));
    expect(response.headers.get("Content-Type")).toContain("application/x-ndjson");
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "complete", question: "Reverse a list", answer: "```python\nxs[::-1]\n```" });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/jpeg", data: JPEG });
  });

  it("requires a signed-in account, even where accounts are not configured", async () => {
    account.auth.mockResolvedValueOnce(null);
    expect((await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }), params("live/analyze"))).status).toBe(401);
    account.supabase = null;
    expect((await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }), params("live/analyze"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses accounts with no live minutes left", async () => {
    account.auth.mockResolvedValueOnce(signedIn(10));
    expect((await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }), params("live/analyze"))).status).toBe(402);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits analyses per account even when the client address changes", async () => {
    const same = signedIn(2, "one-account");
    account.auth.mockResolvedValue(same);
    fetchMock.mockImplementation(async () => sse({ requests_answer: false, question: "", answer: "" }));
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 9; attempt++) {
      const response = await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }, { "x-real-ip": `10.0.0.${attempt}` }), params("live/analyze"));
      statuses.push(response.status); await response.text();
    }
    expect(statuses.slice(0, 8).every(status => status === 200)).toBe(true);
    expect(statuses[8]).toBe(429);
  });

  it("reports an empty result when the screen shows no task", async () => {
    fetchMock.mockResolvedValueOnce(sse({ requests_answer: false, question: "", answer: "" }));
    const response = await POST(request("live/analyze", { image: JPEG, mime: "image/jpeg" }), params("live/analyze"));
    const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({ type: "complete", requests_answer: false, answer: "" });
  });
});
