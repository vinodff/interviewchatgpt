import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { advanceReaderClock, createReaderClock, readingWordsPerMinute, type ReaderClockState } from "@/lib/answer-reader";
import { formatAnswer, formattedAnswerWords, type AnswerSegment } from "@/lib/answer-format";
import type { Preferences } from "@/lib/types";

export type ReaderSpeech = { sequence: number; id: string; role: "user" | "unknown"; text: string };
export type ReaderCompletion = { generation: string; sequence: number; baseline: ReaderSpeech | null };

type AnswerReaderProps = {
  answer: string; generation: string | null; active: boolean; visible: boolean;
  completion: ReaderCompletion | null; speech: ReaderSpeech | null; preferences?: Preferences;
  containerRef: RefObject<HTMLElement | null>;
};

function subscribeVisibility(change: () => void) { document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); }
function subscribeMotion(change: () => void) { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }

function speechAfterBaseline(speech: ReaderSpeech, baseline: ReaderSpeech | null) {
  if (speech.id !== baseline?.id) return speech.text.trim();
  let prefix = 0;
  while (prefix < baseline.text.length && prefix < speech.text.length && baseline.text[prefix] === speech.text[prefix]) prefix++;
  return speech.text.slice(prefix).trim();
}

export function AnswerReader({ answer, generation, active, visible, completion, speech, preferences, containerRef }: AnswerReaderProps) {
  const segments = useMemo(() => formatAnswer(answer), [answer]);
  const words = useMemo(() => formattedAnswerWords(answer, segments), [answer, segments]);
  const documentVisible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => false);
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  const mode = preferences?.reading_mode || "auto";
  const clockMode = mode === "off" ? "auto" : mode;
  const wpm = readingWordsPerMinute(preferences?.reading_wpm ?? 130);
  const ready = completion !== null && completion.generation === generation;
  const enabled = ready && active && visible && documentVisible && mode !== "off" && words.length > 0;
  const [progress, setProgress] = useState<Pick<ReaderClockState, "wordIndex" | "source">>({ wordIndex: 0, source: "waiting" });
  const [paneVersion, setPaneVersion] = useState(0);
  const input = useRef({ words, speech, completion });
  const runtime = useRef<{
    clock: ReaderClockState | null; initialized: boolean; suspended: boolean; sequence: number;
    baseline: ReaderSpeech | null; seen: Map<string, string>;
  }>({ clock: null, initialized: false, suspended: false, sequence: 0, baseline: null, seen: new Map() });

  useEffect(() => { input.current = { words, speech, completion }; }, [words, speech, completion]);
  useEffect(() => {
    const current = runtime.current;
    if (!enabled) { current.suspended = true; return; }
    const latest = input.current;
    if (!current.initialized) {
      current.sequence = latest.completion?.sequence || 0;
      current.baseline = latest.completion?.baseline || null;
    } else if (current.suspended) {
      // Speech received while the reader was paused must not move a resumed guide.
      current.sequence = Math.max(current.sequence, latest.speech?.sequence || 0);
      current.baseline = latest.speech;
      current.seen.clear();
    }
    current.initialized = true; current.suspended = false;
    current.clock = createReaderClock(performance.now(), { wordIndex: current.clock?.wordIndex ?? 0, spokenIndex: current.clock?.spokenIndex ?? -1, mode: clockMode });
    const timer = window.setInterval(() => {
      const latest = input.current;
      let freshSpeech: { id: string; role: "user" | "unknown"; text: string } | undefined;
      if (latest.speech && latest.speech.sequence > current.sequence) {
        const event = latest.speech;
        current.sequence = event.sequence;
        if (current.seen.get(event.id) !== event.text) {
          current.seen.set(event.id, event.text);
          if (current.seen.size > 80) current.seen.delete(current.seen.keys().next().value!);
          const text = speechAfterBaseline(event, current.baseline);
          if (text) freshSpeech = { id: event.id, role: event.role, text };
        }
      }
      const next = advanceReaderClock(latest.words, current.clock!, { now: performance.now(), mode: clockMode, wordsPerMinute: wpm, speech: freshSpeech });
      current.clock = next;
      setProgress(previous => previous.wordIndex === next.wordIndex && previous.source === next.source ? previous : { wordIndex: next.wordIndex, source: next.source });
    }, 100);
    return () => window.clearInterval(timer);
  }, [enabled, clockMode, wpm]);

  useEffect(() => { containerRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [containerRef]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    const resize = () => { if (frame !== null) cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = null; setPaneVersion(value => value + 1); }); };
    const observer = new ResizeObserver(resize); observer.observe(container);
    return () => { observer.disconnect(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [containerRef]);
  const position = enabled ? Math.min(progress.wordIndex, words.length - 1) : -1;
  useEffect(() => {
    if (!enabled || position < 0) return;
    const container = containerRef.current;
    const current = container?.querySelector<HTMLElement>(`[data-reader-word="${position}"]`);
    const upcoming = container?.querySelector<HTMLElement>(`[data-reader-word="${Math.min(words.length - 1, position + 12)}"]`);
    if (!container || !current || !upcoming || container.scrollHeight <= container.clientHeight) return;
    const bounds = container.getBoundingClientRect();
    const currentBounds = current.getBoundingClientRect();
    const upcomingBounds = upcoming.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    if (currentBounds.top >= top + 12 && upcomingBounds.bottom <= top + container.clientHeight - 22) return;
    const target = currentBounds.top - top + container.scrollTop - container.clientHeight * 0.28;
    // Scrolling is restricted to this pane; never move the controls, document or focus.
    container.scrollTo({ top: Math.max(0, Math.min(container.scrollHeight - container.clientHeight, target)), behavior: reducedMotion ? "auto" : "smooth" });
  }, [enabled, position, words.length, paneVersion, reducedMotion, containerRef]);

  const indexedWords = words.map((word, index) => ({ word, index }));
  function renderRange(segment: AnswerSegment) {
    const range = indexedWords.filter(({ word }) => word.start >= segment.start && word.end <= segment.end);
    return <>{range.map(({ word, index }, localIndex) => <Fragment key={word.start}>{answer.slice(range[localIndex - 1]?.word.end ?? segment.start, word.start)}<span data-reader-word={index} data-reader-current={index === position ? "true" : undefined} className={index === position ? "reader-current-word" : undefined}>{answer.slice(word.start, word.end)}</span></Fragment>)}{answer.slice(range.at(-1)?.word.end ?? segment.start, segment.end)}</>;
  }
  const textSize = Math.min(24, Math.max(14, Math.round(preferences?.answer_text_size ?? 17)));
  const font = preferences?.answer_font || "system";
  const theme = preferences?.answer_theme || "default";
  const displayStyle = { "--answer-font-size": `${textSize}px` } as CSSProperties;
  return <div className="answer-text" data-reader-mode={mode} data-reader-position={position} data-reader-status={mode === "off" ? "off" : !enabled ? "paused" : progress.source} data-reader-generation={generation || ""} data-answer-font={font} data-answer-theme={theme} style={displayStyle}>{segments.map(segment => segment.kind === "fence" ? <span key={`fence-${segment.start}`} className="answer-code-fence" aria-hidden="true">{answer.slice(segment.start, segment.end)}</span> : segment.kind === "code" ? <pre key={`code-${segment.start}`} className="answer-code-block" data-language={segment.language}><code>{renderRange(segment)}</code></pre> : <Fragment key={`text-${segment.start}`}>{renderRange(segment)}</Fragment>)}</div>;
}
