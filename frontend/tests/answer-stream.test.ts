import { describe, expect, it } from "vitest";
import { previewInterviewJson, providerUsage, readGeminiStream } from "../lib/answer-stream";

describe("incremental interview answers", () => {
  it("does not preview candidate narration or an incomplete question", () => {
    expect(previewInterviewJson('{"requests_answer":false,"answer":"hello')).toBeNull();
    expect(previewInterviewJson('{"requests_answer":true,"question":"what')).toBeNull();
  });
  it("decodes newlines, quotes and Unicode only after escapes are complete", () => {
    const prefix = '{"requests_answer":true,"speaker_role":"unknown","question":"Implement it","answer":"';
    expect(previewInterviewJson(prefix + '```js\\nconst x = \\"a\\";\\n'))?.toEqual({ question: "Implement it", speaker_role: "unknown", answer: '```js\nconst x = "a";\n' });
    expect(previewInterviewJson(prefix + 'word\\u20')?.answer).toBe("word");
    expect(previewInterviewJson(prefix + 'word\\u2014')?.answer).toBe("word—");
  });
  it("emits text before the provider stream is complete across split SSE envelopes", async () => {
    const encoder = new TextEncoder();
    let control!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { control = controller; } }));
    const seen: string[] = [];
    const reading = readGeminiStream(response, value => seen.push(value));
    const first = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] })}\n\n`;
    control.enqueue(encoder.encode(first.slice(0, 17))); control.enqueue(encoder.encode(first.slice(17)));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(seen).toEqual(["Hello"]);
    control.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: " world" }] } }] })}\n\n`));
    control.close();
    expect(await reading).toEqual({ text: "Hello world", finishReason: "STOP" });
  });
  it("includes a complete audio transcript while its answer is still streaming", () => {
    const raw = '{"transcript":"What is Python?","requests_answer":true,"speaker_role":"unknown","question":"What is Python?","answer":"Python is';
    expect(previewInterviewJson(raw)).toEqual({ transcript: "What is Python?", question: "What is Python?", speaker_role: "unknown", answer: "Python is" });
  });
  it("cancels the provider body when an invalid SSE envelope interrupts parsing", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("data: not-json\n\n")); },
      cancel() { cancelled = true; },
    }));
    await expect(readGeminiStream(response, () => {})).rejects.toThrow();
    expect(cancelled).toBe(true);
  });
  it("keeps provider token counters separate from generated answer data", async () => {
    expect(providerUsage({ promptTokenCount: 120, candidatesTokenCount: 45, thoughtsTokenCount: -1, secret: "ignored" })).toEqual({ input_tokens: 120, output_tokens: 45, thinking_tokens: 0 });
    const response = new Response(`data: ${JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "reply" }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 12, thoughtsTokenCount: 7 } })}\n\n`);
    expect((await readGeminiStream(response, () => {})).usage).toEqual({ input_tokens: 100, output_tokens: 12, thinking_tokens: 7 });
  });
});
