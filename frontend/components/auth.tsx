"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, FileText, LockKeyhole, Radio, Sparkles } from "lucide-react";
import { messageOf } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { fetchSupabaseMe } from "@/lib/supabase-identity";
import type { User } from "@/lib/types";
import { Alert, Button } from "./ui";
import { Brand } from "./brand";
export { Brand } from "./brand";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="google-icon" style={{ flex: "none" }}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

export function Auth({ onAuthenticated, serviceError }: { onAuthenticated: (user: User) => void; serviceError: string; initialRegister?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showEmailFallback, setShowEmailFallback] = useState(false);

  // Check and sync Supabase session on mount or return from OAuth redirect
  useEffect(() => {
    let cancelled = false;

    async function syncSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && !cancelled) {
          setBusy(true);
          // Identity now comes from the Vercel /api/supabase/me route,
          // which validates the Supabase JWT itself — no caller-supplied
          // user id or email is trusted.
          const user = await fetchSupabaseMe();
          if (!cancelled) onAuthenticated(user);
        }
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void syncSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && !cancelled) {
        setBusy(true);
        try {
          const user = await fetchSupabaseMe();
          if (!cancelled) onAuthenticated(user);
        } catch (err) {
          if (!cancelled) setError(messageOf(err));
        } finally {
          if (!cancelled) setBusy(false);
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [onAuthenticated]);

  async function handleGoogleSignIn() {
    setError("");
    setBusy(true);
    try {
      const isLocal = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
      const redirectUrl = isLocal
        ? `${window.location.origin}/interview`
        : (process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/interview` : "https://www.interviewwin.live/interview");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });
      if (error) {
        if (error.message.includes("provider is not enabled") || error.message.includes("validation_failed")) {
          setError("Google Sign-In is not yet enabled in your Supabase dashboard. Please enable Google under Authentication > Providers in the Supabase console.");
        } else {
          setError(error.message);
        }
        setBusy(false);
      }
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      // Email fallback also goes through Supabase Auth directly (no
      // FastAPI backend), then the same verified /api/supabase/me route.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: String(form.get("email") || ""),
        password: String(form.get("password") || ""),
      });
      if (signInError) throw signInError;
      const user = await fetchSupabaseMe();
      onAuthenticated(user);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link href="/" className="auth-home" aria-label="InterviewWin home">
          <Brand />
        </Link>
        <div className="auth-copy">
          <p className="eyebrow">
            <span className="status-dot" /> BUILT AROUND YOUR EXPERIENCE
          </p>
          <h1>
            Your work.<br />
            In your <em>words.</em>
          </h1>
          <p>
            Bring your experience into the conversation. Live assistance grounded in the projects, documents, and contributions that are yours.
          </p>
          <div className="story-flow">
            <div><FileText size={19} /><span>Your knowledge</span></div>
            <ArrowRight size={17} />
            <div><Radio size={19} /><span>Live conversation</span></div>
            <ArrowRight size={17} />
            <div><Sparkles size={19} /><span>Grounded answers</span></div>
          </div>
        </div>
        <div className="auth-foot">
          <LockKeyhole size={17} />
          <p>
            Visible consent. Private sources.<br />
            Raw audio is processed live and never stored.
          </p>
        </div>
        <span className="decorative-orbit" aria-hidden="true" />
      </section>

      <section className="auth-form-section">
        <div className="auth-form-wrap">
          <p className="eyebrow">YOUR NEXT INTERVIEW STARTS HERE</p>
          <h2>Sign in with Google.</h2>
          <p className="muted">
            Access your interview workspace, knowledge sources, and live assistance in seconds.
          </p>

          {(serviceError || error) && <Alert>{error || serviceError}</Alert>}

          <div style={{ marginTop: "32px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <button
              type="button"
              id="google-signin-btn"
              onClick={handleGoogleSignIn}
              disabled={busy}
              className="google-login-btn"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                width: "100%",
                padding: "13px 20px",
                fontSize: "15px",
                fontWeight: 600,
                color: "#1e293b",
                backgroundColor: "#ffffff",
                border: "1.5px solid #cbd5e1",
                borderRadius: "10px",
                cursor: busy ? "not-allowed" : "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
                transition: "all 0.18s ease-in-out",
                opacity: busy ? 0.7 : 1,
              }}
            >
              <GoogleIcon />
              <span>{busy ? "Connecting to Google…" : "Continue with Google"}</span>
            </button>
          </div>

          <div style={{ marginTop: "24px", textAlign: "center" }}>
            <button
              type="button"
              className="text-link"
              style={{ fontSize: "12px", color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => setShowEmailFallback(!showEmailFallback)}
            >
              {showEmailFallback ? "Hide password sign in" : "Need email & password sign in?"}
            </button>
          </div>

          {showEmailFallback && (
            <form onSubmit={handleEmailSubmit} className="form-stack" style={{ marginTop: "20px" }}>
              <label>
                Email address
                <input type="email" name="email" required maxLength={320} placeholder="you@example.com" />
              </label>
              <label>
                Password
                <input type="password" name="password" required maxLength={128} placeholder="Enter your password" />
              </label>
              <Button type="submit" busy={busy} className="wide">
                Sign in with Password <ArrowRight size={17} />
              </Button>
            </form>
          )}

          <p className="auth-note" style={{ marginTop: "30px" }}>
            <Check size={15} /> Authenticated securely through Supabase. For interviews where all participants have agreed to live AI assistance.
          </p>
        </div>
        <p className="auth-bottom">Keep your voice. Bring the evidence.</p>
      </section>
    </main>
  );
}
