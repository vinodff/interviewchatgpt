import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AudioLines, BookOpen, Check, ChevronDown, Clock3, Headphones, Mic, MonitorUp, Radio, ShieldCheck, Square, Waves } from "lucide-react";
import { messageOf } from "@/lib/api";
import { LiveController, type LocalEvent } from "@/lib/live-controller";
import { initialLiveState, reduceLiveMessage, type LiveMessage, type LiveState } from "@/lib/protocol";
import { ANSWER_HEIGHT_DEFAULT, ANSWER_HEIGHT_KEY, ANSWER_HEIGHT_MAX, ANSWER_HEIGHT_MIN, answerHeightFromDrag, answerHeightFromKey, clampAnswerHeight, displayedAnswerHeight, readAnswerHeight } from "@/lib/mobile-live-layout";
import type { Health, Session, Source, User } from "@/lib/types";
import type { AudioMode } from "@/lib/capture";
import { LiveAnswerPreferences } from "./answer-preferences";
import { AnswerReader, type ReaderCompletion, type ReaderSpeech } from "./answer-reader";
import { Alert, Button, EvidenceList, SectionHeader } from "./ui";

const subscribeCaptureCapability = () => () => {};
const tabCaptureSnapshot = () => typeof navigator.mediaDevices?.getDisplayMedia === "function";
const serverCaptureSnapshot = () => false;

type LivePanelProps = {
  sources: Source[]; health: Health | null; user: User; mobile: boolean; visible: boolean;
  toolbar: ReactNode; alerts: ReactNode; onUser: (user: User) => void;
  onAnswerHeight: (height: number) => void; onViewportHeight: (height: number) => void; onActive: (active: boolean) => void; onSession: (session: Session) => void;
};

