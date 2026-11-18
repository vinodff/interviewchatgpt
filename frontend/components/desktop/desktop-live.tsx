"use client";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Loader2, MessageSquare, Mic, MicOff, Monitor, MonitorOff, MoreVertical, MousePointerClick, Move, ScanSearch, ScrollText, Send, Sparkles, X } from "lucide-react";
import { desktopBridge, isDesktopApp, type DesktopShortcut, type ShortcutName, type ShortcutStatus } from "@/lib/desktop-bridge";
import { stepEntry, type RefineKind } from "@/lib/desktop-answers";
import { shortcutAvailability, shortcutFromKey, shortcutLabel } from "@/lib/desktop-shortcuts";
import type { DesktopSetup } from "@/lib/desktop-setup";
import type { User } from "@/lib/types";
import { DesktopAnswerCard, TEXT_SCALE } from "./desktop-answer-card";
import { LiveTimer, LiveWave, useAudioStatus } from "./desktop-live-meters";
import { DesktopShortcutsHelp } from "./desktop-shortcuts-help";
import { DesktopTranscript } from "./desktop-transcript";
import { BrandMark } from "./desktop-ui";
import type { DesktopLive as LiveSession } from "./use-desktop-live";

type Props = {
  live: LiveSession;
  user: User;
  setup: DesktopSetup;
  overlayWidth: number;
  onOverlayWidth: (width: number) => void;
  /** Which global shortcuts the desktop app registered for this session; null in a browser preview. */
  shortcutStatus: ShortcutStatus | null;
  platform: string;
};
type OverlayPrefs = { bodyHeight: number; opacity: number; textScale: number };

const OVERLAY_KEY = "iw.desktop.overlay.v1";
const END_CONFIRM_MS = 3000;
const NOTICE_MS = 5000;
/** A scroll shortcut moves the answer by this share of its visible height. */
const SCROLL_FRACTION = 0.7;
const MIN_SCROLL_PX = 80;
const WINDOW_SHORTCUTS: ReadonlySet<ShortcutName> = new Set(["toggle-window", "click-through"]);
export const OVERLAY_WIDTH = { min: 520, max: 1100, initial: 720 } as const;
const BODY_HEIGHT = { min: 140, max: 720, initial: 300 } as const;
const DEFAULT_PREFS: OverlayPrefs = { bodyHeight: BODY_HEIGHT.initial, opacity: 100, textScale: TEXT_SCALE.initial };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

function readOverlayPrefs(): OverlayPrefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(OVERLAY_KEY) || "{}") as Record<string, unknown>;
    return {
      bodyHeight: clamp(Number(saved.bodyHeight) || BODY_HEIGHT.initial, BODY_HEIGHT.min, BODY_HEIGHT.max),
      opacity: clamp(Number(saved.opacity) || 100, 35, 100),
      textScale: clamp(Number(saved.textScale) || TEXT_SCALE.initial, TEXT_SCALE.min, TEXT_SCALE.max),
    };
  } catch { return DEFAULT_PREFS; }
}

