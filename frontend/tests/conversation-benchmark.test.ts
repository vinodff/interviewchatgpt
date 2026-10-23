import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { InterviewMemory } from "../lib/interview-memory";
import { speechTiming } from "../lib/speech-timing";
import cases from "./fixtures/conversation-benchmark.json";

function memoryFor(fixture: typeof cases[number]): InterviewMemory {
  const memory = new InterviewMemory();
  if (fixture.seed) memory.recordAnswer("seed", fixture.seed.question, fixture.seed.answer);
  for (let i = 0; i < (fixture.rollover || 0); i++) memory.recordAnswer(`follow-${i}`, "Explain that approach", "The approach is unchanged; it returns a new reversed array.");
  return memory;
}

describe("conversation benchmark fixtures", () => {
  for (const fixture of cases) it(fixture.id, () => {
    const memory = memoryFor(fixture);
    const context = memory.context();
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(32000);
    const timing = speechTiming({ text: fixture.text, final: fixture.final, hasContext: memory.hasContext });
    if (fixture.expected_request && !fixture.final) expect(timing.allow_interim).toBe(true);
    if (fixture.rollover) {
      expect(context.code_artifacts[0].complete).toBe(true);
      expect(context.active_task?.constraints.join(" ")).toContain("without recursion");
    }
  });
});

const baseURL = process.env.CONVERSATION_BENCHMARK_URL;
it.runIf(Boolean(baseURL))("measures real model intent, latency and provider token usage", async () => {
  type Sample = { id: string; expected_request: boolean; detected_request?: boolean; first_text_ms?: number; complete_ms: number; topic_match: boolean; content_checks_passed: boolean; context_chars: number; usage?: Record<string, unknown>; error?: string };
  const samples: Sample[] = [];
  for (const fixture of cases) {
    const memory = memoryFor(fixture); const context = memory.context();
    const started = performance.now();
    let completed: Record<string, unknown> | null = null; let firstText: number | undefined;
    let error: string | undefined;
    try {
      const response = await fetch(new URL("/api/live/answer", baseURL), { method: "POST", headers: { "Content-Type": "application/json", "X-InterviewPilot": "1", Origin: new URL(baseURL!).origin },
        body: JSON.stringify({ question: fixture.text, interview_context: context, preferences: { response_delivery: "natural", answer_style: "concise" }, stream: true }), signal: AbortSignal.timeout(28000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "preview" && firstText === undefined && event.answer) firstText = Math.round(performance.now() - started);
        if (event.type === "complete") completed = event;
        if (event.type === "error") throw new Error(String(event.detail));
      };
      try {
        while (true) {
          const { value, done } = await reader.read(); buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
          if (done) { if (buffer.trim()) consume(buffer); break; }
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (!completed) throw new Error("Stream ended without a completed decision");
    } catch (failure) { error = failure instanceof Error ? failure.message : "Request failed"; }
    const result = completed as Record<string, unknown> | null;
    const answer = String(result?.answer || "").toLowerCase();
    samples.push({ id: fixture.id, expected_request: fixture.expected_request, detected_request: typeof result?.requests_answer === "boolean" ? result.requests_answer : undefined,
      first_text_ms: firstText, complete_ms: Math.round(performance.now() - started), topic_match: !fixture.expected_request || fixture.topic_terms.some(term => answer.includes(term)),
      content_checks_passed: (fixture.required_patterns || []).every(pattern => new RegExp(pattern, "i").test(answer)) && !(fixture.forbidden_patterns || []).some(pattern => new RegExp(pattern, "i").test(answer)), context_chars: JSON.stringify(context).length,
      usage: result?.usage as Record<string, unknown> | undefined, error });
  }
  const latencies = samples.flatMap(item => item.first_text_ms === undefined ? [] : [item.first_text_ms]).sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)] : null;
  const report = { recorded_at: new Date().toISOString(), scope: "Synthetic transcript-to-model intent, topic and selected language/complexity checks; not exhaustive answer correctness. Microphone capture and real-device recognition are not measured.",
    samples, total: samples.length, intent_correct: samples.filter(item => item.detected_request === item.expected_request).length,
    missed_questions: samples.filter(item => item.expected_request && item.detected_request !== true).length,
    unwanted_answers: samples.filter(item => !item.expected_request && item.detected_request === true).length,
    transport_failures: samples.filter(item => item.error).length, first_text_p50_ms: percentile(0.5), first_text_p95_ms: percentile(0.95),
    provider_tokens: samples.reduce((total, item) => ({ input: total.input + Number(item.usage?.input_tokens || 0), output: total.output + Number(item.usage?.output_tokens || 0), thinking: total.thinking + Number(item.usage?.thinking_tokens || 0) }), { input: 0, output: 0, thinking: 0 }) };
  mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/conversation-benchmark.json", JSON.stringify(report, null, 2));
  expect(report.transport_failures, JSON.stringify(samples.filter(item => item.error))).toBe(0);
  expect(report.missed_questions, JSON.stringify(samples.filter(item => item.expected_request && item.detected_request !== true))).toBe(0);
  expect(report.unwanted_answers, JSON.stringify(samples.filter(item => !item.expected_request && item.detected_request === true))).toBe(0);
  expect(samples.filter(item => item.expected_request).every(item => item.topic_match)).toBe(true);
  expect(samples.filter(item => !item.content_checks_passed), "Required language/code/complexity checks").toEqual([]);
}, 300000);
