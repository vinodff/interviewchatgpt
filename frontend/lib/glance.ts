import { formatAnswer } from "./answer-format";

/** A condensed answer for a quick look during the conversation. */
export type Glance =
  | { kind: "points"; points: string[] }
  | { kind: "code"; code: string; language?: string; note: string };

const MAX_POINTS = 3;
const MAX_POINT_WORDS = 14;
/** Answers this short are already glanceable; condensing them would only lose words. */
const MIN_WORDS_TO_CONDENSE = 32;

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const stripMarkdown = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#{1,6}\s+/, "").trim();

function shorten(text: string, limit = MAX_POINT_WORDS): string {
  const parts = words(stripMarkdown(text));
  if (parts.length <= limit) return parts.join(" ");
  return `${parts.slice(0, limit).join(" ").replace(/[,;:]$/, "")}…`;
}

/** Sentence split that keeps decimals ("3.5") and common abbreviations ("e.g.") intact. */
export function sentencesOf(text: string): string[] {
  const protectedText = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Ms|Dr)\./gi, match => match.replace(/\./g, "\u0000"));
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map(sentence => sentence.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

function listItems(text: string): string[] {
  return text.split(/\r?\n/).map(line => /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)?.[1]?.trim() || "").filter(Boolean);
}

/**
 * Condense an answer into at most three short points, or the code it contains.
 * Returns null when the answer is empty or already short; callers then show the full answer.
 */
export function glanceOf(answer: string): Glance | null {
  const text = answer.trim();
  if (!text) return null;
  const segments = formatAnswer(text);
  const code = segments.find(segment => segment.kind === "code");
  const prose = segments.filter(segment => segment.kind === "text").map(segment => text.slice(segment.start, segment.end)).join("\n").trim();
  if (code) {
    const body = text.slice(code.start, code.end).replace(/\s+$/, "");
    if (!body.trim()) return null;
    const firstSentence = sentencesOf(prose.replace(/\s+/g, " "))[0] || "";
    return { kind: "code", code: body, ...(code.language ? { language: code.language } : {}), note: firstSentence ? shorten(firstSentence, 20) : "" };
  }
  if (words(text).length < MIN_WORDS_TO_CONDENSE) return null;
  const items = listItems(text);
  if (items.length >= 2) return { kind: "points", points: items.slice(0, MAX_POINTS).map(item => shorten(item)) };
  const sentences = sentencesOf(text.replace(/\s+/g, " "));
  if (sentences.length < 2) return null;
  return { kind: "points", points: sentences.slice(0, MAX_POINTS).map(sentence => shorten(sentence)) };
}
