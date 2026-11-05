import { NextRequest, NextResponse } from "next/server";
import { AnswerStoppedError, generateAnswerWithGemini } from "@/lib/server-answer";
import { proxyBackend } from "@/lib/server-proxy";
import { isBrowserWorkspace } from "@/lib/workspace-mode";
import { sanitizeInterviewContext } from "@/lib/interview-memory";
import { transcribeMicrophone, validMicrophoneWav } from "@/lib/server-transcription";
import { createSpeechTicket } from "@/lib/server-streaming-speech";
import {
  chunkText,
  clearSessionCookie,
  formatUserResponse,
  getAuthenticatedUser,
  getServerSupabase,
  setSessionCookie
} from "@/lib/server-supabase";

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

  // If a dedicated Python FastAPI backend is running and configured, proxy non-browser requests to it.
  if (!isBrowserWorkspace() && process.env.BACKEND_INTERNAL_URL) {
    return proxyBackend(request, segments);
  }

  // In pure browser workspace mode, data is kept locally on device.
  if (isBrowserWorkspace()) {
    if (request.method === "GET" && path === "health") {
      return json({ status: "ok", database: "this browser", redis: "not used", ai_configured: Boolean(process.env.GEMINI_API_KEY), billing_configured: false });
    }
    if (!["live/answer", "live/transcribe", "live/speech-ticket", "provider/check"].includes(path)) {
      return json({ detail: "Browser workspace data is stored on this device. This server route is unavailable." }, 404);
    }
  }

  const serverSupabase = getServerSupabase();

  // 1. Health check
  if (request.method === "GET" && path === "health") {
    return json({
      status: "ok",
      database: serverSupabase ? "Supabase PostgreSQL" : "this browser",
      redis: "not used",
      ai_configured: Boolean(process.env.GEMINI_API_KEY),
      billing_configured: true
    });
  }

  // 2. Auth routes
  if (request.method === "GET" && path === "auth/me") {
    if (!serverSupabase) {
      return json({ detail: "Sign in is required or your credentials were not accepted." }, 401);
    }
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required or your credentials were not accepted." }, 401);
    return json(auth.user);
  }

  if (path === "auth/logout") {
    const response = json({ ok: true });
    clearSessionCookie(response);
    return response;
  }

  if (request.method === "POST" && path === "auth/supabase-session") {
    if (!serverSupabase) return json({ detail: "Supabase authentication is not configured." }, 503);
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch { /* ignore */ }
    const token = typeof body?.access_token === "string" ? body.access_token.trim() : "";
    if (!token) return json({ detail: "A valid Supabase access token is required." }, 400);
    const { data: { user: authUser }, error } = await serverSupabase.auth.getUser(token);
    if (error || !authUser) return json({ detail: "Invalid Supabase session token." }, 401);
    let { data: userRow } = await serverSupabase.from("users").select("*").eq("id", authUser.id).maybeSingle();
    if (!userRow && authUser.email && Boolean(authUser.email_confirmed_at)) {
      const { data: byEmail } = await serverSupabase.from("users").select("*").eq("email", authUser.email).maybeSingle();
      if (byEmail) userRow = byEmail;
    }
    if (!userRow) {
      const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "User";
      const { data: created } = await serverSupabase.from("users").insert({
        id: authUser.id,
        email: authUser.email || "",
        name,
        password_hash: "supabase_oauth",
        plan: "free",
        credit_seconds: 0,
        profile: {},
        preferences: {},
        created_at: new Date().toISOString(),
      }).select().single();
      userRow = created;
    }
    if (!userRow) return json({ detail: "Could not create user record." }, 500);
    const userObj = await formatUserResponse(serverSupabase, userRow);
    const response = json(userObj);
    setSessionCookie(response, token);
    return response;
  }

  // 3. User profile & preferences
  if (request.method === "PATCH" && path === "profile") {
    if (!serverSupabase) return json({ detail: "Sign in is required." }, 401);
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch { /* ignore */ }
    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.phone === "string") updates.phone = body.phone.trim();
    if (typeof body.github_username === "string") updates.github_username = body.github_username.trim();
    if (body.preferences && typeof body.preferences === "object") {
      const { data: userRow } = await serverSupabase.from("users").select("preferences").eq("id", auth.authId).single();
      updates.preferences = { ...((userRow?.preferences as Record<string, unknown>) || {}), ...(body.preferences as Record<string, unknown>) };
    }
    const { data: updatedUser } = await serverSupabase.from("users").update(updates).eq("id", auth.authId).select().single();
    if (!updatedUser) return json({ detail: "Could not update user." }, 500);
    const formatted = await formatUserResponse(serverSupabase, updatedUser);
    return json(formatted);
  }

  // 4. Projects routes
  if (path === "projects") {
    if (request.method === "GET") {
      if (!serverSupabase) return json([]);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json([]);
      const { data } = await serverSupabase.from("projects").select("*").eq("user_id", auth.authId).order("created_at", { ascending: false });
      return json((data || []).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        analysis: p.analysis || {},
        source_count: 0,
        created_at: p.created_at,
      })));
    }
    if (request.method === "POST") {
      if (!serverSupabase) return json({ detail: "Sign in is required." }, 401);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json({ detail: "Sign in is required." }, 401);
      const body = await request.json().catch(() => ({}));
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name) return json({ detail: "Project name is required." }, 422);
      const newProj = {
        id: crypto.randomUUID(),
        user_id: auth.authId,
        name,
        description: typeof body?.description === "string" ? body.description.trim() : "",
        analysis: {},
        created_at: new Date().toISOString()
      };
      const { data, error } = await serverSupabase.from("projects").insert(newProj).select().single();
      if (error || !data) return json({ detail: "Could not create project." }, 500);
      return json({ id: data.id, name: data.name, description: data.description, analysis: data.analysis, source_count: 0, created_at: data.created_at }, 201);
    }
  }

  if (request.method === "DELETE" && segments[0] === "projects" && segments.length === 2) {
    if (!serverSupabase) return json({ ok: true });
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    const projectId = segments[1];
    await serverSupabase.from("sources").delete().eq("project_id", projectId).eq("user_id", auth.authId);
    await serverSupabase.from("projects").delete().eq("id", projectId).eq("user_id", auth.authId);
    return json({ ok: true });
  }

  // 5. Sources routes
  if (path === "sources") {
    if (request.method === "GET") {
      if (!serverSupabase) return json([]);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json([]);
      const { data } = await serverSupabase.from("sources").select("*").eq("user_id", auth.authId).order("created_at", { ascending: false });
      return json((data || []).map(s => ({
        id: s.id,
        project_id: s.project_id || null,
        name: s.name,
        kind: s.kind || "document",
        status: s.status || "ready",
        error: s.error || null,
        chunk_count: s.chunk_count || 0,
        created_at: s.created_at,
      })));
    }
  }

  if (request.method === "POST" && path === "sources/upload") {
    if (!serverSupabase) return json({ detail: "Sign in is required." }, 401);
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    let formData: FormData;
    try { formData = await request.formData(); } catch { return json({ detail: "Multipart form data is required." }, 400); }
    const file = formData.get("file") as File | null;
    const projectId = (formData.get("project_id") as string | null) || null;
    if (!file) return json({ detail: "No file was uploaded." }, 422);
    const fileName = file.name || "resume.txt";
    const ext = fileName.split(".").pop()?.toLowerCase() || "txt";
    let extractedText = "";
    if (ext === "pdf" || file.type === "application/pdf") {
      try {
        const { extractText } = await import("unpdf");
        const buffer = await file.arrayBuffer();
        const res = await extractText(new Uint8Array(buffer));
        extractedText = Array.isArray(res.text) ? res.text.join("\n\n") : (res.text || "");
      } catch (e) {
        console.warn("PDF extraction warning:", e);
      }
    }
    if (!extractedText) {
      try { extractedText = await file.text(); } catch { extractedText = ""; }
    }
    const cleaned = extractedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g, " ").trim();
    const chunks = chunkText(cleaned, 800, 100);
    const sourceId = "src_" + crypto.randomUUID();
    const kind = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : "document";
    const newSource = {
      id: sourceId,
      user_id: auth.authId,
      project_id: projectId,
      name: fileName,
      kind,
      mime_type: file.type || "text/plain",
      storage_path: "",
      url: "",
      sha256: "",
      status: "ready",
      error: null,
      chunk_count: chunks.length,
      attempts: 1,
      analysis: {},
      created_at: new Date().toISOString()
    };
    await serverSupabase.from("sources").insert(newSource);
    if (chunks.length > 0) {
      const chunkRows = chunks.map((chunk, i) => ({
        id: `chk_${sourceId}_${i}`,
        user_id: auth.authId,
        source_id: sourceId,
        project_id: projectId,
        text: chunk,
        locator: `Section ${i + 1}`,
        verified_contribution: false,
        metadata_json: {}
      }));
      for (let i = 0; i < chunkRows.length; i += 50) {
        await serverSupabase.from("chunks").insert(chunkRows.slice(i, i + 50));
      }
    }
    return json({
      id: sourceId,
      project_id: projectId,
      name: fileName,
      kind,
      status: "ready",
      error: null,
      chunk_count: chunks.length,
      created_at: newSource.created_at
    }, 201);
  }

  if (request.method === "POST" && segments[0] === "sources" && segments[2] === "retry") {
    return json({ ok: true });
  }

  if (request.method === "DELETE" && segments[0] === "sources" && segments.length === 2) {
    if (!serverSupabase) return json({ ok: true });
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    const sourceId = segments[1];
    await serverSupabase.from("chunks").delete().eq("source_id", sourceId).eq("user_id", auth.authId);
    await serverSupabase.from("sources").delete().eq("id", sourceId).eq("user_id", auth.authId);
    return json({ ok: true });
  }

  // 6. Sessions routes
  if (path === "sessions") {
    if (request.method === "GET") {
      if (!serverSupabase) return json([]);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json([]);
      const { data } = await serverSupabase.from("live_sessions").select("*").eq("user_id", auth.authId).order("created_at", { ascending: false }).limit(100);
      return json((data || []).map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        audio_mode: s.audio_mode,
        retention: s.retention,
        created_at: s.created_at,
        ended_at: s.ended_at,
        summary: s.summary || "",
        metrics: s.metrics || {},
      })));
    }
    if (request.method === "POST") {
      if (!serverSupabase) return json({ detail: "Sign in is required." }, 401);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json({ detail: "Sign in is required." }, 401);
      let body: Record<string, unknown> = {};
      try { body = await request.json(); } catch { /* ignore */ }
      const newSession = {
        id: "sess_" + crypto.randomUUID(),
        user_id: auth.authId,
        title: typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Live conversation",
        status: "created",
        audio_mode: body?.audio_mode === "tab" ? "tab" : "microphone",
        retention: body?.retention !== false,
        consent_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        billed_seconds: 0,
        summary: "",
        metrics: {}
      };
      const { data, error } = await serverSupabase.from("live_sessions").insert(newSession).select().single();
      if (error || !data) return json({ detail: "Could not create session." }, 500);
      return json(data, 201);
    }
  }

  if (segments[0] === "sessions" && segments.length === 2) {
    if (request.method === "GET") {
      if (!serverSupabase) return json({ detail: "Session not found." }, 404);
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json({ detail: "Sign in is required." }, 401);
      const sessionId = segments[1];
      const { data: session } = await serverSupabase.from("live_sessions").select("*").eq("id", sessionId).eq("user_id", auth.authId).maybeSingle();
      if (!session) return json({ detail: "Session not found." }, 404);
      const { data: turns } = await serverSupabase.from("turns").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }).limit(500);
      return json({
        id: session.id,
        title: session.title,
        status: session.status,
        audio_mode: session.audio_mode,
        retention: session.retention,
        created_at: session.created_at,
        ended_at: session.ended_at,
        summary: session.summary || "",
        metrics: session.metrics || {},
        turns: (turns || []).map(t => ({
          id: t.id,
          role: t.role,
          text: t.text,
          question: t.question,
          answer: t.answer,
          evidence: t.evidence || [],
          created_at: t.created_at
        }))
      });
    }
    if (request.method === "DELETE") {
      if (!serverSupabase) return json({ ok: true });
      const auth = await getAuthenticatedUser(request);
      if (!auth) return json({ detail: "Sign in is required." }, 401);
      const sessionId = segments[1];
      await serverSupabase.from("turns").delete().eq("session_id", sessionId);
      await serverSupabase.from("live_sessions").delete().eq("id", sessionId).eq("user_id", auth.authId);
      return json({ ok: true });
    }
  }

  if (request.method === "POST" && segments[0] === "sessions" && segments[2] === "stop") {
    if (!serverSupabase) return json({ ok: true });
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    const sessionId = segments[1];
    const { data } = await serverSupabase.from("live_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sessionId).eq("user_id", auth.authId).select().maybeSingle();
    return json(data || { ok: true });
  }

  if (request.method === "POST" && segments[0] === "sessions" && segments[2] === "turn") {
    if (!serverSupabase) return json({ ok: true }, 201);
    const auth = await getAuthenticatedUser(request);
    if (!auth) return json({ detail: "Sign in is required." }, 401);
    const sessionId = segments[1];
    let body: Record<string, unknown> = {};
    try { body = await request.json(); } catch { /* ignore */ }
    const turnRow = {
      id: typeof body.id === "string" ? body.id : "turn_" + crypto.randomUUID(),
      session_id: sessionId,
      role: typeof body.role === "string" ? body.role : "unknown",
      text: typeof body.text === "string" ? body.text : "",
      question: typeof body.question === "string" ? body.question : "",
      answer: typeof body.answer === "string" ? body.answer : "",
      evidence: Array.isArray(body.evidence) ? body.evidence : [],
      latency_ms: typeof body.latency_ms === "number" ? body.latency_ms : null,
      created_at: typeof body.created_at === "string" ? body.created_at : new Date().toISOString()
    };
    await serverSupabase.from("turns").insert(turnRow);
    return json({ ok: true }, 201);
  }

  // 7. Knowledge search
  if (request.method === "GET" && path === "knowledge/search") {
    if (!serverSupabase) return json([]);
    const auth = await getAuthenticatedUser(request);
    const query = new URL(request.url).searchParams.get("q") || "";
    if (!auth || !query.trim()) return json([]);
    const { data: chunks } = await serverSupabase
      .from("chunks")
      .select("id, source_id, project_id, text, locator")
      .eq("user_id", auth.authId)
      .ilike("text", `%${query.trim()}%`)
      .limit(5);
    return json((chunks || []).map(c => ({
      id: c.id,
      source_id: c.source_id,
      project_id: c.project_id,
      source_name: "Uploaded source",
      text: c.text,
      score: 0.95,
      locator: c.locator || "",
      verified_contribution: false
    })));
  }

  // 8. Live AI routes: live/answer, live/transcribe, live/speech-ticket, provider/check
  if (!["live/answer", "live/transcribe", "live/speech-ticket", "provider/check"].includes(path)) {
    return json({ detail: "This server route is unavailable." }, 404);
  }

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
