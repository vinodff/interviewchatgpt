export type AnswerPreview = { question: string; answer: string; speaker_role: "interviewer" | "user" | "unknown"; transcript?: string };
export type ProviderUsage = { input_tokens: number; output_tokens: number; thinking_tokens: number };
export function providerUsage(value: unknown): ProviderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const count = (key: string) => typeof source[key] === "number" && Number.isFinite(source[key]) ? Math.max(0, Math.floor(source[key])) : 0;
  if (!["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount"].some(key => typeof source[key] === "number")) return undefined;
  return { input_tokens: count("promptTokenCount"), output_tokens: count("candidatesTokenCount"), thinking_tokens: count("thoughtsTokenCount") };
}

/** Decode only complete JSON escapes, retaining partial code and Unicode safely. */
export function previewInterviewJson(raw: string): AnswerPreview | null {
  if (!/"requests_answer"\s*:\s*true\b/.test(raw)) return null;
  const questionMatch = raw.match(/"question"\s*:\s*("(?:[^"\\]|\\.)*")/s);
  const start = /"answer"\s*:\s*"/.exec(raw);
  if (!questionMatch || !start) return null;
  let question: string;
  try { question = JSON.parse(questionMatch[1]); } catch { return null; }
  let answer = "";
  for (let i = start.index + start[0].length; i < raw.length; i++) {
    const character = raw[i];
    if (character === '"') break;
    if (character !== "\\") { answer += character; continue; }
    if (i + 1 >= raw.length) break;
    const escape = raw[++i];
    if (escape === "u") {
      if (i + 4 >= raw.length) break;
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) return null;
      answer += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else {
      const value = ({ '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[escape];
      if (value === undefined) return null;
      answer += value;
    }
  }
  const role = raw.match(/"speaker_role"\s*:\s*"(interviewer|user|unknown)"/)?.[1] as AnswerPreview["speaker_role"] | undefined;
  const transcriptMatch = raw.match(/"transcript"\s*:\s*("(?:[^"\\]|\\.)*")/s);
  let transcript: string | undefined;
  try { if (transcriptMatch) transcript = JSON.parse(transcriptMatch[1]); } catch { return null; }
  return { question, answer, speaker_role: role || "unknown", ...(transcript === undefined ? {} : { transcript }) };
}

/** Gemini SSE envelopes can span arbitrary network chunks. */
export async function readGeminiStream(response: Response, onText: (text: string) => void): Promise<{ text: string; finishReason: string; usage?: ProviderUsage }> {
  if (!response.body) throw new Error("Provider stream was empty");
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ""; let text = ""; let finishReason = "";
  let usage: ProviderUsage | undefined;
  const consume = (event: string) => {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const payload = JSON.parse(data);
    usage = providerUsage(payload.usageMetadata) || usage;
    const candidate = payload.candidates?.[0];
    if (payload.error) throw new Error("Provider stream failed");
    if (typeof candidate?.finishReason === "string") finishReason = candidate.finishReason;
    const addition = candidate?.content?.parts?.filter((part: { text?: string; thought?: boolean }) => !part.thought && typeof part.text === "string").map((part: { text: string }) => part.text).join("") || "";
    text += addition;
    if (text.length > 64000) throw new Error("Provider response exceeded limit");
    if (addition) onText(text);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index)); buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 100000) throw new Error("Provider event exceeded limit");
      if (done) { if (buffer.trim()) consume(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return { text, finishReason, ...(usage ? { usage } : {}) };
}
