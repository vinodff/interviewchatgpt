"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { ApiError, api, messageOf, post } from "@/lib/api";
import Link from "next/link";
import { TOP_PRIZE_MINUTES } from "@/lib/referrals";

/** Wheel faces (minutes). Every value is a real prize; the server decides which one is won. */
const SEGMENTS = [2, 1, 3, 2, 100, 4, 2, 1, 3] as const;
const SLICE = 360 / SEGMENTS.length;
const COLORS = ["#12614a", "#173b30", "#eef4ec", "#12614a", "#6fdaa8", "#173b30", "#12614a", "#eef4ec", "#173b30"];
const SPIN_MS = 4600;

function slicePath(index: number): string {
  const start = ((index * SLICE - 90) * Math.PI) / 180;
  const end = (((index + 1) * SLICE - 90) * Math.PI) / 180;
  const r = 100;
  return `M 0 0 L ${r * Math.cos(start)} ${r * Math.sin(start)} A ${r} ${r} 0 0 1 ${r * Math.cos(end)} ${r * Math.sin(end)} Z`;
}

/** Spin modal: asks the server for the prize, then animates the wheel so the pointer lands on it. */
export function SpinWheel({ onClose }: { onClose: () => void }) {
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<"ready" | "spinning" | "won" | "error">("ready");
  const [prize, setPrize] = useState(0);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && phase !== "spinning") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  async function spin() {
    if (phase === "spinning") return;
    setPhase("spinning"); setError("");
    try {
      const result = await api<{ minutes: number }>("/referrals", post({ action: "spin" }));
      const matches = SEGMENTS.flatMap((value, index) => (value === result.minutes ? [index] : []));
      const target = matches[Math.floor(Math.random() * matches.length)] ?? 0;
      const centre = target * SLICE + SLICE / 2;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Several full turns, then stop with the winning slice under the top pointer.
      setRotation(current => current - (current % 360) + 360 * (reduced ? 0 : 7) + (360 - centre));
      setPrize(result.minutes);
      window.setTimeout(() => { setPhase("won"); window.dispatchEvent(new Event("iw:refresh-user")); }, reduced ? 50 : SPIN_MS);
    } catch (problem) {
      setPhase("error");
      setError(problem instanceof ApiError && problem.status === 409 ? "Invite more friends to unlock a spin." : messageOf(problem));
    }
  }

  return (
    <div className="rf-modal-backdrop" onClick={() => { if (phase !== "spinning") onClose(); }}>
      <div className="rf-modal" role="dialog" aria-modal="true" aria-labelledby="rf-wheel-title" tabIndex={-1} ref={dialog} onClick={event => event.stopPropagation()}>
        {phase !== "spinning" && <button type="button" className="rf-close" aria-label="Close" onClick={onClose}><X size={18} /></button>}
        <h3 id="rf-wheel-title">{phase === "won" ? <>{prize === TOP_PRIZE_MINUTES ? "Jackpot! " : "You won "}<em>{prize} {prize === 1 ? "minute" : "minutes"}</em></> : <>Spin to win up to <em>{TOP_PRIZE_MINUTES} minutes</em></>}</h3>
        <div className={`rf-wheel-wrap ${phase === "won" ? "is-won" : ""} ${phase === "won" && prize === TOP_PRIZE_MINUTES ? "is-jackpot" : ""}`}>
          <span className="rf-pointer" aria-hidden="true" />
          <svg className="rf-wheel" viewBox="-104 -104 208 208" style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${SPIN_MS}ms` }} aria-hidden="true">
            {SEGMENTS.map((value, index) => {
              const angle = index * SLICE + SLICE / 2 - 90;
              const x = Math.cos((angle * Math.PI) / 180) * 64;
              const y = Math.sin((angle * Math.PI) / 180) * 64;
              const light = COLORS[index] === "#eef4ec" || COLORS[index] === "#6fdaa8";
              return (
                <g key={index}>
                  <path d={slicePath(index)} fill={COLORS[index]} stroke="#fafbf8" strokeWidth={1.5} />
                  <text x={x} y={y} transform={`rotate(${angle + 90} ${x} ${y})`} textAnchor="middle" dominantBaseline="middle" fill={light ? "#173b30" : "#fff"} fontSize={value === TOP_PRIZE_MINUTES ? 15 : 17} fontWeight={800}>{value === TOP_PRIZE_MINUTES ? "100m" : `${value}m`}</text>
                </g>
              );
            })}
            <circle r={16} fill="#fafbf8" stroke="#173b30" strokeWidth={3} />
          </svg>
          {phase === "won" && <div className="rf-confetti" aria-hidden="true">{Array.from({ length: prize === TOP_PRIZE_MINUTES ? 36 : 18 }, (_, index) => <i key={index} style={{ "--k": index } as CSSProperties} />)}</div>}
        </div>
        {phase === "won"
          ? <><p className="rf-result" role="status">Added to your account. Use them in your next interview.</p><button type="button" className="rf-btn" onClick={onClose}>Done</button></>
          : <button type="button" className="rf-btn rf-btn--spin" disabled={phase === "spinning"} onClick={() => { void spin(); }}>{phase === "spinning" ? "Spinning…" : "Spin"}</button>}
        {error && <p className="rf-error" role="alert">{error}</p>}
        <p className="rf-odds"><Link href="/terms#offers">Terms apply</Link></p>
      </div>
    </div>
  );
}
