"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, AudioLines, Check, FileText, LockKeyhole, Radio, Sparkles } from "lucide-react";
import { api, messageOf, post } from "@/lib/api";
import type { User } from "@/lib/types";
import { Alert, Button } from "./ui";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark"><AudioLines size={23} strokeWidth={1.8} aria-hidden="true" /></span>{!compact && <span>Interview<span className="brand-light">Pilot</span><small>LIVE WORKSPACE</small></span>}</div>;
}

export function Auth({ onAuthenticated, serviceError }: { onAuthenticated: (user: User) => void; serviceError: string }) {
  const [register, setRegister] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resetToken, setResetToken] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("reset") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => { if (resetToken) window.history.replaceState(null, "", window.location.pathname); }, [resetToken]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSuccess(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (resetToken) {
        await api("/auth/reset-confirm", post({ token: resetToken, password: form.get("password") }));
        setResetToken(""); setRecovering(false); setRegister(false); setSuccess("Password updated. Sign in with your new password.");
      } else if (recovering) {
        const result = await api<{ detail: string }>("/auth/reset-request", post({ email: form.get("email") }));
        setSuccess(result.detail);
      } else {
        onAuthenticated(await api<User>(`/auth/${register ? "register" : "login"}`, post({ email: form.get("email"), password: form.get("password"), ...(register ? { name: form.get("name") } : {}) })));
      }
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  function switchMode(create: boolean) { setRegister(create); setRecovering(false); setResetToken(""); setError(""); setSuccess(""); }
  return <main className="auth-page">
    <section className="auth-story">
      <Brand />
      <div className="auth-copy">
        <p className="eyebrow"><span className="status-dot" /> BUILT AROUND YOUR EXPERIENCE</p>
        <h1>Your work.<br />In your <em>words.</em></h1>
        <p>Bring your experience into the conversation. Live assistance grounded in the projects, documents, and contributions that are yours.</p>
        <div className="story-flow"><div><FileText size={19} /><span>Your knowledge</span></div><ArrowRight size={17} /><div><Radio size={19} /><span>Live conversation</span></div><ArrowRight size={17} /><div><Sparkles size={19} /><span>Grounded answers</span></div></div>
      </div>
      <div className="auth-foot"><LockKeyhole size={17} /><p>Visible consent. Private sources.<br />Raw audio is processed live and never stored.</p></div>
      <span className="decorative-orbit" aria-hidden="true" />
    </section>
    <section className="auth-form-section"><div className="auth-form-wrap">
      <p className="eyebrow">YOUR PRIVATE WORKSPACE</p>
      <h2>{resetToken ? "Choose a new password." : recovering ? "Find your way back." : register ? "Make yourself at home." : "Good to have you back."}</h2>
      <p className="muted">{resetToken ? "Set a strong password to secure your workspace." : recovering ? "We will email you a link to reset your password." : register ? "Create an account and start with what you know." : "Sign in to pick up where you left off."}</p>
      {!resetToken && <div className="auth-tabs" role="group" aria-label="Account access"><button type="button" aria-pressed={!register} onClick={() => switchMode(false)}>Sign in</button><button type="button" aria-pressed={register} onClick={() => switchMode(true)}>Create account</button></div>}
      {serviceError && <Alert>{serviceError}</Alert>}{success && <Alert tone="success">{success}</Alert>}
      <form onSubmit={submit} className="form-stack">
        {register && !recovering && !resetToken && <label>Your name<input name="name" autoComplete="name" required maxLength={120} placeholder="How should we call you?" /></label>}
        {!resetToken && <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={320} placeholder="you@example.com" /></label>}
        {(!recovering || resetToken) && <label>{resetToken ? "New password" : "Password"}<input type="password" name="password" autoComplete={register || resetToken ? "new-password" : "current-password"} required minLength={register || resetToken ? 12 : undefined} maxLength={128} placeholder={register || resetToken ? "At least 12 characters" : "Enter your password"} /></label>}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" busy={busy} className="wide">{resetToken ? "Save new password" : recovering ? "Send reset link" : register ? "Create my workspace" : "Sign in to workspace"}<ArrowRight size={17} /></Button>
      </form>
      {!register && !resetToken && <button className="text-link password-recovery" type="button" onClick={() => { setRecovering(!recovering); setError(""); setSuccess(""); }}>{recovering ? "Back to sign in" : "Forgot your password?"}</button>}
      <p className="auth-note"><Check size={15} /> For interviews and meetings where all participants have agreed to live AI assistance.</p>
    </div><p className="auth-bottom">Keep your voice. Bring the evidence.</p></section>
  </main>;
}