export function LivePanel({ sources, health, user, mobile, visible, toolbar, alerts, onUser, onAnswerHeight, onViewportHeight, onActive, onSession }: LivePanelProps) {
  const [state, setState] = useState<LiveState>(initialLiveState);
  const [mode, setMode] = useState<AudioMode>("microphone");
  const tabCaptureAvailable = useSyncExternalStore(subscribeCaptureCapability, tabCaptureSnapshot, serverCaptureSnapshot);
  const [consent, setConsent] = useState(false);
  const [retention, setRetention] = useState(true);
  const [title, setTitle] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [answerHeight, setAnswerHeight] = useState(ANSWER_HEIGHT_DEFAULT);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [captureOpen, setCaptureOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(true);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [readerSpeech, setReaderSpeech] = useState<ReaderSpeech | null>(null);
  const [readerCompletion, setReaderCompletion] = useState<ReaderCompletion | null>(null);
  const controller = useRef<LiveController | null>(null);
  const mounted = useRef(true);
  const layout = useRef<HTMLDivElement>(null);
  const transcripts = useRef<HTMLDivElement>(null);
  const answerPane = useRef<HTMLElement>(null);
  const readerGeneration = useRef<string | null>(null);
  const latestReaderSpeech = useRef<ReaderSpeech | null>(null);
  const readerSequence = useRef(0);
  const devicePreferenceLoaded = useRef(false);
  const dragging = useRef<{ id: number; startY: number; startHeight: number; moved: boolean } | null>(null);
  const active = !["idle", "ended"].includes(state.phase);
  const readySources = sources.filter(source => source.status === "ready");
  const minutesAvailable = user.minute_limit === null || user.minute_limit > user.minutes_used;
  const visibleAnswerHeight = displayedAnswerHeight(answerHeight, mobile ? viewportHeight : null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void controller.current?.stop(); }; }, []);
  useEffect(() => {
    // The Android host emits this before its WebView is paused or replaced.
    const pause = () => { void controller.current?.stop(); };
    window.addEventListener("interviewpilot:app-background", pause);
    return () => window.removeEventListener("interviewpilot:app-background", pause);
  }, []);
  useEffect(() => { onActive(active); }, [active, onActive]);
  useEffect(() => {
    let value = ANSWER_HEIGHT_DEFAULT;
    try { value = readAnswerHeight(window.localStorage.getItem(ANSWER_HEIGHT_KEY)); } catch { /* The split also works when device storage is unavailable. */ }
    setAnswerHeight(value); devicePreferenceLoaded.current = true;
  }, []);
  useEffect(() => {
    onAnswerHeight(visibleAnswerHeight);
    if (devicePreferenceLoaded.current) {
      try { window.localStorage.setItem(ANSWER_HEIGHT_KEY, String(answerHeight)); } catch { /* A device-only preference must not prevent live assistance. */ }
    }
  }, [answerHeight, visibleAnswerHeight, onAnswerHeight]);
  useEffect(() => {
    if (!mobile || !visible) return;
    const viewport = window.visualViewport;
    const update = () => { const height = viewport?.height || window.innerHeight; setViewportHeight(height); onViewportHeight(height); };
    update(); viewport?.addEventListener("resize", update); window.addEventListener("resize", update);
    return () => { viewport?.removeEventListener("resize", update); window.removeEventListener("resize", update); };
  }, [mobile, visible, onViewportHeight]);
  useEffect(() => {
    if (!active || !started) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [active, started]);
  useEffect(() => {
    const element = transcripts.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160) element.scrollTop = element.scrollHeight;
  }, [state.transcripts]);

  function notify(event: LiveMessage | LocalEvent) {
    if (!mounted.current) return;
    if (event.type === "question") {
      readerGeneration.current = event.generation_id; setReaderCompletion(null); setReaderSpeech(null);
    } else if (event.type === "answer_complete" && event.generation_id === readerGeneration.current) {
      setReaderCompletion({ generation: event.generation_id, sequence: readerSequence.current, baseline: latestReaderSpeech.current });
    } else if (event.type === "answer_cancelled" && event.generation_id === readerGeneration.current) {
      readerGeneration.current = null; setReaderCompletion(null);
    } else if (event.type === "transcript" && event.role !== "interviewer") {
      const speech: ReaderSpeech = { sequence: ++readerSequence.current, id: event.id, role: event.role, text: event.text };
      latestReaderSpeech.current = speech; setReaderSpeech(speech);
    } else if ((event.type === "local" && ["ended", "reconnecting"].includes(event.phase || "")) || (event.type === "status" && ["ended", "reconnecting"].includes(event.state))) {
      readerGeneration.current = null; setReaderCompletion(null);
    }
    setState(current => event.type === "local" ? {
      ...current, ...(event.phase ? { phase: event.phase } : {}),
      ...(["ended", "reconnecting"].includes(event.phase || "") ? { answering: false, generation: null } : {}),
      ...(event.phase === "reconnecting" ? { question: "", answer: "", evidence: [], keywords: [], latency: null } : {}),
      ...(event.detail !== undefined ? { detail: event.detail } : {}),
      ...(event.error !== undefined ? { error: event.error } : {}),
      ...(event.dropped !== undefined ? { metrics: { ...current.metrics, client_audio_dropped: event.dropped } } : {}),
    } : reduceLiveMessage(current, event));
  }
  function start() {
    if (!consent || active) return;
    setState({ ...initialLiveState, phase: "capturing" }); setStarted(Date.now()); setElapsed(0);
    readerGeneration.current = null; latestReaderSpeech.current = null; setReaderSpeech(null); setReaderCompletion(null);
    if (mobile) setCaptureOpen(false);
    try {
      const live = new LiveController(notify, session => { if (mounted.current) onSession(session); });
      controller.current = live;
      // Capture permissions remain in Start's user gesture, including on mobile.
      void live.start(mode, title, retention);
    } catch (error) { setState(current => ({ ...current, phase: "ended", error: messageOf(error) })); }
  }
  function resizeAt(clientY: number) {
    const bounds = layout.current?.getBoundingClientRect();
    const drag = dragging.current;
    if (bounds && drag) setAnswerHeight(answerHeightFromDrag(drag.startHeight, drag.startY, clientY, bounds.height));
  }
  const status = { idle: "Ready when you are", capturing: "Waiting for permission", connecting: "Connecting", listening: "Listening live", reconnecting: "Reconnecting", ended: "Session stopped" }[state.phase];
  const time = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const style = { "--answer-height": `${visibleAnswerHeight}%`, ...(mobile && viewportHeight ? { "--live-viewport-height": `${viewportHeight}px` } : {}) } as CSSProperties;
  const stopButton = <Button variant="danger" className={mobile ? "mobile-stop" : "wide"} onClick={() => { void controller.current?.stop(); }}><Square size={15} fill="currentColor" /> Stop session</Button>;

  return <div ref={layout} className="live-workspace" style={style}>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{state.announcement}</div>
    <div className="live-desktop-heading"><SectionHeader eyebrow="YOUR VOICE. YOUR EVIDENCE." title="Live workspace" description="Stay in the conversation. Relevant context arrives as questions are spoken." action={<div className={`live-state-label ${state.phase === "listening" ? "is-live" : ""}`} role="status"><span className="status-dot" />{status}</div>} /></div>

    <section ref={answerPane} id="live-answer-pane" className="live-answer-region answer-panel" aria-label="Suggested answer" tabIndex={0}>
      <div className="answer-body">{state.answer ? <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
          <div className="answer-label"><span className="status-dot" /> SUGGESTED ANSWER{state.answering && <span className="streaming-label">Composing…</span>}</div>
          <button
            type="button"
            onClick={() => {
              const next = !isLocked;
              setIsLocked(next);
              controller.current?.setAnswerLocked(next);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "3px 10px",
              fontSize: "11px",
              borderRadius: "9999px",
              cursor: "pointer",
              border: isLocked ? "1px solid #10b981" : "1px solid #374151",
              background: isLocked ? "rgba(16, 185, 129, 0.15)" : "rgba(255, 255, 255, 0.05)",
              color: isLocked ? "#34d399" : "#9ca3af",
              fontWeight: 600,
              transition: "all 0.15s ease"
            }}
            title={isLocked ? "Click to unlock and allow new questions" : "Click to lock this answer on screen while reading"}
          >
            {isLocked ? "🔒 Locked (Reading)" : "🔓 Keep answer"}
          </button>
        </div>
        <AnswerReader key={state.generation || "stopped"} answer={state.answer} generation={state.generation} active={state.phase === "listening"} visible={visible} completion={readerCompletion} speech={readerSpeech} preferences={user.preferences} containerRef={answerPane} />
      </> : <div className="answer-empty"><span className={`answer-empty-icon ${active ? "pulse" : ""}`}><AudioLines size={40} strokeWidth={1.3} /></span><h3>{state.answering ? "Connecting your evidence…" : active ? "Present, listening, ready." : "Room for your next great answer."}</h3><p>{state.answering ? "A response will appear here as it is generated." : "Your suggested answer will appear here when a spoken question is detected."}</p></div>}</div>
    </section>

    <section id="live-controls-pane" className="live-lower-region" aria-label="Live controls and context">
      {mobile && <>
        <div className="answer-resize-handle" role="separator" aria-label="Resize answer area" aria-orientation="horizontal" aria-controls="live-answer-pane live-controls-pane" aria-valuemin={ANSWER_HEIGHT_MIN} aria-valuemax={displayedAnswerHeight(ANSWER_HEIGHT_MAX, viewportHeight)} aria-valuenow={visibleAnswerHeight} aria-valuetext={`${visibleAnswerHeight} percent of the screen for the answer`} tabIndex={0}
          onKeyDown={event => { const next = answerHeightFromKey(visibleAnswerHeight, event.key); if (next !== null) { event.preventDefault(); setAnswerHeight(next); } }}
          onPointerDown={event => { if (event.pointerType === "mouse" && event.button !== 0) return; dragging.current = { id: event.pointerId, startY: event.clientY, startHeight: visibleAnswerHeight, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={event => { const drag = dragging.current; if (drag?.id !== event.pointerId || (!drag.moved && Math.abs(event.clientY - drag.startY) < 1)) return; drag.moved = true; resizeAt(event.clientY); }}
          onPointerUp={event => { if (dragging.current?.id === event.pointerId) { if (dragging.current.moved) resizeAt(event.clientY); dragging.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }}
          onPointerCancel={() => { dragging.current = null; }} onLostPointerCapture={() => { dragging.current = null; }}>
          <span className="resize-grip" aria-hidden="true" /><span>Answer area · {visibleAnswerHeight}%</span><span className="sr-only">Use arrow keys or drag to resize. Home selects 15 percent; End selects the maximum available height.</span>
        </div>
        <div className="mobile-live-toolbar">{toolbar}</div>
        <div className="mobile-capture-bar"><div className="mobile-capture-state" role="status"><span className={state.phase === "listening" ? "recording-dot" : "waiting-dot"} /><span>{status}<small>{active ? `${mode === "tab" ? "Tab + mic" : "Microphone"} · ${time}` : "Audio capture is off"}</small></span></div>{active && stopButton}</div>
      </>}

      <div className="live-lower-scroll" tabIndex={mobile ? 0 : undefined} aria-label={mobile ? "Scrollable live controls" : undefined}>
        {Object.entries(state.transcriptionWarnings).map(([channel, message]) => <Alert key={channel} tone="info">{message}</Alert>)}
        <div className="live-alerts">{alerts}{state.error && <Alert>{state.error}</Alert>}{health?.ai_configured === false && <Alert tone="info">The AI provider is not configured. Add the server’s Gemini API key before starting a session.</Alert>}{!minutesAvailable && <Alert tone="info">Your monthly live allowance has been used. Visit Plan & billing to manage your subscription.</Alert>}</div>
        <aside className="live-control">
          <details className="panel capture-panel live-collapsible" open={!mobile || captureOpen} onToggle={event => { if (mobile) setCaptureOpen(event.currentTarget.open); }}>
            <summary><Headphones size={18} /><span>{active ? "Connection details" : "Capture setup"}</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>{active ? "Your connection" : "Before you go live"}</h2><Headphones size={18} /></div>
            {!active ? <>
              <label className="standalone-label">Conversation title <span className="muted">(optional)</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Product engineering interview" /></label>
              <fieldset className="audio-fieldset"><legend>How should we listen?</legend>
                {tabCaptureAvailable && <label className={`audio-option ${mode === "tab" ? "selected" : ""}`}><input type="radio" name="audio-mode" value="tab" checked={mode === "tab"} onChange={() => setMode("tab")} /><MonitorUp size={20} /><span><strong>Browser tab + microphone</strong><small>Interviewer and you, separately</small></span>{mode === "tab" && <Check size={15} />}</label>}
                <label className={`audio-option ${mode === "microphone" ? "selected" : ""}`}><input type="radio" name="audio-mode" value="microphone" checked={mode === "microphone"} onChange={() => setMode("microphone")} /><Mic size={20} /><span><strong>Microphone only</strong><small>Room audio, mixed speakers</small></span>{mode === "microphone" && <Check size={15} />}</label>
              </fieldset>
              <div className="capture-guidance">{mode === "tab" ? <><MonitorUp size={17} /><p>Desktop Chrome or Edge: select your meeting tab and enable <strong>Share tab audio</strong>. You’ll also allow your microphone. Keep the shared tab open.<br /><small>A video track is required by the browser; no video frames are transmitted.</small></p></> : <><Mic size={17} /><p>Works on supported mobile and desktop browsers. The microphone must hear the conversation.<br /><small>With headphones, it may not hear remote participants. Mixed audio cannot reliably identify speakers.</small></p></>}</div>
              <label className="checkbox-label retention-label"><input type="checkbox" checked={retention} onChange={event => setRetention(event.target.checked)} /><span><strong>Keep session text</strong><small>Save transcripts and answers in session history.</small></span></label>
              <div className="consent-box"><ShieldCheck size={19} /><p>Live assistance must be authorized.</p><label className="checkbox-label"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>All participants know about and agree to this live AI assistance. I’m authorized to share the conversation.</span></label></div>
              <Button className="wide" disabled={!consent || health?.ai_configured === false || !minutesAvailable} onClick={start}><Radio size={18} /> Start live session <ArrowIcon /></Button><p className="audio-privacy">Raw audio is never saved. You can stop at any time.</p>
            </> : <>
              <div className="live-clock"><span className={state.phase === "listening" ? "recording-dot" : "waiting-dot"} />{time}<span>SESSION TIME</span></div>
              <div className="connection-row"><MonitorUp size={17} /><span>{mode === "tab" ? "Tab audio · interviewer" : "Microphone · mixed speakers"}</span><span className="channel-label">CH 0</span></div>
              {mode === "tab" && <div className="connection-row"><Mic size={17} /><span>Microphone · you</span><span className="channel-label">CH 1</span></div>}
              <p className="capture-status" role="status">{state.detail || "The assistant is listening for interview questions."}</p>
              {!mobile && stopButton}<p className="audio-privacy">{retention ? "Session text will be retained." : "Session text will not be retained."} Audio is never stored.</p>
            </>}
          </details>

          <details className="panel live-options-panel live-collapsible" open={!mobile || optionsOpen} onToggle={event => { if (mobile) setOptionsOpen(event.currentTarget.open); }}>
            <summary><Waves size={18} /><span>Answer options</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>Answer options</h2><Waves size={18} /></div>
            <LiveAnswerPreferences user={user} onUser={onUser} />
            {mobile && <><label className="answer-height-control">Answer area height <output>{answerHeight}%</output><input aria-label="Answer area height" type="range" min={ANSWER_HEIGHT_MIN} max={ANSWER_HEIGHT_MAX} step={1} value={answerHeight} onChange={event => setAnswerHeight(clampAnswerHeight(Number(event.target.value)))} /></label>{visibleAnswerHeight !== answerHeight && <p className="preference-help">The answer area is temporarily {visibleAnswerHeight}% to keep live controls visible. Your {answerHeight}% preference returns when more screen space is available.</p>}</>}
          </details>

          <details className="panel context-panel live-collapsible" open={!mobile || contextOpen} onToggle={event => { if (mobile) setContextOpen(event.currentTarget.open); }}>
            <summary><BookOpen size={18} /><span>Connected context · {readySources.length}</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>Connected context</h2><BookOpen size={18} /></div>
            <div className="context-count"><strong>{readySources.length}</strong><span>ready knowledge sources</span></div>
            {readySources.length ? <div className="context-sources">{readySources.slice(0, 4).map(source => <p key={source.id}><span className="status-dot" />{source.name}</p>)}{readySources.length > 4 && <small>+{readySources.length - 4} more sources</small>}</div> : <p className="muted small">{user.preferences?.grounding === "strict" ? "Upload knowledge to support answers. In this mode, unsupported questions will be identified instead of answered from general context." : "Add sources to the Knowledge library for answers grounded in your experience. Without sources, answers use general context."}</p>}
            <div className="context-preferences"><span>{user.preferences?.company || "No target company"}</span><span>{user.preferences?.role || "Role not specified"}</span><span>{user.preferences?.language || "English"}</span><span>{user.preferences?.answer_tone || "professional"}</span><span>{user.preferences?.grounding === "strict" ? "Uploaded knowledge only" : "Personal + technical context"}</span></div>
            {state.memory && <details className="memory-details"><summary>Conversation memory <ChevronDown size={14} /></summary><p>{state.memory}</p></details>}
          </details>
        </aside>

        <div className="live-main">
          <section className="live-question-panel">
            <div className="answer-panel-top"><div><span className="answer-spark"><Waves size={19} /></span><span>THE QUESTION IN FOCUS</span></div>{state.latency !== null && <span className="latency"><Clock3 size={13} /> {(state.latency / 1000).toFixed(1)}s</span>}</div>
            <div className="question-block"><h2>{state.question || (active ? "Listening for the next question…" : "Great answers start with listening.")}</h2>{!state.question && <p>{active ? "Questions are detected automatically as the conversation unfolds. There’s nothing to type." : "Start an authorized live session. We’ll recognize spoken questions and connect them to your knowledge."}</p>}{state.keywords.length > 0 && <div className="keyword-list">{state.keywords.map(word => <span key={word}>{word}</span>)}</div>}</div>
          </section>
          <details className="answer-evidence live-collapsible" open={!mobile || evidenceOpen} onToggle={event => { if (mobile) setEvidenceOpen(event.currentTarget.open); }}>
            <summary><BookOpen size={18} /><span>Answer evidence</span><ChevronDown size={17} /></summary>
            <p className="eyebrow">GROUNDED IN YOUR SOURCES</p>
            {state.answer ? user.preferences?.grounding === "strict" && !state.evidence.length ? <p className="muted small">No supporting uploaded knowledge is attached to this answer.</p> : <EvidenceList evidence={state.evidence} /> : <p className="muted small">Supporting excerpts appear here with your answer.</p>}
          </details>
          <details className="panel transcript-panel live-collapsible" open={!mobile || transcriptOpen} onToggle={event => { if (mobile) setTranscriptOpen(event.currentTarget.open); }}>
            <summary><Mic size={18} /><span>Conversation transcript</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><div><h2>Conversation</h2><span className="muted small">{mode === "tab" ? "Separate audio channels" : "Mixed audio · speaker attribution is uncertain"}</span></div><span className="transcript-live"><span className="status-dot" />{active ? "LIVE TRANSCRIPT" : "TRANSCRIPT"}</span></div>
            <div ref={transcripts} className="transcript-log" role="log" aria-label="Live conversation transcript" aria-live="polite" aria-relevant="additions">{state.transcripts.length ? state.transcripts.map(turn => <div className={`transcript-turn transcript-${turn.role} ${turn.final ? "" : "partial"}`} key={turn.id}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}><span>{turn.role === "interviewer" ? "Interviewer" : turn.role === "user" ? "You" : "Speaker uncertain"}</span>{turn.timestamp && <span style={{ fontSize: "11px", opacity: 0.65, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>{turn.timestamp}</span>}</div><p>{turn.text}{!turn.final && <span className="typing-caret" aria-hidden="true" />}</p></div>) : <div className="transcript-empty"><Mic size={21} /><p>{active ? "Recognized speech will appear here." : "Your conversation transcript will appear once audio starts."}</p></div>}</div>
            {Object.keys(state.metrics).length > 0 && <div className="live-metrics"><span>{state.metrics.questions || 0} questions</span><span>{state.metrics.reconnects || 0} reconnects</span><span>{(state.metrics.audio_dropped || 0) + (state.metrics.client_audio_dropped || 0)} audio blocks dropped</span>{state.metrics.first_token_ms !== undefined && <span>First token: {state.metrics.first_token_ms}ms</span>}</div>}
          </details>
        </div>
      </div>
    </section>
  </div>;
}
function ArrowIcon() { return <span aria-hidden="true">↗</span>; }
