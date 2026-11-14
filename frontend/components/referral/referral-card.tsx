"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Gift, Share2, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import Link from "next/link";
import { REFERRALS_PER_SPIN, TOP_PRIZE_MINUTES } from "@/lib/referrals";
import type { ReferralStatus } from "@/lib/server-referrals";
import { SpinWheel } from "./spin-wheel";
import "./referral.css";

const SHARE_TEXT = "I use InterviewWin for live interview help. Try it free with my link:";

/** Invite 5 friends → spin. One tap to share; the dots fill as friends join. */
export function ReferralCard() {
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const load = useCallback(() => { api<ReferralStatus>("/referrals").then(setStatus).catch(() => setStatus(null)); }, []);
  useEffect(load, [load]);
  if (!status) return null;

  const link = `${window.location.origin}/?ref=${status.code}`;
  const joined = status.spins_available > 0 ? REFERRALS_PER_SPIN : status.verified_referrals % REFERRALS_PER_SPIN;

  async function share() {
    const data = { title: "InterviewWin", text: SHARE_TEXT, url: link };
    if (navigator.share) { try { await navigator.share(data); return; } catch { /* Cancelled or unsupported: fall through to copy. */ } }
    try { await navigator.clipboard.writeText(`${SHARE_TEXT} ${link}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* Clipboard blocked; WhatsApp still opens below. */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${link}`)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="rf-card" aria-labelledby="rf-title">
      <div className="rf-head">
        <span className="rf-icon"><Gift size={20} aria-hidden="true" /></span>
        <h3 id="rf-title">Invite 5 friends. <em>Spin to win.</em></h3>
      </div>
      <p className="rf-jackpot">Win up to <strong>{TOP_PRIZE_MINUTES} free minutes</strong></p>
      <div className="rf-dots" role="img" aria-label={`${joined} of ${REFERRALS_PER_SPIN} friends joined`}>
        {Array.from({ length: REFERRALS_PER_SPIN }, (_, index) => <span key={index} className={index < joined ? "is-on" : ""} style={{ animationDelay: `${index * 60}ms` }}>{index < joined && <Check size={13} strokeWidth={3} aria-hidden="true" />}</span>)}
      </div>
      <p className="rf-sub">{status.spins_available > 0 ? "Your spin is ready" : status.friends_to_next_spin > 0 ? `${status.friends_to_next_spin} more to unlock a spin` : "You have used all your spins"}</p>
      {status.spins_available > 0
        ? <button type="button" className="rf-btn rf-btn--spin" onClick={() => setSpinning(true)}><Sparkles size={18} aria-hidden="true" /> Spin now</button>
        : <button type="button" className="rf-btn" onClick={() => { void share(); }}><Share2 size={18} aria-hidden="true" /> {copied ? "Link copied" : "Invite friends"}</button>}
      <p className="rf-odds"><Link href="/terms#offers">Terms apply</Link></p>
      {spinning && <SpinWheel onClose={() => { setSpinning(false); load(); }} />}
    </section>
  );
}
