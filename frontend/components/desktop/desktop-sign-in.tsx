"use client";
import { useState, type FormEvent } from "react";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isDesktopApp } from "@/lib/desktop-bridge";
import { messageOf } from "@/lib/api";
import { Notice } from "./desktop-ui";

type Props = {
  /** Starts Google sign-in in the system browser (desktop) or a redirect (web preview). */
  onGoogle: () => Promise<void>;
  waitingForBrowser: boolean;
  error: string;
  onCreateAccount: () => void;
};

function GoogleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" /></svg>;
}

export function DesktopSignIn({ onGoogle, waitingForBrowser, error, onCreateAccount }: Props) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function signInWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setFormError("Email sign-in is not available right now."); return; }
    const form = new FormData(event.currentTarget);
    setBusy(true); setFormError("");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: String(form.get("email") || "").trim(), password: String(form.get("password") || "") });
      if (signInError) setFormError(signInError.message.includes("Invalid") ? "That email and password don't match." : signInError.message);
      // Success arrives through the auth listener in DesktopApp.
    } catch (caught) { setFormError(messageOf(caught)); }
    finally { setBusy(false); }
  }

  return <div className="iwd-body iwd-signin">
    <h1>Sign in to start</h1>
    <p className="iwd-muted">Your minutes, resume and past sessions come with your InterviewWin account.</p>
    <button type="button" className="iwd-btn iwd-btn-google" onClick={() => { void onGoogle(); }} disabled={waitingForBrowser}>
      {waitingForBrowser ? <Loader2 size={16} className="iwd-spin" aria-hidden="true" /> : <GoogleIcon />}
      {waitingForBrowser ? "Finish signing in in your browser…" : "Continue with Google"}
    </button>
    {waitingForBrowser && isDesktopApp() && <p className="iwd-hint">We opened your browser. After you sign in there, come back here — this window signs in by itself. <button type="button" className="iwd-link" onClick={() => { void onGoogle(); }}>Open the browser again</button></p>}
    {error && <Notice tone="error">{error}</Notice>}
    {!emailOpen ? <button type="button" className="iwd-btn iwd-btn-ghost iwd-wide" onClick={() => setEmailOpen(true)}><Mail size={15} aria-hidden="true" /> Use email and password</button> : <form className="iwd-form" onSubmit={event => { void signInWithEmail(event); }}>
      <label className="iwd-field">Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="iwd-field">Password<input name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>
      {formError && <Notice tone="error">{formError}</Notice>}
      <button type="submit" className="iwd-btn iwd-btn-primary iwd-wide" disabled={busy}>{busy && <Loader2 size={15} className="iwd-spin" aria-hidden="true" />}Sign in</button>
    </form>}
    <p className="iwd-fine">New here? <button type="button" className="iwd-link" onClick={onCreateAccount}>Create a free account</button></p>
  </div>;
}