export function DesktopLiveOverlay({ live, user, setup, overlayWidth, onOverlayWidth, shortcutStatus, platform }: Props) {
  const bridge = useMemo(() => desktopBridge(), []);
  // The overlay only mounts in the browser (after sign-in), so reading the window and storage here is safe.
  const inApp = useMemo(() => isDesktopApp(), []);
  const [prefs, setPrefs] = useState<OverlayPrefs>(readOverlayPrefs);
  useEffect(() => { try { window.localStorage.setItem(OVERLAY_KEY, JSON.stringify(prefs)); } catch { /* A per-device convenience only. */ } }, [prefs]);
  const [glance, setGlance] = useState(setup.glance);
  const [autoAnswer, setAutoAnswer] = useState(setup.autoAnswer);
  const [held, setHeld] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState("");
  const [dismissedError, setDismissedError] = useState("");
  const [sources, setSources] = useState({ microphone: true, system: true });
  const [clickThrough, setClickThrough] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const resize = useRef<{ id: number; x: number; y: number; width: number; height: number } | null>(null);
  const audio = useAudioStatus(live.levels, live.sourceProblems);

  const { state, entries, pendingQuestion } = live;
  const listening = state.phase === "listening";
  const latestSpeech = [...state.transcripts].reverse().find(turn => turn.text.trim())?.text || "";

  /** "Ctrl+Alt+A" when that shortcut works this session, else "". */
  const keyFor = (name: ShortcutName) => {
    const works = inApp ? shortcutAvailability(name, shortcutStatus) === "on" : !WINDOW_SHORTCUTS.has(name);
    return works ? shortcutLabel(name, platform) : "";
  };
  const withKey = (text: string, name: ShortcutName) => { const keys = keyFor(name); return keys ? `${text} (${keys})` : text; };
  // Click-through needs its shortcut: with the window ignoring clicks, it is the only way back.
  const canClickThrough = inApp && shortcutAvailability("click-through", shortcutStatus) === "on";

  /** An explicit request: show its answer, even if the user was holding or paging back. */
  function showNextAnswer() {
    setSelected(null);
    if (held) { setHeld(false); live.setHeld(false); }
  }
  function answerNow() {
    showNextAnswer();
    if (!live.answerLatest(latestSpeech)) setNotice("Nothing heard yet. Ask out loud, or use Chat to type a question.");
  }
  async function analyze() {
    if (analyzing) return;
    if (!inApp) { setNotice("Analyze reads your screen, so it works in the desktop app."); return; }
    setAnalyzing(true); showNextAnswer();
    try {
      const screen = await bridge.captureScreen();
      if (!screen) setNotice("Your screen couldn’t be captured. Check screen-recording permission and try again.");
      else await live.analyze(screen);
    } finally { setAnalyzing(false); }
  }
  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    showNextAnswer(); live.ask(text); setChatText("");
  }
  function answerLine(text: string) { showNextAnswer(); live.answerHeard(text); }
  function refine(kind: RefineKind, question: string) { showNextAnswer(); live.refine(kind, question); }
  function scrollAnswer(direction: 1 | -1) {
    const element = body.current;
    if (element) element.scrollBy({ top: direction * Math.max(MIN_SCROLL_PX, element.clientHeight * SCROLL_FRACTION), behavior: "smooth" });
  }
  function toggleSource(source: "microphone" | "system") {
    const next = !sources[source];
    live.setSource(source, next);
    setSources(current => ({ ...current, [source]: next }));
  }
  function toggleHeld() { const next = !held; setHeld(next); live.setHeld(next); }
  function toggleAuto() { const next = !autoAnswer; setAutoAnswer(next); live.setAutoAnswer(next); setMenuOpen(false); }
  function toggleClickThrough() { setMenuOpen(false); void bridge.setClickThrough(!clickThrough).then(setClickThrough); }
  function end() { if (!confirmEnd) { setConfirmEnd(true); return; } setConfirmEnd(false); void live.stop(); }

  // Global shortcuts in the desktop app; in a browser preview the same keys work while the page has focus.
  const onShortcut = useEffectEvent((name: DesktopShortcut) => {
    switch (name) {
      case "glance": setGlance(on => !on); break;
      case "answer": answerNow(); break;
      case "analyze": void analyze(); break;
      case "scroll-up": scrollAnswer(-1); break;
      case "scroll-down": scrollAnswer(1); break;
      case "previous": setSelected(current => stepEntry(entries.length, current, -1)); break;
      case "next": setSelected(current => stepEntry(entries.length, current, 1)); break;
    }
  });
  useEffect(() => bridge.onShortcut(name => onShortcut(name)), [bridge]);
  useEffect(() => {
    if (inApp) return;
    const key = (event: KeyboardEvent) => { const name = shortcutFromKey(event); if (!name) return; event.preventDefault(); onShortcut(name); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [inApp]);
  // Click-through is toggled by its shortcut in the app; the page only shows the state.
  useEffect(() => bridge.onWindowState(windowState => setClickThrough(windowState.clickThrough)), [bridge]);
  useEffect(() => { if (!confirmEnd) return; const timer = setTimeout(() => setConfirmEnd(false), END_CONFIRM_MS); return () => clearTimeout(timer); }, [confirmEnd]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), NOTICE_MS); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);

  function startResize(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    resize.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: overlayWidth, height: prefs.bodyHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
    const target = event.currentTarget;
    const move = (moveEvent: PointerEvent) => {
      const drag = resize.current;
      if (!drag || drag.id !== moveEvent.pointerId) return;
      onOverlayWidth(clamp(drag.width + moveEvent.clientX - drag.x, OVERLAY_WIDTH.min, OVERLAY_WIDTH.max));
      setPrefs(current => ({ ...current, bodyHeight: clamp(drag.height + moveEvent.clientY - drag.y, BODY_HEIGHT.min, BODY_HEIGHT.max) }));
    };
    const up = () => { resize.current = null; target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
  }

  const caption = latestSpeech || (state.phase === "reconnecting" ? "Reconnecting…" : listening ? "Listening…" : state.detail || "Starting your audio…");
  const error = state.error && state.error !== dismissedError ? state.error : "";
  const message = error || notice || audio.problem;
  return <div className={`iwd-overlay ${clickThrough ? "is-click-through" : ""}`} style={{ width: overlayWidth }}>
    <div className="iwd-toolbar" role="toolbar" aria-label="Live session controls">
      <span className="iwd-toolbar-brand"><BrandMark size={22} /><span>InterviewWin</span></span>
      <LiveWave readLevels={live.levels} active={listening} />
      <button type="button" className="iwd-tool-icon" aria-pressed={sources.system} disabled={!audio.systemAvailable} title={!audio.systemAvailable ? "System audio is not available" : sources.system ? "Mute system audio (the interviewer)" : "Unmute system audio"} onClick={() => toggleSource("system")}>
        {sources.system ? <Monitor size={17} /> : <MonitorOff size={17} />}<i className={`iwd-dot ${sources.system && audio.systemAvailable ? "is-live" : ""}`} />
      </button>
      <button type="button" className="iwd-tool-icon" aria-pressed={sources.microphone} title={sources.microphone ? "Mute your microphone" : "Unmute your microphone"} onClick={() => toggleSource("microphone")}>
        {sources.microphone ? <Mic size={17} /> : <MicOff size={17} />}<i className={`iwd-dot ${sources.microphone && audio.microphoneAvailable ? "is-live" : ""}`} />
      </button>
      <span className="iwd-divider" aria-hidden="true" />
      <button type="button" className={`iwd-tool ${pendingQuestion ? "is-ready" : ""}`} onClick={answerNow} title={withKey(pendingQuestion ? `Answer: ${pendingQuestion}` : "Answer the latest question", "answer")}><Sparkles size={16} aria-hidden="true" />Answer</button>
      <button type="button" className="iwd-tool" onClick={() => { void analyze(); }} disabled={analyzing} title={withKey("Answer the question on your screen", "analyze")}>{analyzing ? <Loader2 size={16} className="iwd-spin" aria-hidden="true" /> : <ScanSearch size={16} aria-hidden="true" />}Analyze</button>
      <button type="button" className={`iwd-tool ${chatOpen ? "is-on" : ""}`} aria-expanded={chatOpen} onClick={() => setChatOpen(open => !open)}><MessageSquare size={16} aria-hidden="true" />Chat</button>
      <button type="button" className={`iwd-tool-icon iwd-tool-toggle ${transcriptOpen ? "is-on" : ""}`} aria-label="Transcript" aria-expanded={transcriptOpen} title="Transcript: answer any line you heard" onClick={() => setTranscriptOpen(open => !open)}><ScrollText size={17} /></button>
      <LiveTimer user={user} />
      <span className="iwd-tool-icon iwd-drag" title="Drag to move" aria-hidden="true"><Move size={15} /></span>
      <div className="iwd-menu-wrap" ref={menu}>
        <button type="button" className="iwd-tool-icon" aria-label="Session options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><MoreVertical size={16} /></button>
        {menuOpen && <div className="iwd-menu iwd-menu-dark" role="menu">
          <button type="button" role="menuitemcheckbox" aria-checked={autoAnswer} onClick={toggleAuto}>Auto answer: {autoAnswer ? "On" : "Off"}</button>
          <button type="button" role="menuitemcheckbox" aria-checked={glance} onClick={() => { setGlance(on => !on); setMenuOpen(false); }}>{withKey(`Glance: ${glance ? "On" : "Off"}`, "glance")}</button>
          {canClickThrough && <button type="button" role="menuitemcheckbox" aria-checked={clickThrough} onClick={toggleClickThrough}>{withKey(`Click-through: ${clickThrough ? "On" : "Off"}`, "click-through")}</button>}
          <button type="button" role="menuitem" onClick={() => { setHelpOpen(true); setMenuOpen(false); }}>Keyboard shortcuts</button>
        </div>}
      </div>
      <button type="button" className={`iwd-end ${confirmEnd ? "is-confirm" : ""}`} onClick={end} aria-label={confirmEnd ? "Click again to end the session" : "End session"}>{confirmEnd ? "End?" : <X size={16} />}</button>
    </div>
    <p className="iwd-caption" aria-live="off">{caption}</p>
    {clickThrough && <p className="iwd-passthrough" role="status"><MousePointerClick size={14} aria-hidden="true" />Click-through is on: clicks reach the app behind. Press {keyFor("click-through")} to use this window again.</p>}
    {chatOpen && <form className="iwd-chat" onSubmit={sendChat}>
      <input autoFocus value={chatText} maxLength={4000} placeholder="Type a question for the AI…" aria-label="Type a question" onChange={event => setChatText(event.target.value)} />
      <button type="submit" disabled={!chatText.trim()} aria-label="Send question"><Send size={15} /></button>
    </form>}
    {helpOpen && <DesktopShortcutsHelp status={shortcutStatus} platform={platform} inApp={inApp} requested={setup.shortcuts} onClose={() => setHelpOpen(false)} />}
    {transcriptOpen && <DesktopTranscript transcripts={state.transcripts} pendingQuestion={pendingQuestion} onAnswer={answerLine} />}
    {message && <div className="iwd-live-notice" role={error ? "alert" : "status"}>
      <span>{message}</span>
      {error && <button type="button" onClick={() => setDismissedError(state.error)} aria-label="Dismiss"><X size={13} /></button>}
    </div>}
    <DesktopAnswerCard entries={entries} selected={selected} onSelect={setSelected} glance={glance} onToggleGlance={() => setGlance(on => !on)} held={held} onToggleHeld={toggleHeld}
      opacity={prefs.opacity} onOpacity={opacity => setPrefs(current => ({ ...current, opacity }))}
      textScale={prefs.textScale} onTextScale={textScale => setPrefs(current => ({ ...current, textScale: clamp(textScale, TEXT_SCALE.min, TEXT_SCALE.max) }))}
      onClear={() => { live.clearEntries(); setSelected(null); }} onRefine={refine}
      collapsed={collapsed} onCollapse={() => setCollapsed(value => !value)} bodyHeight={prefs.bodyHeight} bodyRef={body} onResizeStart={startResize}
      listening={listening} autoAnswer={autoAnswer} keys={{ glance: keyFor("glance") }} />
  </div>;
}
