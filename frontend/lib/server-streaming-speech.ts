import { streamingSpeechSetup, type StreamingSpeechTicket } from "./streaming-speech-config";

export async function createSpeechTicket(signal: AbortSignal): Promise<StreamingSpeechTicket | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const expires = Date.now() + 30 * 60000;
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]), cache: "no-store",
      // This is the REST wire name used by Google's SDK. With no fieldMask,
      // ALL setup fields (including absent tools/instructions) are locked.
      body: JSON.stringify({ uses: 1, expireTime: new Date(expires).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60000).toISOString(),
        bidiGenerateContentSetup: streamingSpeechSetup() }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("name" in body) || typeof body.name !== "string" || !body.name.startsWith("auth_tokens/") || body.name.length > 8192) return null;
    return { token: body.name, expires_at: expires };
  } catch { return null; }
}
