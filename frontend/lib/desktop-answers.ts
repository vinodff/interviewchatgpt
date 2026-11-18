import type { LiveMessage } from "./protocol";

/** One question and its answer in the desktop answer card's history (the "2 / 5" pager). */
export type AnswerEntry = { id: string; question: string; answer: string; done: boolean };

export const MAX_ANSWER_ENTRIES = 40;

/**
 * Keep the answer history in step with live events. A cancelled answer was superseded or failed,
 * so it is removed rather than left half-written in the history.
 */
export function reduceAnswerEntries(entries: AnswerEntry[], event: LiveMessage): AnswerEntry[] {
  switch (event.type) {
    case "question":
      return [...entries.filter(entry => entry.id !== event.generation_id), { id: event.generation_id, question: event.question, answer: "", done: false }].slice(-MAX_ANSWER_ENTRIES);
    case "answer_delta":
      return entries.some(entry => entry.id === event.generation_id && !entry.done)
        ? entries.map(entry => entry.id === event.generation_id && !entry.done ? { ...entry, answer: entry.answer + event.text } : entry)
        : entries;
    case "answer_complete":
      return entries.map(entry => entry.id === event.generation_id ? { ...entry, answer: event.answer, done: true } : entry);
    case "answer_cancelled":
      return entries.filter(entry => entry.id !== event.generation_id);
    default:
      return entries;
  }
}

/**
 * Which entry the card shows. Following the latest moves with new answers;
 * once the user pages back, the view stays put until they jump to the latest again.
 */
export function visibleEntryIndex(count: number, selected: number | null): number {
  if (count === 0) return -1;
  if (selected === null) return count - 1;
  return Math.max(0, Math.min(count - 1, selected));
}

/**
 * The selection after paging by `delta` (‹ › buttons and Ctrl+Alt+←/→).
 * Reaching the newest answer goes back to following the latest (null).
 */
export function stepEntry(count: number, selected: number | null, delta: number): number | null {
  const index = visibleEntryIndex(count, selected);
  if (index < 0) return null;
  const next = Math.max(0, Math.min(count - 1, index + delta));
  return next >= count - 1 ? null : next;
}

/** One-tap follow-ups on an answer. */
export type RefineKind = "shorter" | "detail" | "example";
export const REFINE_OPTIONS: ReadonlyArray<{ kind: RefineKind; label: string }> = [
  { kind: "shorter", label: "Shorter" },
  { kind: "detail", label: "More detail" },
  { kind: "example", label: "Example" },
];
const QUESTION_LIMIT = 600;

/**
 * The request sent for a follow-up. It names the prior topic so it stands alone if context is thin.
 * Phrased as an explicit rewrite (not a fresh interview question) so the answer cache and the model
 * both treat it as a new generation rather than a repeat of the original question.
 */
export function refinePrompt(kind: RefineKind, question: string): string {
  const asked = question.replace(/\s+/g, " ").trim().slice(0, QUESTION_LIMIT) || "the last question";
  switch (kind) {
    case "shorter": return `Follow-up rewrite — shorter: take your previous answer about [${asked}] and rewrite it in two or three sentences I can say out loud. Do not repeat the long version.`;
    case "detail": return `Follow-up rewrite — more detail: expand your previous answer about [${asked}] with the key reasoning, trade-offs, and details an interviewer would probe.`;
    case "example": return `Follow-up rewrite — example: give one concrete, real-world example that illustrates your previous answer about [${asked}].`;
  }
}

/** What happened in a session, for the note shown after it ends. */
export type SessionStats = { answers: number; seconds: number };

export function sessionEndNotice(reason: string, stats: SessionStats): string {
  if (reason) return `Session ended: ${reason}`;
  const minutes = Math.round(stats.seconds / 60);
  const duration = minutes < 1 ? "under a minute" : `${minutes} min`;
  const answers = stats.answers === 1 ? "1 answer" : `${stats.answers} answers`;
  return `Session ended · ${duration} · ${answers}. Your answers are saved in Past Sessions.`;
}
