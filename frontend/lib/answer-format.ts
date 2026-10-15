import { tokenizeAnswer, type AnswerWord } from "./answer-reader";

export type AnswerSegment = { kind: "text" | "code" | "fence"; start: number; end: number; language?: string };
const MAX_FORMAT_LENGTH = 200_000;
const MAX_CODE_BLOCKS = 48;
const FENCE = /^ {0,3}(`{3,16}|~{3,16})([^\r\n]*)$/;

/** Parse a small, bounded fenced-code subset, keeping every original UTF-16 offset. */
export function formatAnswer(answer: string): AnswerSegment[] {
  if (!answer) return [];
  if (answer.length > MAX_FORMAT_LENGTH) return [{ kind: "text", start: 0, end: answer.length }];
  const segments: AnswerSegment[] = [];
  let cursor = 0;
  let blocks = 0;
  let open: { marker: string; start: number; language?: string } | null = null;
  for (let start = 0; start < answer.length;) {
    const newline = answer.indexOf("\n", start);
    const end = newline < 0 ? answer.length : newline + 1;
    const line = answer.slice(start, newline < 0 ? end : newline).replace(/\r$/, "");
    const fence = FENCE.exec(line);
    if (fence && open && fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length && !fence[2].trim()) {
      segments.push({ kind: "code", start: open.start, end: start, language: open.language }, { kind: "fence", start, end });
      cursor = end; open = null;
      if (blocks === MAX_CODE_BLOCKS) break;
    } else if (fence && !open && !(fence[1][0] === "`" && fence[2].includes("`"))) {
      if (start > cursor) segments.push({ kind: "text", start: cursor, end: start });
      segments.push({ kind: "fence", start, end });
      const language = /^[\w+#.-]{1,32}(?=\s|$)/.exec(fence[2].trim())?.[0].toLowerCase();
      open = { marker: fence[1], start: end, language }; blocks++;
    }
    start = end;
  }
  if (open) segments.push({ kind: "code", start: open.start, end: answer.length, language: open.language });
  else if (cursor < answer.length) segments.push({ kind: "text", start: cursor, end: answer.length });
  return segments;
}

/** Fence markers and language labels are excluded from the reading guide. */
export function formattedAnswerWords(answer: string, segments: readonly AnswerSegment[]): AnswerWord[] {
  return segments.flatMap(segment => segment.kind === "fence" ? [] : tokenizeAnswer(answer.slice(segment.start, segment.end)).map(word => ({ ...word, start: word.start + segment.start, end: word.end + segment.start })));
}
