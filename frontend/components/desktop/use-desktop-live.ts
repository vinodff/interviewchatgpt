"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveController, type LocalEvent, type ScreenImage } from "@/lib/live-controller";
import { initialLiveState, reduceLiveMessage, type LiveMessage, type LiveState } from "@/lib/protocol";
import { DesktopAudioCapture, type AudioSource, type DesktopAudioLevels } from "@/lib/desktop-audio";
import { reduceAnswerEntries, refinePrompt, type AnswerEntry, type RefineKind, type SessionStats } from "@/lib/desktop-answers";
import { desktopMessage, knowledgeSourcesOf, sessionTitle, setupPreferences, type DesktopSetup } from "@/lib/desktop-setup";
import type { Session, User } from "@/lib/types";

type Callbacks = { onUser: (user: User) => void; onSession: (session: Session) => void; onEnded: (reason: string, stats: SessionStats) => void };

/** The session's controls. Every function is stable for the hook's lifetime, so polling children never restart. */
export type DesktopLiveActions = {
  /** Must be called from a click handler: capture permissions need the user's gesture. */
  start(setup: DesktopSetup, user: User, includeSystemAudio: boolean): void;
  stop(): Promise<void>;
  answerLatest(fallbackText: string): boolean;
  /** A typed question: it is echoed into the transcript. */
  ask(text: string): void;
  /** Speech already in the transcript (a line the user picked): answered without echoing it again. */
  answerHeard(text: string): void;
  /** A one-tap follow-up (shorter, more detail, an example) on an answer. */
  refine(kind: RefineKind, question: string): void;
  analyze(screen: ScreenImage): Promise<void>;
  setHeld(held: boolean): void;
  setAutoAnswer(on: boolean): void;
  setSource(source: AudioSource, on: boolean): void;
  sourceEnabled(source: AudioSource): boolean;
  levels(): DesktopAudioLevels;
  sourceProblems(): Partial<Record<AudioSource, string>>;
  clearEntries(): void;
};

export type DesktopLive = DesktopLiveActions & {
  state: LiveState;
  entries: AnswerEntry[];
  /** With auto-answer off: the question waiting for the Answer button. */
  pendingQuestion: string;
  running: boolean;
};

const NO_LEVELS: DesktopAudioLevels = { microphone: null, system: null };

export function useDesktopLive(callbacks: Callbacks): DesktopLive {
  const [state, setState] = useState<LiveState>(initialLiveState);
  const [entries, setEntries] = useState<AnswerEntry[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const controller = useRef<LiveController | null>(null);
  const capture = useRef<DesktopAudioCapture | null>(null);
  const mounted = useRef(true);
  const endedReported = useRef(false);
  // Counted from events rather than the visible history, which is capped and can be cleared.
  const stats = useRef({ startedAt: 0, answers: 0 });
  const latest = useRef(callbacks);
  useEffect(() => { latest.current = callbacks; }, [callbacks]);

  const reportEnd = useCallback((reason: string) => {
    if (endedReported.current) return;
    endedReported.current = true;
    controller.current = null; capture.current = null;
    setRunning(false);
    const { startedAt, answers } = stats.current;
    latest.current.onEnded(reason, { answers, seconds: startedAt ? (Date.now() - startedAt) / 1000 : 0 });
  }, []);

  const notify = useCallback((event: LiveMessage | LocalEvent) => {
    if (!mounted.current) return;
    if (event.type === "local") {
      if (event.level) return; // The toolbar reads levels straight from the capture.
      if (event.pendingQuestion !== undefined) { setPendingQuestion(event.pendingQuestion); return; }
      const error = event.error === undefined ? undefined : desktopMessage(event.error);
      setState(current => ({
        ...current,
        ...(event.phase ? { phase: event.phase } : {}),
        ...(event.phase === "ended" || event.phase === "reconnecting" ? { answering: false, generation: null } : {}),
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
        ...(error !== undefined ? { error } : {}),
      }));
      if (event.phase === "ended") reportEnd(error || "");
      return;
    }
    if (event.type === "question") setPendingQuestion("");
    if (event.type === "answer_complete") stats.current = { ...stats.current, answers: stats.current.answers + 1 };
    setEntries(current => reduceAnswerEntries(current, event));
    setState(current => reduceLiveMessage(current, event));
  }, [reportEnd]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void controller.current?.stop(); controller.current = null; capture.current = null; };
  }, []);

  const actions = useMemo<DesktopLiveActions>(() => ({
    start(setup, user, includeSystemAudio) {
      if (controller.current) return;
      endedReported.current = false;
      stats.current = { startedAt: Date.now(), answers: 0 };
      setState({ ...initialLiveState, phase: "capturing", detail: "Starting your audio…" });
      setEntries([]); setPendingQuestion(""); setRunning(true);
      const live = new LiveController(notify, session => latest.current.onSession(session), usage => latest.current.onUser(usage));
      live.setPreferences(setupPreferences(setup, user.preferences));
      controller.current = live;
      // No await before start(): the capture below is created inside this click's gesture.
      void live.start("microphone", sessionTitle(setup), true, {
        streamingMicrophone: true, browserTransport: true, keepListeningInBackground: true,
        autoAnswer: setup.autoAnswer, knowledgeSources: knowledgeSourcesOf(setup),
        createCapture: (onPacket, onEnded) => {
          const audio = new DesktopAudioCapture(onPacket, onEnded, { microphoneId: setup.microphoneId || undefined, includeMicrophone: true, includeSystem: includeSystemAudio });
          capture.current = audio;
          return audio;
        },
      });
    },
    async stop() { await controller.current?.stop(); },
    answerLatest: fallbackText => controller.current?.answerLatest(fallbackText) ?? false,
    ask: text => controller.current?.askQuestion(text),
    answerHeard: text => controller.current?.askQuestion(text, false),
    refine: (kind, question) => controller.current?.askQuestion(refinePrompt(kind, question), false, true),
    analyze: async screen => { await controller.current?.analyzeImage(screen); },
    setHeld: held => controller.current?.setAnswerLocked(held),
    setAutoAnswer: on => { controller.current?.setAutoAnswer(on); if (on) setPendingQuestion(""); },
    setSource: (source, on) => capture.current?.setEnabled(source, on),
    sourceEnabled: source => capture.current?.isEnabled(source) ?? true,
    levels: () => capture.current?.levels() ?? NO_LEVELS,
    sourceProblems: () => ({ ...(capture.current?.problems ?? {}) }),
    clearEntries: () => setEntries([]),
  }), [notify]);

  return { ...actions, state, entries, pendingQuestion, running };
}
