export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

const backendUnavailable = "The backend service is unavailable. Check that the backend is running and configured, then try again.";

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
  if (status === 404 || status === 410) return "This server resource is unavailable. Refresh your workspace and try again.";
  if (status === 409) return "This request conflicts with the current server state. Refresh your workspace and try again.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  return "The server could not complete this request. Check your input and try again.";
}

/** Use the authenticated backend on every hostname; failures never become local data. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  options.signal?.throwIfAborted();
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
    throw new ApiError("The backend returned an invalid response. Refresh your workspace and try again.", 502);
  }
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
