import { NextRequest, NextResponse } from "next/server";
import { AnswerStoppedError, generateAnswerWithGemini } from "@/lib/server-answer";
import { proxyBackend } from "@/lib/server-proxy";
import { isBrowserWorkspace } from "@/lib/workspace-mode";
import { sanitizeInterviewContext } from "@/lib/interview-memory";
import { transcribeMicrophone, validMicrophoneWav } from "@/lib/server-transcription";
import { createSpeechTicket } from "@/lib/server-streaming-speech";

export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const limits = new Map<string, { count: number; expires: number }>();

function limited(request: NextRequest, transcription = false, ticket = false): boolean {
  const now = Date.now();
  for (const [key, value] of limits) if (value.expires <= now) limits.delete(key);
  const key = `${ticket ? "ticket" : transcription ? "audio" : "answer"}:${request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"}`;
  const value = limits.get(key) || { count: 0, expires: now + 60000 };
  if (limits.size >= 1000 && !limits.has(key)) return true;
  value.count++; limits.set(key, value);
  return value.count > (ticket ? 4 : transcription ? 60 : 30);
}

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const path = segments.join("/");
  if (!isBrowserWorkspace()) return proxyBackend(request, segments);
  if (request.method === "GET" && path === "health") {
    return json({ status: "ok", database: "this browser", redis: "not used", ai_configured: Boolean(process.env.GEMINI_API_KEY), billing_configured: false });
  }
  if (!["live/answer", "live/transcribe", "live/speech-ticket", "provider/check"].includes(path)) return json({ detail: "Browser workspace data is stored on this device. This server route is unavailable." }, 404);
  let trustedOrigin = true;
  const origin = request.headers.get("origin");
  if (origin) {
    try { trustedOrigin = new URL(origin).host === (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host); }
    catch { trustedOrigin = false; }
  }
  if (request.headers.get("X-InterviewPilot") !== "1" || request.headers.get("sec-fetch-site") === "cross-site" || !trustedOrigin) {
    return json({ detail: "Open the workspace on this site to use the AI service." }, 403);
  }
  if (limited(request, path === "live/transcribe", path === "live/speech-ticket")) return json({ detail: "Too many requests. Wait a minute and try again." }, 429);
  if (!process.env.GEMINI_API_KEY) return json({ detail: "The AI provider is not configured. Add GEMINI_API_KEY on the server." }, 503);
  if (path === "provider/check" && request.method === "GET") {
    const answer = await generateAnswerWithGemini("What is a hash map? Reply in one short sentence.");
    return answer?.answer ? json({ ok: true, detail: "The AI provider responded successfully." }) : json({ detail: "The AI provider did not respond. Check its key, model access, and quota." }, 503);
  }
  if (!["live/answer", "live/transcribe", "live/speech-ticket"].includes(path) || request.method !== "POST") return json({ detail: "Method not allowed." }, 405);
  // Limit actual bytes as well as Content-Length before parsing untrusted JSON.
  const reader = request.body?.getReader();
  if (!reader) return json({ detail: "A JSON body is required." }, 400);
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > (path === "live/speech-ticket" ? 2048 : path === "live/transcribe" ? 400000 : 100000)) { await reader.cancel(); return json({ detail: "Request context is too large." }, 413); }
    parts.push(value);
  }
  let body: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch { return json({ detail: "Send a valid JSON object." }, 400); }
  if (path === "live/speech-ticket") {
    if (Object.keys(body).length) return json({ detail: "Speech configuration is managed by the server." }, 400);
    const ticket = await createSpeechTicket(request.signal);
    return ticket ? json(ticket) : json({ detail: "Streaming recognition is unavailable. Select Enhanced microphone and restart." }, 503);
  }
  if (path === "live/transcribe") {
    const audio = validMicrophoneWav(body.audio);
    if (!audio) return json({ detail: "Send a microphone WAV segment of at most six seconds." }, 400);
    if (body.fast_answer === true) {
      const context = sanitizeInterviewContext(body.interview_context);
      if (!context || !body.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences) || typeof body.prefix !== "string" || body.prefix.length > 4000) return json({ detail: "Invalid audio answer context." }, 400);
      const preferences = body.preferences as Record<string, unknown>;
      const clip = { data: audio, prefix: body.prefix, overlap: body.overlap === true };
      if (body.stream === true) {
        const cancellation = new AbortController(); const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: unknown) => { if (!cancellation.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
            try {
              const reply = await generateAnswerWithGemini("", preferences, [], [], [], preview => {
                if (typeof preview.transcript === "string" && preview.transcript.length <= 3000) {
                  const { transcript, ...answer } = preview;
                  send({ type: "preview", text: transcript, reply: { requests_answer: true, ...answer } });
                }
              }, AbortSignal.any([request.signal, cancellation.signal]), context, clip);
              if (reply && typeof reply.transcript === "string") {
                const { transcript, ...answer } = reply;
                send({ type: "complete", text: transcript, reply: answer });
              } else send({ type: "error", detail: "Audio understanding is unavailable. Please repeat the question." });
            } catch (error) { send({ type: "error", detail: error instanceof AnswerStoppedError ? error.message : "The audio connection was interrupted. Please repeat the question." }); }
            finally { if (!cancellation.signal.aborted) controller.close(); }
          },
          cancel() { cancellation.abort(); },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no" } });
      }
      const reply = await generateAnswerWithGemini("", preferences, [], [], [], undefined, request.signal, context, clip);
      if (!reply || typeof reply.transcript !== "string") return json({ detail: "Audio understanding is unavailable. Please repeat the question." }, 503);
      const { transcript, ...answer } = reply;
      return json({ text: transcript, reply: answer });
    }
    const text = await transcribeMicrophone(audio, request.signal);
    return text === null ? json({ detail: "Audio transcription is unavailable. Restart the session or use Standard microphone mode." }, 503) : json({ text });
  }
  if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 4000) return json({ detail: "Question must contain 1–4000 characters." }, 400);
  if (body.preferences !== undefined && (!body.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences))) return json({ detail: "Preferences must be an object." }, 400);
  if (body.evidence !== undefined && !Array.isArray(body.evidence) || body.history !== undefined && !Array.isArray(body.history)) return json({ detail: "Evidence and history must be arrays." }, 400);
  const preferences = (body.preferences || {}) as Record<string, unknown>;
  const evidence = ((body.evidence || []) as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)).filter(item => typeof item.text === "string").slice(0, 5).map(item => ({
    ...item, text: String(item.text).slice(0, 4000), source_name: typeof item.source_name === "string" ? item.source_name.slice(0, 200) : "Uploaded source", verified_contribution: false,
  }));
  const history = ((body.history || []) as unknown[]).filter((item): item is Record<string, unknown> => !!item && typeof item === "object").filter(item => typeof item.question === "string" && typeof item.answer === "string").slice(-4).map(item => ({ question: String(item.question).slice(0, 4000), answer: String(item.answer).slice(0, 10000) }));
  const question = body.question.trim();
  if (body.request_focus !== undefined && (typeof body.request_focus !== "string" || body.request_focus.length > 4000)) return json({ detail: "Request focus must contain at most 4000 characters." }, 400);
  const requestFocus = typeof body.request_focus === "string" ? body.request_focus : undefined;
  const usedEvidence = (indices: number[]) => preferences.personalization === "technical" ? [] : evidence.slice(0, 3).filter((_, index) => indices.includes(index));
  const interviewContext = body.interview_context === undefined ? null : sanitizeInterviewContext(body.interview_context);
  if (body.interview_context !== undefined && !interviewContext) return json({ detail: "Interview context has an unsupported format." }, 400);
  const started = Date.now();
  const speechHistory = Array.isArray(body.speechHistory) ? body.speechHistory.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").filter(item => typeof item.text === "string").slice(-8).map(item => ({ role: ["user", "interviewer"].includes(String(item.role)) ? String(item.role) : "unknown", text: String(item.text).slice(0, 4000) })) : [];
  if (body.stream === true) {
    const cancellation = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => { if (!cancellation.signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
        try {
          const reply = await generateAnswerWithGemini(question, preferences, evidence, history, speechHistory, preview => send({ type: "preview", ...preview }), AbortSignal.any([request.signal, cancellation.signal]), interviewContext, undefined, requestFocus);
          if (reply) send({ type: "complete", ...reply, evidence: usedEvidence(reply.evidence_indices), latency_ms: Date.now() - started });
          else send({ type: "error", detail: "The AI provider is temporarily unavailable or its quota was reached. Please repeat the question." });
        } catch (error) { send({ type: "error", detail: error instanceof AnswerStoppedError ? error.message : "The answer connection was interrupted. Please repeat the question." }); }
        finally { if (!cancellation.signal.aborted) controller.close(); }
      },
      cancel() { cancellation.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no" } });
  }
  const reply = await generateAnswerWithGemini(question, preferences, evidence, history, speechHistory, undefined, request.signal, interviewContext, undefined, requestFocus);
  if (!reply) return json({ detail: "The AI provider could not answer. Check model access, quota, and connection, then try again." }, 503);
  return json({ ...reply, evidence: usedEvidence(reply.evidence_indices), keywords: question.split(/\s+/).filter(w => w.length > 2).slice(0, 5), latency_ms: Date.now() - started });
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
