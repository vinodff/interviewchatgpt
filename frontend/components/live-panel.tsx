import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { AudioLines, BookOpen, Check, ChevronDown, Clock3, Headphones, Mic, MonitorUp, Radio, ShieldCheck, Square, Waves } from "lucide-react";
import { isBrowserWorkspace } from "@/lib/workspace-mode";
import { messageOf } from "@/lib/api";
import { LiveController, type LocalEvent } from "@/lib/live-controller";
import { initialLiveState, reduceLiveMessage, type LiveMessage, type LiveState } from "@/lib/protocol";
import { ANSWER_HEIGHT_DEFAULT, ANSWER_HEIGHT_KEY, ANSWER_HEIGHT_MAX, ANSWER_HEIGHT_MIN, answerHeightFromDrag, answerHeightFromKey, clampAnswerHeight, displayedAnswerHeight, readAnswerHeight } from "@/lib/mobile-live-layout";
import type { Health, Session, Source, User } from "@/lib/types";
import type { AudioMode } from "@/lib/capture";
import type { MicrophoneLevel } from "@/lib/enhanced-recognition";
import { questionOptionKey } from "@/lib/question-options";
import { LiveAnswerPreferences } from "./answer-preferences";
import { AnswerReader, type ReaderCompletion, type ReaderSpeech } from "./answer-reader";
import { Alert, Button, EvidenceList, SectionHeader } from "./ui";

const subscribeCaptureCapability = () => () => {};
const tabCaptureSnapshot = () => !isBrowserWorkspace() && typeof navigator.mediaDevices?.getDisplayMedia === "function";
const serverCaptureSnapshot = () => false;

type LivePanelProps = {
  sources: Source[]; health: Health | null; user: User; mobile: boolean; visible: boolean;
  toolbar: ReactNode; alerts: ReactNode; onUser: (user: User) => void;
  onAnswerHeight: (height: number) => void; onViewportHeight: (height: number) => void; onActive: (active: boolean) => void; onSession: (session: Session) => void;
  // Lets the workspace stop this session from outside the Live tab (H-2):
  // the panel stays mounted while hidden, so its own End button is unreachable.
  onStopReady?: (stop: () => Promise<void>) => void;
};

