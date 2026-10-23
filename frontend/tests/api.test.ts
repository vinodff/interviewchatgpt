import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, post } from "../lib/api";
import { POST as legacyGenerate } from "../app/api/generate/route";
import config from "../next.config";

const fetchMock = vi.fn<typeof fetch>();
const storageAccess = vi.fn(() => { throw new Error("Stored data must not be accessed"); });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { hostname: "interview.example.com", host: "interview.example.com" }, get localStorage() { return storageAccess(); } });
  vi.stubGlobal("localStorage", { getItem: storageAccess, setItem: storageAccess, removeItem: storageAccess });
});
afterEach(() => vi.unstubAllGlobals());

describe("backend-only authenticated API", () => {
  it.each(["localhost", "127.0.0.1", "interview.example.com"])("uses the server and cookie credentials on %s", async hostname => {
    vi.stubGlobal("window", { location: { hostname }, get localStorage() { return storageAccess(); } });
    fetchMock.mockResolvedValueOnce(Response.json({ id: "actual-server-id" }));
    expect(await api("/projects", post({ name: "Project" }))).toEqual({ id: "actual-server-id" });
    const [url, options] = fetchMock.mock.calls[0]; expect(url).toBe("/api/projects");
    expect(options?.credentials).toBe("include"); expect(options?.cache).toBe("no-store");
    expect(new Headers(options?.headers).get("X-InterviewPilot")).toBe("1"); expect(new Headers(options?.headers).get("Content-Type")).toBe("application/json");
    expect(storageAccess).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409, 500])("propagates HTTP %i instead of creating a local success", async status => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "The server refused this request" }, { status }));
    await expect(api("/auth/me")).rejects.toMatchObject({ name: "ApiError", status }); expect(storageAccess).not.toHaveBeenCalled();
  });

  it("reports network failure without leaking raw transport diagnostics or writing local records", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("private transport diagnostics"));
    const failure = await api("/sessions", post({ consent: true })).catch(error => error as unknown);
    expect(failure).toBeInstanceOf(ApiError); expect(failure).toMatchObject({ status: 0, message: expect.stringContaining("interview service") });
    expect(String(failure)).not.toContain("private transport diagnostics"); expect(storageAccess).not.toHaveBeenCalled();
  });

  it("preserves AbortError and does not reinterpret cancellation as offline success", async () => {
    const abort = new DOMException("Cancelled", "AbortError"); fetchMock.mockRejectedValueOnce(abort);
    await expect(api("/sources")).rejects.toBe(abort); expect(storageAccess).not.toHaveBeenCalled();
    const request = new AbortController(); request.abort(); await expect(api("/sources", { signal: request.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not accept a late successful response after cancellation", async () => {
    const request = new AbortController(); fetchMock.mockImplementationOnce(async () => { request.abort(); return Response.json({ ok: true }); });
    await expect(api("/sources", { signal: request.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reports malformed success and HTML proxy errors without fabricating application data", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 })); await expect(api("/projects")).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(new Response("<html>internal proxy diagnostics</html>", { status: 503 }));
    await expect(api("/sessions")).rejects.toMatchObject({ status: 503, message: expect.not.stringContaining("diagnostics") });
  });

  it("does not echo secrets or internal exception traces from server errors", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "api_key=not-a-real-credential" }, { status: 400 }));
    await expect(api("/provider/check")).rejects.toMatchObject({ status: 400, message: expect.not.stringContaining("credential") });
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "Traceback: internal path and provider diagnostics" }, { status: 500 }));
    await expect(api("/provider/check")).rejects.toMatchObject({ status: 500, message: expect.not.stringContaining("Traceback") });
  });

  it("preserves safe validation feedback and leaves multipart boundaries to the browser", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: [{ msg: "File is too large", input: "private-content" }, null] }, { status: 422 }));
    await expect(api("/sources/upload")).rejects.toMatchObject({ status: 422, message: "File is too large" });
    fetchMock.mockResolvedValueOnce(Response.json({ id: "source" })); const form = new FormData(); form.append("file", new Blob(["source"]), "source.txt");
    await api("/sources/upload", { method: "POST", body: form }); expect(new Headers(fetchMock.mock.calls[1][1]?.headers).has("Content-Type")).toBe(false);
  });
});

describe("legacy generation and backend routing", () => {
  it("returns an explicit 410 without contacting AI or accepting a client credential", async () => {
    const response = legacyGenerate(); expect(response.status).toBe(410); expect(await response.json()).toEqual({ detail: expect.stringContaining("disabled") });
    expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("always rewrites API traffic to the configured backend in production as well as development", async () => {
    const rewrites = await config.rewrites?.(); expect(rewrites).toEqual([{ source: "/api/:path*", destination: `${(process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/api/:path*` }]);
  });
});
