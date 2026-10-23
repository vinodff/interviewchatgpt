import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/[...path]/route";
const fetchMock = vi.fn<typeof fetch>();
const params = { params: Promise.resolve({ path: ["live", "speech-ticket"] }) };
let ip = 0;
const request = (body: unknown = {}, headers = {}) => new NextRequest("http://localhost/api/live/speech-ticket", { method: "POST", body: JSON.stringify(body), headers: { "X-InterviewPilot": "1", "x-real-ip": `speech-test-${++ip}`, ...headers } });
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_WORKSPACE_MODE", "browser"); vi.stubEnv("GEMINI_API_KEY", "server-only-secret"); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("constrained streaming speech tickets", () => {
  it("returns only a one-session ephemeral credential with all setup parameters locked", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ name: "auth_tokens/short-lived", private: "not returned" }));
    const response = await POST(request(), params); const ticket = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(Object.keys(ticket).sort()).toEqual(["expires_at", "token"]); expect(JSON.stringify(ticket)).not.toContain("server-only-secret");
    const [url, options] = fetchMock.mock.calls[0]; expect(String(url)).not.toContain("server-only-secret");
    const wire = JSON.parse(String(options?.body)); expect(wire.uses).toBe(1); expect(wire.fieldMask).toBeUndefined();
    expect(wire.bidiGenerateContentSetup).toMatchObject({ model: "models/gemini-3.5-transcribe-live", generationConfig: { responseModalities: ["TEXT"] }, inputAudioTranscription: { languageCodes: ["en-IN", "en-US"], mode: "VERBATIM" } });
    expect(new Date(wire.newSessionExpireTime).getTime() - Date.now()).toBeLessThanOrEqual(60000);
  });
  it.each([{ model: "arbitrary" }, { uses: 100 }, { tools: [] }])("rejects client configuration overrides", async body => { expect((await POST(request(body), params)).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled(); });
  it("blocks cross-origin requests and unsupported methods", async () => {
    expect((await POST(request({}, { Origin: "https://evil.test" }), params)).status).toBe(403);
    expect((await GET(new NextRequest("http://localhost/api/live/speech-ticket", { headers: { "X-InterviewPilot": "1", "x-real-ip": `speech-get-${++ip}` } }), params)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("caps token issuance separately from answer requests", async () => {
    fetchMock.mockImplementation(async () => Response.json({ name: "auth_tokens/limited" }));
    const headers = { "x-real-ip": `limit-speech-${++ip}` };
    for (let i = 0; i < 4; i++) expect((await POST(request({}, headers), params)).status).toBe(200);
    expect((await POST(request({}, headers), params)).status).toBe(429); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it.each([new Response("private provider details", { status: 429 }), Response.json({ name: "long-lived-key" }), Response.json({ name: 1 })])("never exposes provider error bodies or invalid credentials", async upstream => {
    fetchMock.mockResolvedValueOnce(upstream); const response = await POST(request(), params);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/private provider|long-lived-key|server-only-secret/);
  });
});
