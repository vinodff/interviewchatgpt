import { expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateAnswerWithGemini } from "../lib/server-answer";
import { InterviewMemory } from "../lib/interview-memory";

it.runIf(Boolean((process.env.AUDIO_BENCHMARK_FILE || process.env.AUDIO_BENCHMARK_MANIFEST) && process.env.GEMINI_API_KEY))("compares real audio models for first text, completion and expected intent/content", async () => {
  type Fixture = { id: string; audio_file: string; expected_request: boolean; topic_pattern?: string; transcript_pattern?: string; required_patterns?: string[]; forbidden_patterns?: string[]; seed?: { question: string; answer: string } };
  const fixtures: Fixture[] = process.env.AUDIO_BENCHMARK_MANIFEST ? JSON.parse(readFileSync(process.env.AUDIO_BENCHMARK_MANIFEST, "utf8")) : [{ id: "dictionary", audio_file: process.env.AUDIO_BENCHMARK_FILE!, expected_request: true, topic_pattern: "key|mapping|hash", transcript_pattern: "what is a python dictionary" }];
  const repeats = Number(process.env.AUDIO_BENCHMARK_REPEATS || 2);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || !Array.isArray(fixtures) || !fixtures.length || fixtures.length > 20) throw new Error("Supply 1–20 synthetic audio fixtures and 1–10 repeats.");
  const original = process.env.GEMINI_ANSWER_MODEL;
  const samples: Array<Record<string, unknown>> = [];
  try {
    for (let run = 0; run < repeats; run++) for (const fixture of fixtures) for (const model of ["gemini-3.6-flash", "gemini-3.1-flash-lite"]) {
      process.env.GEMINI_ANSWER_MODEL = model;
      const started = performance.now(); let firstText: number | null = null;
      const memory = new InterviewMemory(); if (fixture.seed) memory.recordAnswer("seed", fixture.seed.question, fixture.seed.answer);
      const audio = readFileSync(fixture.audio_file).toString("base64");
      const reply = await generateAnswerWithGemini("", { answer_style: "concise", response_delivery: "natural", personalization: "technical" }, [], [], [], preview => {
        if (preview.answer && firstText === null) firstText = Math.round(performance.now() - started);
      }, AbortSignal.timeout(15000), memory.context(), { data: audio, prefix: "", overlap: false });
      samples.push({ id: fixture.id, model, actual_model: reply?.usage?.model, first_text_ms: firstText, complete_ms: Math.round(performance.now() - started), intent_matches: reply?.requests_answer === fixture.expected_request,
        transcript_matches: !fixture.transcript_pattern || new RegExp(fixture.transcript_pattern, "i").test(reply?.transcript || ""), answer_matches: !fixture.topic_pattern || new RegExp(fixture.topic_pattern, "i").test(reply?.answer || ""),
        content_matches: (fixture.required_patterns || []).every(pattern => new RegExp(pattern, "i").test(reply?.answer || "")) && !(fixture.forbidden_patterns || []).some(pattern => new RegExp(pattern, "i").test(reply?.answer || "")), usage: reply?.usage });
      samples.at(-1)!.missing_patterns = (fixture.required_patterns || []).filter(pattern => !new RegExp(pattern, "i").test(reply?.answer || ""));
    }
  } finally { if (original === undefined) delete process.env.GEMINI_ANSWER_MODEL; else process.env.GEMINI_ANSWER_MODEL = original; }
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/audio-model-latency.json", JSON.stringify({ scope: "Direct real-provider synthetic audio intent and selected content checks; no capture/network-to-Vercel or exhaustive answer/code correctness evaluation.", samples }, null, 2));
  expect(samples.filter(item => item.actual_model !== item.model || !item.intent_matches || !item.transcript_matches || !item.answer_matches || !item.content_matches)).toEqual([]);
}, 180000);
