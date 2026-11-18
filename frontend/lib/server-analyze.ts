import { previewInterviewJson, readGeminiStream, type AnswerPreview } from "./answer-stream";
import type { InterviewContext } from "./interview-memory";

/** Screenshots the desktop app may send. Anything else is rejected before it reaches the provider. */
export const SCREEN_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export type ScreenImageType = typeof SCREEN_IMAGE_TYPES[number];
/** Base64 characters. A 1600px JPEG at the desktop's quality is far smaller; this caps abuse. */
export const MAX_SCREEN_IMAGE_BASE64 = 4_000_000;

const MAGIC: Record<ScreenImageType, number[]> = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47] };

/** Accept only a bounded, canonical base64 JPEG/PNG whose bytes match the declared type. */
export function validScreenImage(image: unknown, mime: unknown): { data: string; mime: ScreenImageType } | null {
  if (typeof image !== "string" || typeof mime !== "string") return null;
  if (!SCREEN_IMAGE_TYPES.includes(mime as ScreenImageType)) return null;
  if (image.length < 64 || image.length > MAX_SCREEN_IMAGE_BASE64 || image.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return null;
  const head = Buffer.from(image.slice(0, 16), "base64");
  if (!MAGIC[mime as ScreenImageType].every((byte, index) => head[index] === byte)) return null;
  return { data: image, mime: mime as ScreenImageType };
}

export type ScreenReply = { question: string; answer: string };

const ANALYZE_INSTRUCTION = `You help a candidate during an authorized live interview or meeting by reading a screenshot of their screen.
Decide what the person needs right now from what is visible. Prefer, in order:
1) A coding problem, prompt, or incomplete solution they are writing (LeetCode, HackerRank, CodeSignal, an IDE, a shared doc).
2) A bug, failing test, compiler/linter/runtime error, stack trace, red squiggle, or broken output — explain the cause and give the fixed code or the exact change.
3) A multiple-choice, short-answer, or slide question.
4) A diagram, schema, or document under discussion.
Ignore browser chrome, taskbars, chat sidebars, wallpaper, and this assistant's own floating window.
Return JSON. "question" is a short restatement of the task or error in one sentence. "answer" solves or explains it directly — do not narrate the screenshot.
For a coding problem or bug fix, start the answer with one fenced code block tagged with its language (use the language visible on screen, or Python when none is shown), keep lines under 60 characters, then give at most two short sentences on the approach, the fix, and time/space complexity when relevant.
For a multiple-choice question, name the correct option first, then one or two sentences on why.
If the screenshot shows no readable task or error, set requests_answer=false with an empty question and answer.
Answer in the language named by preferences.language (English when absent), keeping code and technical terms in English. Never claim personal experience. Never describe yourself as an AI. No preamble.`;

/**
 * Reads the visible task from a screenshot and answers it.
 * Streams previews through onPartial and returns null when the provider cannot help.
 */
export async function analyzeScreenWithGemini(
  image: { data: string; mime: ScreenImageType },
  preferences: Record<string, unknown>,
  context: InterviewContext | null,
  onPartial: (preview: AnswerPreview) => void,
  signal: AbortSignal,
): Promise<ScreenReply | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const language = typeof preferences.language === "string" ? preferences.language.slice(0, 40) : "English";
  const role = typeof preferences.role === "string" ? preferences.role.slice(0, 120) : "";
  const prompt = JSON.stringify({ preferences: { language, ...(role ? { role } : {}) }, ...(context ? { recent_topics: context.earlier_topics.slice(-4).map(topic => topic.question.slice(0, 160)) } : {}) });
  const models = [...new Set([process.env.GEMINI_VISION_MODEL || "gemini-3.8-flash", "gemini-3.6-flash"])].slice(0, 2);
  for (const model of models) {
    if (signal.aborted) return null;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 25000);
    let emitted = false;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.any([signal, timeout.signal]),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ANALYZE_INSTRUCTION }] },
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mime, data: image.data } }] }],
          generationConfig: {
            responseMimeType: "application/json", maxOutputTokens: 2048, temperature: 0.2,
            responseSchema: { type: "OBJECT", propertyOrdering: ["requests_answer", "question", "answer"], properties: { requests_answer: { type: "BOOLEAN" }, question: { type: "STRING" }, answer: { type: "STRING" } }, required: ["requests_answer", "question", "answer"] },
            ...(/^gemini-3\.8/.test(model) ? { thinkingConfig: { thinkingLevel: "low" } } : { thinkingConfig: { thinkingLevel: "minimal" } }),
          },
        }),
      });
      if (!response.ok) { await response.body?.cancel(); continue; }
      const streamed = await readGeminiStream(response, raw => {
        const preview = previewInterviewJson(raw);
        if (preview?.question && preview.answer) { emitted = true; onPartial(preview); }
      });
      if (streamed.finishReason && streamed.finishReason !== "STOP") { if (emitted) return null; continue; }
      const parsed: unknown = JSON.parse(streamed.text);
      if (!parsed || typeof parsed !== "object") continue;
      const result = parsed as Record<string, unknown>;
      if (result.requests_answer !== true) return { question: "", answer: "" };
      if (typeof result.question !== "string" || typeof result.answer !== "string" || !result.answer.trim()) continue;
      return { question: result.question.trim().slice(0, 4000), answer: result.answer.trim() };
    } catch {
      if (emitted || signal.aborted) return null;
      // Try the fallback model within the request's budget.
    } finally { clearTimeout(timer); }
  }
  return null;
}
