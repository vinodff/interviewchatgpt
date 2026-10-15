export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("X-InterviewPilot", "1");
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: "include", cache: "no-store" });
  if (!response.ok) {
    let detail = "The service could not complete this request. Please try again.";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body && typeof body.detail === "string") detail = body.detail;
      else if (body && typeof body === "object" && "detail" in body && Array.isArray(body.detail)) detail = body.detail.map((item: { msg?: string; loc?: string[] }) => `${item.loc?.slice(1).join(" ") || "Request"}: ${item.msg || "invalid value"}`).join(". ");
    } catch { /* A proxy failure may return HTML; show a readable error. */ }
    throw new ApiError(detail, response.status);
  }
  return await response.json() as T;
}

export const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";
export const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
export const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
