import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAnswerWithGemini } from "@/lib/server-answer";
import { InterviewMemory } from "@/lib/interview-memory";

const fetchMock = vi.fn();
const reply = (value: unknown) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
const ok = { requests_answer: true, speaker_role: "unknown", question: "What is Java?", answer: "Java is a compiled, object-oriented language.", evidence_indices: [] };
const sent = (call = 0) => JSON.parse(String(fetchMock.mock.calls[call][1]?.body));
const input = (call = 0) => JSON.parse(sent(call).contents[0].parts[0].text);

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); vi.stubEnv("GEMINI_API_KEY", "test-only-placeholder"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("answer prompt stays small", () => {
  it("sends only answer-relevant preferences and caps a long job description", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Java?", { role: "SWE", answer_style: "concise", reading_wpm: 130, answer_font: "serif", answer_theme: "easy", answer_text_size: 18, reading_mode: "auto", job_description: "x".repeat(12000) });
    const preferences = input().preferences;
    expect(preferences).toMatchObject({ role: "SWE", answer_style: "concise" });
    for (const key of ["reading_wpm", "answer_font", "answer_theme", "answer_text_size", "reading_mode"]) expect(preferences).not.toHaveProperty(key);
    expect(preferences.job_description.length).toBeLessThanOrEqual(1500);
  });
  it("leaves old code out of a fresh unrelated question but keeps it for follow-ups about that code", async () => {
    const memory = new InterviewMemory();
    memory.recordAnswer("a", "Implement reversal in Python", "```python\ndef reverse(xs):\n    return xs[::-1]\n```");
    fetchMock.mockResolvedValueOnce(reply(ok)).mockResolvedValueOnce(reply({ ...ok, question: "Explain that code" }));
    await generateAnswerWithGemini("What is Java?", {}, [], [], [], undefined, undefined, memory.context());
    expect(input(0).interview_memory.code_artifacts).toEqual([]);
    await generateAnswerWithGemini("Explain that code", {}, [], [], [], undefined, undefined, memory.context());
    expect(input(1).interview_memory.code_artifacts[0].code).toContain("xs[::-1]");
  });
  it("tells the model which questions were already answered", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("Python", {}, [], [], [], undefined, undefined, null, undefined, undefined, { alreadyAnswered: ["What is Python?"] });
    expect(input().already_answered).toEqual(["What is Python?"]);
    expect(sent().systemInstruction.parts[0].text).toContain("already_answered");
    expect(sent().systemInstruction.parts[0].text).not.toContain("revisiting a prior topic");
  });
  it("keeps the system instruction identical across questions so the provider can cache it", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok)).mockResolvedValueOnce(reply({ ...ok, question: "What is Go?" }));
    await generateAnswerWithGemini("What is Java?", { role: "SWE" });
    await generateAnswerWithGemini("What is Go?", { role: "SWE" }, [], [], [], undefined, undefined, null, undefined, undefined, { alreadyAnswered: ["What is Java?"] });
    expect(sent(0).systemInstruction.parts[0].text).toBe(sent(1).systemInstruction.parts[0].text);
  });
});

describe("answer generation settings", () => {
  it("streams the answer before speaker metadata so the first words arrive sooner", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Java?");
    const order: string[] = sent().generationConfig.responseSchema.propertyOrdering;
    expect(order.indexOf("answer")).toBeLessThan(order.indexOf("speaker_role"));
    expect(order.indexOf("question")).toBeLessThan(order.indexOf("answer"));
  });
  it("sizes output to the chosen answer length and keeps text answers consistent", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok)).mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Java?", { answer_style: "concise" });
    await generateAnswerWithGemini("What is Java?", { answer_style: "detailed" });
    expect(sent(0).generationConfig.maxOutputTokens).toBeLessThan(sent(1).generationConfig.maxOutputTokens);
    expect(sent(0).generationConfig.temperature).toBeLessThanOrEqual(0.4);
  });
  it("asks for code first, with a language tag and phone-friendly line length", async () => {
    fetchMock.mockResolvedValueOnce(reply(ok));
    await generateAnswerWithGemini("What is Java?");
    const system: string = sent().systemInstruction.parts[0].text;
    expect(system).toMatch(/start the answer with the fenced code block/i);
    expect(system).toMatch(/60 characters/);
  });
});
