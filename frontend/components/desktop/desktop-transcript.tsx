"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, CornerDownLeft } from "lucide-react";
import { transcriptText } from "@/lib/desktop-export";
import type { Transcript } from "@/lib/protocol";

type Props = { transcripts: readonly Transcript[]; pendingQuestion: string; onAnswer: (text: string) => void };

const VISIBLE_TURNS = 30;
/** Within this many pixels of the bottom, the list keeps following new speech. */
const FOLLOW_SLACK_PX = 24;
const COPIED_MS = 1500;
const ROLE_LABELS: Record<Transcript["role"], string> = { interviewer: "Interviewer", user: "You", unknown: "" };

/**
 * The recent conversation. Any finished line can be answered, so a question the AI skipped
 * (or one asked while auto-answer was off) is one click away.
 */
export function DesktopTranscript({ transcripts, pendingQuestion, onAnswer }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const [copied, setCopied] = useState(false);
  const turns = transcripts.filter(turn => turn.text.trim()).slice(-VISIBLE_TURNS);
  const last = turns[turns.length - 1];

  useEffect(() => {
    const element = list.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [turns.length, last?.text]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try { await navigator.clipboard.writeText(transcriptText(transcripts)); setCopied(true); } catch { setCopied(false); }
  }

  return <section className="iwd-transcript" aria-label="Conversation transcript">
    <header>
      <span className="iwd-transcript-title">TRANSCRIPT</span>
      <small>Pick a line to answer it</small>
      <button type="button" className="iwd-dark-btn" aria-label="Copy transcript" title={copied ? "Copied" : "Copy transcript"} disabled={!turns.length} onClick={() => { void copy(); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </header>
    {turns.length ? <ol ref={list} onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_SLACK_PX; }}>
      {turns.map(turn => {
        const waiting = Boolean(pendingQuestion) && turn.text.trim() === pendingQuestion.trim();
        const role = ROLE_LABELS[turn.role];
        return <li key={turn.id} className={`${turn.final ? "" : "is-partial"} ${waiting ? "is-waiting" : ""}`}>
          <p>{role && <span className="iwd-transcript-role">{role}</span>}{turn.text}</p>
          <button type="button" className="iwd-transcript-answer" disabled={!turn.final} onClick={() => onAnswer(turn.text)} aria-label={`Answer: ${turn.text}`}><CornerDownLeft size={12} aria-hidden="true" />Answer</button>
        </li>;
      })}
    </ol> : <p className="iwd-transcript-empty">What you hear appears here as it is spoken.</p>}
  </section>;
}
