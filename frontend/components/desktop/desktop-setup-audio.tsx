"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, PlayCircle } from "lucide-react";
import { DesktopAudioCapture, listMicrophones, meterPosition, type DesktopAudioLevels } from "@/lib/desktop-audio";
import type { DesktopCapabilities } from "@/lib/desktop-bridge";
import type { DesktopSetup } from "@/lib/desktop-setup";
import { FieldLabel, Notice, StepFooter } from "./desktop-ui";

type Props = {
  setup: DesktopSetup;
  capabilities: DesktopCapabilities;
  minutesLeft: number | null;
  isFreePlan: boolean;
  onChange: (setup: DesktopSetup) => void;
  onBack: () => void;
  /** Called synchronously from the Start click so capture permissions keep the user's gesture. */
  onActivate: (includeSystemAudio: boolean) => void;
  onOpenExternal: (url: string) => void;
};

const LEVEL_POLL_MS = 80;
const PRACTICE_URL = "https://www.youtube.com/results?search_query=mock+technical+interview";
const SYSTEM_AUDIO_HELP: Record<DesktopCapabilities["systemAudio"], string> = {
  loopback: "System audio is what you hear: the interviewer’s voice from your speakers or headphones.",
  picker: "When you start, macOS asks which screen to share. Turn on audio sharing so the interviewer’s voice is heard.",
  none: "System audio isn’t available on this computer. Use speakers so your microphone can hear the interviewer.",
};

function Meter({ label, level, unavailable }: { label: string; level: number | null; unavailable?: string }) {
  const position = meterPosition(level);
  return <div className="iwd-meter-row">
    <span>{label}</span>
    <div className="iwd-meter" role="meter" aria-label={`${label} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position * 100)}><i style={{ transform: `scaleX(${position})` }} /></div>
    <small>{unavailable ? "Off" : level === null ? "--" : position < 0.12 ? "Quiet" : "Good"}</small>
  </div>;
}

export function DesktopSetupAudio({ setup, capabilities, minutesLeft, isFreePlan, onChange, onBack, onActivate, onOpenExternal }: Props) {
  const [microphones, setMicrophones] = useState<Array<{ id: string; label: string }>>([]);
  const [levels, setLevels] = useState<DesktopAudioLevels>({ microphone: null, system: null });
  const [testing, setTesting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [consent, setConsent] = useState(true);
  const test = useRef<DesktopAudioCapture | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const includeSystem = capabilities.systemAudio !== "none";

  const refreshMicrophones = useCallback(() => { void listMicrophones().then(setMicrophones).catch(() => undefined); }, []);
  const stopTest = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
    test.current?.stop(); test.current = null;
    setTesting(false); setLevels({ microphone: null, system: null });
  }, []);
  useEffect(() => { refreshMicrophones(); return stopTest; }, [refreshMicrophones, stopTest]);

  function startTest(microphoneId = setup.microphoneId) {
    stopTest();
    setProblems([]);
    try {
      const capture = new DesktopAudioCapture(null, message => setProblems([message]), { microphoneId: microphoneId || undefined, includeMicrophone: true, includeSystem });
      test.current = capture; setTesting(true);
      capture.ready.then(() => {
        if (test.current !== capture) return;
        setProblems(Object.values(capture.problems).filter((value): value is string => Boolean(value)));
        refreshMicrophones();
        poll.current = setInterval(() => setLevels(capture.levels()), LEVEL_POLL_MS);
      }, (error: unknown) => {
        if (test.current !== capture) return;
        setProblems([error instanceof Error ? error.message : "Audio could not start."]); stopTest();
      });
    } catch (error) { setProblems([error instanceof Error ? error.message : "Audio could not start."]); }
  }

  const blocked = minutesLeft !== null && minutesLeft < 1;
  const banner = minutesLeft === null ? "Unlimited minutes on your plan." : `${Math.floor(minutesLeft)} min left${isFreePlan ? " on your free plan" : ""}. The session ends by itself when they run out.`;
  return <div className="iwd-body">
    <div className="iwd-banner"><Clock3 size={15} aria-hidden="true" /><span>{banner}</span></div>
    <section className="iwd-panel" aria-labelledby="iwd-audio-title">
      <h2 id="iwd-audio-title">Audio setup</h2>
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-mic">Microphone</FieldLabel>
        <div className="iwd-select"><select id="iwd-mic" value={setup.microphoneId} onChange={event => { onChange({ ...setup, microphoneId: event.target.value }); if (testing) startTest(event.target.value); }}>
          <option value="">Default microphone</option>
          {microphones.map(microphone => <option key={microphone.id} value={microphone.id}>{microphone.label}</option>)}
        </select><ChevronDown size={14} aria-hidden="true" /></div>
      </div>
      <Meter label="Mic" level={levels.microphone} />
      <Meter label="System" level={levels.system} unavailable={!includeSystem ? "Unavailable" : undefined} />
      <p className="iwd-hint">{SYSTEM_AUDIO_HELP[capabilities.systemAudio]}</p>
      {problems.map(problem => <Notice key={problem} tone="error">{problem}</Notice>)}
      <div className="iwd-test-row">
        <button type="button" className="iwd-btn iwd-btn-soft" onClick={() => testing ? stopTest() : startTest()}>{testing ? "Stop test" : "Test audio"}</button>
        <button type="button" className="iwd-link" onClick={() => { stopTest(); setProblems([]); onChange({ ...setup, microphoneId: "" }); }}>Reset</button>
      </div>
    </section>
    <button type="button" className="iwd-tip" onClick={() => onOpenExternal(PRACTICE_URL)}>
      <PlayCircle size={28} aria-hidden="true" />
      <span>Practice first: play a mock interview on YouTube and watch answers appear as the questions are asked.<strong>Find a mock interview</strong></span>
    </button>
    <label className="iwd-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>Everyone in this conversation agrees to AI assistance, and the interview’s rules allow it.</span></label>
    <StepFooter onBack={() => { stopTest(); onBack(); }} primary={() => { stopTest(); onActivate(includeSystem); }} primaryLabel={isFreePlan ? "Start (free)" : "Start session"} disabled={!consent || blocked} />
  </div>;
}
