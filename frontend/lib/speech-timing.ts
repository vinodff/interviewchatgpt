import { embeddedRequest, trailingTopicRequest, isIncompleteSpeech } from "./speech-request";
export { isIncompleteSpeech } from "./speech-request";

/** Follow-ups require an existing task; words alone never establish a new task. */
export function isContextFollowUp(text: string): boolean {
  const phrase = text.trim().replace(/^(?:okay[, ]+|ok[, ]+|and\s+|so\s+)/i, "").replace(/^(?:now|instead)[, ]+/i, "");
  return /^(?:same\b|do\s+(?:it|that|the same)\b|in\s+(?:python|javascript|typescript|java|c\+\+|c#|go|rust)(?=\s|[?!.;,]|$)|without\b|with\b|make\s+(?:it|that)\b|optimi[sz]e\b|rewrite\b|convert\b|(?:what|how) about\s+(?:its|that|this|their|memory|space|time|complexity|performance|edge cases)\b|why[?!.]?$|again[?!.]?$|explain\s+(?:that|this|the\s+(?:code|approach|solution))\b)/i.test(phrase)
    || /\b(?:that|this|earlier|previous|same)\s+(?:code|function|approach|solution|implementation)\b/i.test(text);
}

export type SpeechTiming = { delay_ms: number; allow_interim: boolean; kind: "incomplete" | "request" | "follow_up" | "speech" };
export function speechTiming({ text, final, hasContext, corrections = 0 }: { text: string; final: boolean; hasContext: boolean; corrections?: number }): SpeechTiming {
  const request = trailingTopicRequest(text) || embeddedRequest(text, true);
  if (isIncompleteSpeech(request || text)) return { delay_ms: 1900, allow_interim: false, kind: "incomplete" };
  const followUp = hasContext && isContextFollowUp(text);
  if (request || followUp) {
    const stableDelay = final ? /\?\s*$/.test(text) ? 250 : 350 : 450;
    return { delay_ms: stableDelay + (!final && corrections >= 2 ? 150 : 0), allow_interim: true, kind: followUp ? "follow_up" : "request" };
  }
  return { delay_ms: final ? 750 : 950, allow_interim: false, kind: "speech" };
}
