"use client";
import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDown, Copy, Eye, HelpCircle, Pause, Play, Trash2 } from "lucide-react";
import { glanceOf } from "@/lib/glance";
import { REFINE_OPTIONS, stepEntry, visibleEntryIndex, type AnswerEntry, type RefineKind } from "@/lib/desktop-answers";
import { AnswerText, CodeBlock } from "./answer-text";

/** Answer text size, in percent of the default. */
export const TEXT_SCALE = { min: 80, max: 150, step: 10, initial: 100 } as const;
const COPIED_MS = 1500;

type Props = {
  entries: AnswerEntry[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  glance: boolean;
  onToggleGlance: () => void;
  held: boolean;
  onToggleHeld: () => void;
  opacity: number;
  onOpacity: (value: number) => void;
  textScale: number;
  onTextScale: (value: number) => void;
  onClear: () => void;
  onRefine: (kind: RefineKind, question: string) => void;
  collapsed: boolean;
  onCollapse: () => void;
  bodyHeight: number;
  /** The scrolling answer body, so keyboard shortcuts can scroll it. */
  bodyRef: RefObject<HTMLDivElement | null>;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  listening: boolean;
  autoAnswer: boolean;
  /** Tooltip hints, e.g. "Ctrl+G". Empty when the shortcut is off. */
  keys: { glance: string };
};

function GlanceView({ answer }: { answer: string }) {
  const glance = useMemo(() => glanceOf(answer), [answer]);
  // Nothing to condense (short or unsplittable): the full answer IS the glance, never an empty card.
  if (!glance) return <AnswerText answer={answer} />;
  if (glance.kind === "code") return <>{glance.note && <p className="iwd-glance-note">{glance.note}</p>}<CodeBlock code={glance.code} language={glance.language} /></>;
  return <ul className="iwd-glance-points">{glance.points.map((point, index) => <li key={index}>{point}</li>)}</ul>;
}

/** Copy, and the one-tap follow-ups, under a finished answer. */
function AnswerActions({ entry, onRefine }: { entry: AnswerEntry; onRefine: (kind: RefineKind, question: string) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(entry.answer); setCopied(true); } catch { setCopied(false); }
  }
  return <div className="iwd-answer-actions" role="group" aria-label="Answer actions">
    {entry.done && REFINE_OPTIONS.map(option => <button key={option.kind} type="button" className="iwd-chip" onClick={() => onRefine(option.kind, entry.question)}>{option.label}</button>)}
    <span className="iwd-spacer" />
    <button type="button" className="iwd-chip" onClick={() => { void copy(); }} aria-label="Copy answer">{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
  </div>;
}

export function DesktopAnswerCard(props: Props) {
  const { entries, selected, onSelect, glance, onToggleGlance, held, onToggleHeld, opacity, onOpacity, textScale, onTextScale, onClear, onRefine, collapsed, onCollapse, bodyHeight, bodyRef, onResizeStart, listening, autoAnswer, keys } = props;
  const index = visibleEntryIndex(entries.length, selected);
  const entry = index >= 0 ? entries[index] : null;
  const following = selected === null;
  // A new answer starts at its first line.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [entry?.id, bodyRef]);
  const condensable = entry ? glanceOf(entry.answer) !== null : false;
  const style = { "--iwd-card-alpha": String(opacity / 100), "--iwd-text-scale": String(textScale / 100) } as CSSProperties;
  const glanceHint = keys.glance ? ` · ${keys.glance}` : "";

  return <section className={`iwd-answer ${collapsed ? "is-collapsed" : ""}`} style={style} aria-label="Suggested answers">
    <div className="iwd-answer-bar">
      <button type="button" className="iwd-dark-btn" aria-label="Previous answer" disabled={index <= 0} onClick={() => onSelect(stepEntry(entries.length, selected, -1))}><ChevronLeft size={15} /></button>
      <span className="iwd-pager" aria-live="polite">{entries.length ? `${index + 1} / ${entries.length}` : "0 / 0"}</span>
      <button type="button" className="iwd-dark-btn" aria-label="Next answer" disabled={index < 0 || index >= entries.length - 1} onClick={() => onSelect(stepEntry(entries.length, selected, 1))}><ChevronRight size={15} /></button>
      <button type="button" className={`iwd-dark-btn ${following ? "is-on" : ""}`} aria-label="Jump to the latest answer" aria-pressed={following} title="Follow the latest answer" onClick={() => onSelect(null)}><ChevronsDown size={15} /></button>
      <button type="button" className={`iwd-dark-btn ${held ? "is-warn" : ""}`} aria-label={held ? "Resume new answers" : "Hold this answer"} aria-pressed={held} title={held ? "Resume: show answers to new questions" : "Hold: keep this answer on screen while you read"} onClick={onToggleHeld}>{held ? <Play size={14} /> : <Pause size={14} />}</button>
      <span className="iwd-spacer" />
      <span className="iwd-text-size" role="group" aria-label="Answer text size">
        <button type="button" className="iwd-dark-btn is-small-a" aria-label="Smaller text" title={`Smaller text (${textScale}%)`} disabled={textScale <= TEXT_SCALE.min} onClick={() => onTextScale(textScale - TEXT_SCALE.step)}>A</button>
        <button type="button" className="iwd-dark-btn is-large-a" aria-label="Larger text" title={`Larger text (${textScale}%)`} disabled={textScale >= TEXT_SCALE.max} onClick={() => onTextScale(textScale + TEXT_SCALE.step)}>A</button>
      </span>
      <label className="iwd-opacity"><span>OPACITY</span><input type="range" min={35} max={100} step={5} value={opacity} onChange={event => onOpacity(Number(event.target.value))} aria-label="Answer card opacity" /><output>{opacity}%</output></label>
      <button type="button" className="iwd-dark-btn" aria-label="Clear answers" title="Clear answers" disabled={!entries.length} onClick={onClear}><Trash2 size={14} /></button>
      <button type="button" className="iwd-dark-btn" aria-label={collapsed ? "Show answers" : "Hide answers"} aria-expanded={!collapsed} onClick={onCollapse}>{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
    </div>
    {!collapsed && <>
      {entry ? <>
        <h2 className="iwd-question"><HelpCircle size={18} aria-hidden="true" /><span>{entry.question}</span></h2>
        <div className="iwd-mode-row">
          <span className={`iwd-mode-chip ${glance ? "is-glance" : ""}`}><Eye size={13} aria-hidden="true" />{glance ? condensable ? "GLANCE" : "GLANCE · SHORT ANSWER" : "FULL ANSWER"}</span>
          {!entry.done && <span className="iwd-composing"><i aria-hidden="true" />Composing…</span>}
          <button type="button" className="iwd-mode-toggle" onClick={onToggleGlance}>{glance ? "Full answer" : "Glance"}{glanceHint}</button>
        </div>
        <div ref={bodyRef} className="iwd-answer-body" style={{ height: bodyHeight }} tabIndex={0} aria-live={following ? "polite" : "off"}>
          {entry.answer ? glance ? <GlanceView answer={entry.answer} /> : <AnswerText answer={entry.answer} /> : <p className="iwd-dim">Working on it…</p>}
        </div>
        {entry.answer && <AnswerActions key={entry.id} entry={entry} onRefine={onRefine} />}
      </> : <div className="iwd-answer-empty" style={{ height: bodyHeight + 64 }}>
        <span className={`iwd-pulse ${listening ? "is-live" : ""}`} aria-hidden="true" />
        <h2>{listening ? "Listening for the next question" : "Getting ready…"}</h2>
        <p>{autoAnswer ? "Answers appear here as soon as a question is asked." : "Questions you hear wait for you. Press Answer when you want a suggestion."} Use Analyze for a question on your screen, or Chat to type one.</p>
      </div>}
      <span className="iwd-resize" role="separator" aria-label="Resize answer card" onPointerDown={onResizeStart} />
    </>}
  </section>;
}
