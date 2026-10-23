import { NextRequest, NextResponse } from "next/server";

/** Forward authenticated responses faithfully, including failures and every cookie. */
export async function proxyBackend(request: NextRequest, segments: string[]): Promise<NextResponse> {
  const backend = process.env.BACKEND_INTERNAL_URL;
  const unavailable = () => NextResponse.json({ detail: "The backend service is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!backend) return unavailable();
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const key of ["host", "connection", "content-length", "transfer-encoding", "accept-encoding"]) headers.delete(key);
  headers.set("X-InterviewPilot", "1");
  try {
    const response = await fetch(`${backend.replace(/\/$/, "")}/api/${segments.map(encodeURIComponent).join("/")}${url.search}`, {
      method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]),
    });
    const forwarded = new Headers(response.headers);
    for (const key of ["connection", "transfer-encoding", "content-length", "content-encoding"]) forwarded.delete(key);
    forwarded.set("Cache-Control", "no-store");
    return new NextResponse(response.body, { status: response.status, headers: forwarded });
  } catch { return unavailable(); }
}
