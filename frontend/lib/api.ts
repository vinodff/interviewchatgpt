export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

const backendUnavailable = "We can’t connect to the interview service. Please try again in a moment.";

function isAbort(error: unknown, signal?: AbortSignal | null): boolean {
  return signal?.aborted === true || error instanceof Error && error.name === "AbortError";
}

function safeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!text || text.length > 500 || /AIza|\bBearer\s+\S|\b(?:api[_ -]?key|secret|password|authorization|access[_ -]?token)\s*[:=]|[?&](?:key|token|secret|signature)=|Traceback|\bat\s+\S+\s+\([^)]*:\d+:\d+\)/i.test(text)) return null;
  return text;
}

function errorDetail(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const direct = safeText(body.detail);
  if (direct) return direct;
  if (!Array.isArray(body.detail)) return null;
  const messages: string[] = [];
  for (const value of body.detail.slice(0, 3)) {
    if (!value || typeof value !== "object" || !("msg" in value)) continue;
    const message = safeText(value.msg);
    if (message) messages.push(message);
  }
  return messages.length ? messages.join(". ") : null;
}

function defaultError(status: number): string {
  if (status >= 500) return backendUnavailable;
  if (status === 401) return "Sign in is required or your credentials were not accepted.";
  if (status === 403) return "You do not have permission to complete this request.";
  if (status === 404 || status === 410) return "We couldn’t find this item. Refresh the page and try again.";
  if (status === 409) return "This item changed. Refresh the page and try again.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "The server could not complete this request. Check your input and try again.";
}

/** Workspace storage is explicit; a failed backend call never changes modes. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  options.signal?.throwIfAborted();
  if (isBrowserWorkspace() && !["/health", "/provider/check", "/live/answer", "/live/transcribe", "/live/speech-ticket"].includes(path)) {
    const { handleBrowserStorageRequest } = await import("./browser-storage");
    options.signal?.throwIfAborted();
    const result = await handleBrowserStorageRequest<T>(path, options);
    options.signal?.throwIfAborted();
    return result;
  }
  const headers = new Headers(options.headers);
  headers.set("X-InterviewPilot", "1");
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
    options.signal?.throwIfAborted();
  } catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new ApiError(backendUnavailable, 0);
  }
  if (!response.ok) {
    let detail: string | null = null;
    // Internal and proxy failures must not echo provider credentials or stack traces.
    if (response.status < 500) {
      try { detail = errorDetail(await response.json()); }
      catch (error) { if (isAbort(error, options.signal)) throw error; }
    }
    throw new ApiError(detail || defaultError(response.status), response.status);
  }
  try { const result: unknown = await response.json(); options.signal?.throwIfAborted(); return result as T; }
  catch (error) {
    if (isAbort(error, options.signal)) throw error;
    throw new ApiError("We couldn’t load that information. Refresh the page and try again.", 502);
  }
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Consume same-origin answer events as they arrive; never buffer the whole answer. */
export async function streamApi(path: string, options: RequestInit, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const headers = new Headers(options.headers);
  headers.set("X-InterviewPilot", "1"); headers.set("Content-Type", "application/json");
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers, credentials: "include", cache: "no-store" }); }
  catch (error) { if (isAbort(error, options.signal)) throw error; throw new ApiError(backendUnavailable, 0); }
  if (!response.ok) {
    let detail: string | null = null;
    try { detail = errorDetail(await response.json()); } catch { /* Use the status message. */ }
    throw new ApiError(detail || defaultError(response.status), response.status);
  }
  if (!response.body || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) throw new ApiError("The answer service returned an invalid stream.", 502);
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new ApiError("The answer stream was invalid.", 502);
    onEvent(event as Record<string, unknown>);
  };
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (buffer.length > 100000) throw new ApiError("The answer stream exceeded its limit.", 502);
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
import { isBrowserWorkspace } from "./workspace-mode";
