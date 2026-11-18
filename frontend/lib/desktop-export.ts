import type { Transcript } from "./protocol";
import type { Session } from "./types";

const SLUG_LIMIT = 60;
const ROLE_LABELS: Record<Transcript["role"], string> = { interviewer: "Interviewer", user: "You", unknown: "Speaker" };

/** Answered turns of a session, as question/answer pairs. */
export function answeredTurns(session: Session): Array<{ id: string; question: string; answer: string }> {
  return (session.turns || [])
    .filter(turn => turn.answer && turn.answer.trim())
    .map(turn => ({ id: turn.id, question: (turn.question || turn.text || "").trim() || "Question", answer: (turn.answer || "").trim() }));
}

/** A past session as Markdown, for copying into notes or saving as a file. */
export function sessionMarkdown(session: Session, dateLabel: string): string {
  const turns = answeredTurns(session);
  const header = [`# ${session.title.trim() || "InterviewWin session"}`, "", `${dateLabel} · ${turns.length === 1 ? "1 answer" : `${turns.length} answers`}`];
  const body = turns.map((turn, index) => `## ${index + 1}. ${turn.question}\n\n${turn.answer}`);
  return [...header, ...body].join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** "interviewwin-interview-google-swe-2026-11-10.md" */
export function sessionFileName(session: Session): string {
  const slug = session.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, SLUG_LIMIT).replace(/-+$/, "");
  const date = /^\d{4}-\d{2}-\d{2}/.exec(session.created_at)?.[0] || "";
  return `${["interviewwin", slug, date].filter(Boolean).join("-")}.md`;
}

/** Finished speech as plain text, one line per turn. */
export function transcriptText(transcripts: readonly Transcript[]): string {
  return transcripts
    .filter(turn => turn.final && turn.text.trim())
    .map(turn => `${ROLE_LABELS[turn.role] ?? "Speaker"}: ${turn.text.trim()}`)
    .join("\n");
}

/** Sessions whose title contains every word of the query (case-insensitive). */
export function filterSessions(sessions: readonly Session[], query: string): Session[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...sessions];
  return sessions.filter(session => { const title = session.title.toLowerCase(); return words.every(word => title.includes(word)); });
}