export function LivePanel({ sources, health, user, mobile, visible, toolbar, alerts, onUser, onAnswerHeight, onViewportHeight, onActive, onSession, onStopReady }: LivePanelProps) {
  const [state, setState] = useState<LiveState>(initialLiveState);
  const [mode, setMode] = useState<AudioMode>("microphone");
  const [microphoneEngine, setMicrophoneEngine] = useState("streaming");
  const [microphoneLevel, setMicrophoneLevel] = useState<MicrophoneLevel | null>(null);
  const browserWorkspace = useSyncExternalStore(subscribeCaptureCapability, isBrowserWorkspace, serverCaptureSnapshot);
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
  const [manualInput, setManualInput] = useState("");
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
  // Expose stop through a ref-reading closure: controller.current is only
  // assigned in start(), after this effect runs, so the closure must read
  // the ref at call time, not capture its (then null) value.
  useEffect(() => { onStopReady?.(async () => { await controller.current?.stop(); }); }, [onStopReady]);
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

  useEffect(() => {
    if (controller.current && user.preferences) {
      controller.current.setPreferences(user.preferences);
    }
  }, [user.preferences]);

  function notify(event: LiveMessage | LocalEvent) {
    if (!mounted.current) return;
    if (event.type === "local" && event.level) { setMicrophoneLevel(event.level); return; }
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
    setIsLocked(false); setMicrophoneLevel(null); setState({ ...initialLiveState, phase: "capturing" }); setStarted(Date.now()); setElapsed(0);
    readerGeneration.current = null; latestReaderSpeech.current = null; setReaderSpeech(null); setReaderCompletion(null);
    if (mobile) setCaptureOpen(false);
    try {
      const live = new LiveController(notify, session => { if (mounted.current) onSession(session); });
      live.setPreferences(user.preferences);
      controller.current = live;
      // Capture permissions remain in Start's user gesture, including on mobile.
      void live.start(mode, title, retention, { enhancedMicrophone: microphoneEngine === "enhanced", streamingMicrophone: microphoneEngine === "streaming" });
    } catch (error) { setState(current => ({ ...current, phase: "ended", error: messageOf(error) })); }
  }
  function askManualQuestion(text: string) {
    const q = text.trim();
    if (!q) return;
    if (isLocked) { setIsLocked(false); controller.current?.setAnswerLocked(false); }
    controller.current?.askQuestion(q);
    setManualInput("");
  }
  function resizeAt(clientY: number) {
    const bounds = layout.current?.getBoundingClientRect();
    const drag = dragging.current;
    if (bounds && drag) setAnswerHeight(answerHeightFromDrag(drag.startHeight, drag.startY, clientY, bounds.height));
  }
  const status = { idle: "Ready when you are", capturing: "Waiting for permission", connecting: "Connecting", listening: "Listening live", reconnecting: "Reconnecting", ended: "Session stopped" }[state.phase];
  const time = `${Math.floor(elapsed / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const style = { "--answer-height": `${visibleAnswerHeight}%`, ...(mobile && viewportHeight ? { "--live-viewport-height": `${viewportHeight}px` } : {}) } as CSSProperties;
  const stopButton = <Button variant="danger" className={mobile ? "mobile-stop" : "wide"} onClick={() => { void controller.current?.stop(); }}><Square size={15} fill="currentColor" /> End interview</Button>;

  return <div ref={layout} className="live-workspace" style={style}>
    {visible && <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{state.announcement}</div>}
    <div className="live-desktop-heading"><SectionHeader eyebrow="YOUR VOICE. YOUR EVIDENCE." title="Live interview" description="Stay in the conversation. Relevant context arrives as questions are spoken." action={<div className={`live-state-label ${state.phase === "listening" ? "is-live" : ""}`} role="status"><span className="status-dot" />{status}</div>} /></div>

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
        <div className="live-alerts">{alerts}{state.error && <Alert>{state.error}</Alert>}{health?.ai_configured === false && <Alert tone="info">Live answers are unavailable right now. Try again later or contact support.</Alert>}{!minutesAvailable && <Alert tone="info">You’ve used your live minutes for this month. View Plans &amp; billing for your options.</Alert>}{active && elapsed >= 20 && state.transcripts.length === 0 && <Alert tone="info">No speech recognised yet. If the microphone meter above stays near silent, move closer, unmute, or pick another microphone. If the meter moves but no words appear, try Enhanced or Standard speech recognition, or type the question below.</Alert>}</div>
        <aside className="live-control">
          <details className="panel capture-panel live-collapsible" open={!mobile || captureOpen} onToggle={event => { if (mobile) setCaptureOpen(event.currentTarget.open); }}>
            <summary><Headphones size={18} /><span>{active ? "Interview audio" : "Interview setup"}</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>{active ? "Your connection" : "Before you go live"}</h2><Headphones size={18} /></div>
            {!active ? <>
              <ol className="setup-steps" aria-label="Three steps to start"><li className={mode ? "done" : ""}><span>1</span> Choose audio</li><li className={consent ? "done" : ""}><span>2</span> Confirm permission</li><li><span>3</span> Start</li></ol>
              <fieldset className="audio-fieldset"><legend>Choose your audio</legend>
                {tabCaptureAvailable && <label className={`audio-option ${mode === "tab" ? "selected" : ""}`}><input type="radio" name="audio-mode" value="tab" checked={mode === "tab"} onChange={() => setMode("tab")} /><MonitorUp size={20} /><span><strong>Browser tab + microphone</strong><small>Interviewer and you, separately</small></span>{mode === "tab" && <Check size={15} />}</label>}
                <label className={`audio-option ${mode === "microphone" ? "selected" : ""}`}><input type="radio" name="audio-mode" value="microphone" checked={mode === "microphone"} onChange={() => setMode("microphone")} /><Mic size={20} /><span><strong>Microphone only</strong><small>Use your device microphone</small></span>{mode === "microphone" && <Check size={15} />}</label>
              </fieldset>
              <div className="capture-guidance">{mode === "tab" ? <><MonitorUp size={17} /><p>Select your interview tab and enable <strong>Share tab audio</strong>. Keep that tab open.</p></> : <><Mic size={17} /><p>Your microphone needs to hear the interviewer. Headphones may prevent this.</p></>}</div>
              <div className="consent-box"><ShieldCheck size={19} /><p>Before you start</p><label className="checkbox-label"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>All participants agree to AI assistance, and the interview rules allow it.</span></label></div>
              <Button className="wide" disabled={!consent || health?.ai_configured !== true || !minutesAvailable} onClick={start}><Radio size={18} /> Start live interview <ArrowIcon /></Button><p className="audio-privacy">{health === null ? "Checking the interview service…" : "The app does not save audio recordings. You can stop at any time."}</p>
              <div className="setup-fine-tune"><p className="setup-fine-tune-title">Fine-tune (optional)</p>
                <details className="capture-advanced"><summary>Audio options &amp; interview name</summary><label className="standalone-label">Interview name <span className="muted">(optional)</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Frontend developer interview" /></label>
                  {browserWorkspace && <label className="voice-recognition-field"><span>Speech recognition</span><select value={microphoneEngine} onChange={event => setMicrophoneEngine(event.target.value)}><option value="streaming">Live recognition · recommended</option><option value="enhanced">Short recordings · backup</option><option value="standard">Browser recognition</option></select><small className="muted">Try a backup if live recognition cannot connect. Audio is sent to the selected transcription service while listening.</small></label>}
                  <p className="muted small">Keep this page open during the interview. On mobile, switching apps or locking your screen may interrupt audio. Shared-tab audio works only in compatible desktop browsers.</p>
                </details>
                <label className="checkbox-label retention-label"><input type="checkbox" checked={retention} onChange={event => setRetention(event.target.checked)} /><span><strong>Save interview text</strong><small>Keep questions and answers in Past interviews.</small></span></label>
              </div>
            </> : <>
              <div className="live-clock"><span className={state.phase === "listening" ? "recording-dot" : "waiting-dot"} />{time}<span>SESSION TIME</span></div>
              <div className="connection-row"><MonitorUp size={17} /><span>{mode === "tab" ? "Tab audio · interviewer" : "Microphone · mixed speakers"}</span><span className="channel-label">CH 0</span></div>
              {mode === "tab" && <div className="connection-row"><Mic size={17} /><span>Microphone · you</span><span className="channel-label">CH 1</span></div>}
              <p className="capture-status" role="status">{state.detail || "The assistant is listening for interview questions."}</p>
              {(microphoneLevel || (browserWorkspace && microphoneEngine !== "standard")) && <div className="microphone-meter"><label htmlFor="microphone-input-level">Microphone input</label><meter id="microphone-input-level" min={0} max={1} value={microphoneLevel ? Math.max(0, Math.min(1, (20 * Math.log10(Math.max(0.000001, microphoneLevel.rms)) + 80) / 80)) : 0} /><p className="muted small">{!microphoneLevel ? "Waiting for microphone input…" : microphoneLevel.rms < 0.00012 ? "Almost silent — move the microphone closer or raise the interviewer's speaker volume." : microphoneLevel.peak > 0.95 ? "Very loud — move slightly farther from the microphone." : microphoneLevel.rms < 0.002 ? "Quiet input — amplification is enabled." : "Audio is reaching the microphone."}{microphoneLevel && ` Input gain: ${microphoneLevel.gain.toFixed(1)}×.`}</p></div>}
              {!mobile && stopButton}<p className="audio-privacy">{retention ? "Session text will be retained." : "Session text will not be retained."} Audio is never stored.</p>
            </>}
          </details>

          <details className="panel live-options-panel live-collapsible" open={optionsOpen} onToggle={event => setOptionsOpen(event.currentTarget.open)}>
            <summary><Waves size={18} /><span>Answer options</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>Answer options</h2><Waves size={18} /></div>
            <LiveAnswerPreferences user={user} onUser={onUser} />
            {mobile && <><label className="answer-height-control">Answer area height <output>{answerHeight}%</output><input aria-label="Answer area height" type="range" min={ANSWER_HEIGHT_MIN} max={ANSWER_HEIGHT_MAX} step={1} value={answerHeight} onChange={event => setAnswerHeight(clampAnswerHeight(Number(event.target.value)))} /></label>{visibleAnswerHeight !== answerHeight && <p className="preference-help">The answer area is temporarily {visibleAnswerHeight}% to keep live controls visible. Your {answerHeight}% preference returns when more screen space is available.</p>}</>}
          </details>

          <details className="panel context-panel live-collapsible" open={!mobile || contextOpen} onToggle={event => { if (mobile) setContextOpen(event.currentTarget.open); }}>
            <summary><BookOpen size={18} /><span>Connected context · {readySources.length}</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><h2>Connected context</h2><BookOpen size={18} /></div>
            <div className="context-count"><strong>{readySources.length}</strong><span>ready knowledge sources</span></div>
            {readySources.length ? <div className="context-sources">{readySources.slice(0, 4).map(source => <p key={source.id}><span className="status-dot" />{source.name}</p>)}{readySources.length > 4 && <small>+{readySources.length - 4} more sources</small>}</div> : <p className="muted small">{user.preferences?.grounding === "strict" ? "Upload knowledge to support answers. In this mode, unsupported questions will be identified instead of answered from general context." : "Add sources to the Resume & projects for answers grounded in your experience. Without sources, answers use general context."}</p>}
            <div className="context-preferences"><span>{user.preferences?.company || "No target company"}</span><span>{user.preferences?.role || "Role not specified"}</span><span>{user.preferences?.language || "English"}</span><span>{user.preferences?.answer_tone || "professional"}</span><span>{user.preferences?.grounding === "strict" ? "Uploaded knowledge only" : "Personal + technical context"}</span></div>
            {state.memory && <details className="memory-details"><summary>Conversation memory <ChevronDown size={14} /></summary><p>{state.memory}</p></details>}
          </details>
        </aside>

        <div className="live-main">
          <section className="live-question-panel">
            <div className="answer-panel-top">
              <div><span className="answer-spark"><Waves size={19} /></span><span>THE QUESTION IN FOCUS</span></div>
              {state.latency !== null && (
                <span className="latency">
                  <Clock3 size={13} /> {state.latency < 1000 ? `${state.latency}ms (Instant)` : `${(state.latency / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
            <div className="question-block">
              <h2>{state.question || (active ? "Listening for the next question…" : "Great answers start with listening.")}</h2>
              {!state.question && <p>{active ? "Questions are detected automatically as the conversation unfolds. You can also ask or tap a question below." : "Start an authorized live session. We’ll recognize spoken questions and connect them to your knowledge."}</p>}
              {state.keywords.length > 0 && <div className="keyword-list">{state.keywords.map(word => <span key={word}>{word}</span>)}</div>}
              {active && browserWorkspace && (
                <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      askManualQuestion(manualInput);
                    }}
                    style={{ display: "flex", gap: "8px" }}
                  >
                    <input
                      type="text"
                      aria-label="Ask a question"
                      value={manualInput}
                      onChange={e => setManualInput(e.target.value)}
                      placeholder="Ask or type a question (e.g. what is list)…"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "7px 11px",
                        fontSize: "12px",
                        borderRadius: "5px",
                        border: "1px solid #3d6050",
                        background: "#162822",
                        color: "#f6faee",
                        outline: "none"
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!manualInput.trim()}
                      style={{
                        padding: "7px 13px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "5px",
                        border: "none",
                        background: manualInput.trim() ? "#4ade80" : "#2a4739",
                        color: manualInput.trim() ? "#0d2818" : "#718f7d",
                        cursor: manualInput.trim() ? "pointer" : "default",
                        transition: "all 0.15s ease"
                      }}
                    >
                      Ask
                    </button>
                  </form>
                  <div className="recent-questions" role="group" aria-label="Recent questions">
                    <p className="muted small">Recent questions &amp; topics · select to answer</p>
                    {state.recentQuestions.length ? <div className="recent-question-options">{[...state.recentQuestions].reverse().map(option => <button
                      key={option.id} type="button" className="recent-question-option"
                      aria-label={`Answer: ${option.question}`} aria-pressed={questionOptionKey(option.question) === questionOptionKey(state.question)}
                      title={option.confirmed ? "Detected question — select to answer again" : "Possible question heard in the conversation — select to answer"}
                      onClick={() => askManualQuestion(option.question)}>{option.question}{!option.confirmed && <small>Heard</small>}</button>)}</div> : <p className="muted small">Questions and short topics appear here as you speak.</p>}
                  </div>
                </div>
              )}
            </div>
          </section>
          <details className="answer-evidence live-collapsible" open={!mobile || evidenceOpen} onToggle={event => { if (mobile) setEvidenceOpen(event.currentTarget.open); }}>
            <summary><BookOpen size={18} /><span>Answer evidence</span><ChevronDown size={17} /></summary>
            <p className="eyebrow">GROUNDED IN YOUR SOURCES</p>
            {state.answer ? user.preferences?.grounding === "strict" && !state.evidence.length ? <p className="muted small">No supporting uploaded knowledge is attached to this answer.</p> : <EvidenceList evidence={state.evidence} /> : <p className="muted small">Supporting excerpts appear here with your answer.</p>}
          </details>
          <details className="panel transcript-panel live-collapsible" open={!mobile || transcriptOpen} onToggle={event => { if (mobile) setTranscriptOpen(event.currentTarget.open); }}>
            <summary><Mic size={18} /><span>Conversation transcript</span><ChevronDown size={17} /></summary>
            <div className="panel-heading"><div><h2>Conversation</h2><span className="muted small">{mode === "tab" ? "Separate audio channels" : "Contextual question detection · speaker estimates"}</span></div><span className="transcript-live"><span className="status-dot" />{active ? "LIVE TRANSCRIPT" : "TRANSCRIPT"}</span></div>
            <div ref={transcripts} className="transcript-log" role="log" aria-label="Live conversation transcript" aria-live={visible ? "polite" : "off"} aria-relevant="additions">{state.transcripts.length ? state.transcripts.map(turn => <div className={`transcript-turn transcript-${turn.role} ${turn.final ? "" : "partial"}`} key={turn.id}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}><span>{turn.role === "interviewer" ? "Interviewer" : turn.role === "user" ? "You" : "Speaker uncertain"}</span>{turn.timestamp && <span style={{ fontSize: "11px", opacity: 0.65, fontVariantNumeric: "tabular-nums", letterSpacing: "0.02em" }}>{turn.timestamp}</span>}</div><p>{turn.text}{!turn.final && <span className="typing-caret" aria-hidden="true" />}</p></div>) : <div className="transcript-empty"><Mic size={21} /><p>{active ? "Recognized speech will appear here." : "Your conversation transcript will appear once audio starts."}</p></div>}</div>
            {Object.keys(state.metrics).length > 0 && <div className="live-metrics"><span>{state.metrics.questions || 0} questions</span><span>{state.metrics.reconnects || 0} reconnects</span><span>{(state.metrics.audio_dropped || 0) + (state.metrics.client_audio_dropped || 0)} audio blocks dropped</span>{state.metrics.first_token_ms !== undefined && <span>First token: {state.metrics.first_token_ms}ms</span>}</div>}
          </details>
        </div>
      </div>
    </section>
  </div>;
}
function ArrowIcon() { return <span aria-hidden="true">↗</span>; }
