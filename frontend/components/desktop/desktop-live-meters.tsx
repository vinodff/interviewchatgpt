"use client";
import { useEffect, useState } from "react";
import { meterPosition, type AudioSource, type DesktopAudioLevels } from "@/lib/desktop-audio";
import type { User } from "@/lib/types";

// Each meter polls on its own, so the meter alone re-renders at its rate — not the whole overlay and
// its answer card. Values are quantized, and React skips a render when a value has not changed.
const LEVEL_POLL_MS = 100;
const LEVEL_STEPS = 20;
const CLOCK_TICK_MS = 500;
const STATUS_POLL_MS = 1000;
const LOW_SECONDS = 120;
const WAVE_WEIGHTS = [0.45, 0.8, 1, 0.7, 0.5];

/** The listening wave in the toolbar. */
export function LiveWave({ readLevels, active }: { readLevels: () => DesktopAudioLevels; active: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const levels = readLevels();
      const position = Math.max(meterPosition(levels.microphone), meterPosition(levels.system));
      setLevel(Math.round(position * LEVEL_STEPS) / LEVEL_STEPS);
    }, LEVEL_POLL_MS);
    return () => clearInterval(timer);
  }, [readLevels, active]);
  const shown = active ? level : 0;
  return <span className={`iwd-wave ${active ? "is-live" : ""}`} aria-hidden="true">
    {WAVE_WEIGHTS.map((weight, index) => <i key={index} style={{ transform: `scaleY(${active ? Math.max(0.18, Math.min(1, shown * 1.6 * weight)) : 0.18})` }} />)}
  </span>;
}

export function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = String(safe % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Live minutes left (or elapsed time on an unlimited plan). Each usage report from the server re-syncs it. */
export function LiveTimer({ user }: { user: User }) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const usageKey = `${user.minutes_used}:${user.minute_limit}`;
  const [usageSync, setUsageSync] = useState(() => ({ key: usageKey, at: startedAt }));
  if (usageSync.key !== usageKey) setUsageSync({ key: usageKey, at: now });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = user.minute_limit === null ? null : (user.minute_limit - user.minutes_used) * 60 - (now - usageSync.at) / 1000;
  const text = secondsLeft === null ? clock((now - startedAt) / 1000) : clock(secondsLeft);
  return <span className={`iwd-timer ${secondsLeft !== null && secondsLeft < LOW_SECONDS ? "is-low" : ""}`} title={secondsLeft === null ? "Session time" : "Live minutes left"}>{text}</span>;
}

export type AudioStatus = { systemAvailable: boolean; microphoneAvailable: boolean; problem: string };

/** Which audio sources are working, and why one is not. Changes rarely, so it is checked once a second. */
export function useAudioStatus(readLevels: () => DesktopAudioLevels, readProblems: () => Partial<Record<AudioSource, string>>): AudioStatus {
  const [systemAvailable, setSystemAvailable] = useState(false);
  const [microphoneAvailable, setMicrophoneAvailable] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const check = () => {
      const levels = readLevels();
      const problems = readProblems();
      setSystemAvailable(levels.system !== null);
      setMicrophoneAvailable(levels.microphone !== null);
      setProblem(problems.system || problems.microphone || "");
    };
    const first = setTimeout(check, 0);
    const timer = setInterval(check, STATUS_POLL_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [readLevels, readProblems]);
  return { systemAvailable, microphoneAvailable, problem };
}
