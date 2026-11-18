"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api, ApiError, messageOf, post, setApiAuthToken } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { fetchSupabaseMe } from "@/lib/supabase-identity";
import { desktopBridge, type DesktopCapabilities, type ShortcutStatus } from "@/lib/desktop-bridge";
import { sessionEndNotice } from "@/lib/desktop-answers";
import { DEFAULT_SETUP, SETUP_STORAGE_KEY, readSetup, setupPreferences, withAvailableSources, type DesktopSetup } from "@/lib/desktop-setup";
import type { Session, Source, User } from "@/lib/types";
import { DesktopHeader } from "./desktop-header";
import { DesktopSignIn } from "./desktop-sign-in";
import { DesktopHome } from "./desktop-home";
import { DesktopSetupContext } from "./desktop-setup-context";
import { DesktopSetupOptions } from "./desktop-setup-options";
import { DesktopSetupAudio } from "./desktop-setup-audio";
import { DesktopLiveOverlay, OVERLAY_WIDTH } from "./desktop-live";
import { minutesLabel, minutesLeft } from "./desktop-ui";
import { useDesktopLive } from "./use-desktop-live";

type Step = "home" | "context" | "options" | "audio" | "live";
type AuthState = "checking" | "signed-out" | "ready";
const CARD_WIDTH = 460;
const FALLBACK_CAPABILITIES: DesktopCapabilities = { systemAudio: "none", platform: "web", version: "" };

/** Keep the API token and the server's session cookie in step with Supabase's (refreshing) session. */
function adoptAccessToken(token: string): void {
  setApiAuthToken(token);
  void fetch("/api/auth/supabase-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token }), credentials: "include" }).catch(() => {});
}

async function identify(): Promise<User | null> {
  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) { adoptAccessToken(session.access_token); return await fetchSupabaseMe(); }
  }
  try { return await api<User>("/auth/me"); }
  catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
}

export function DesktopApp() {
  const bridge = useMemo(() => desktopBridge(), []);
  const [auth, setAuth] = useState<AuthState>("checking");
  const [authError, setAuthError] = useState("");
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [capabilities, setCapabilities] = useState<DesktopCapabilities>(FALLBACK_CAPABILITIES);
  const [step, setStep] = useState<Step>("home");
  const [storedSetup, setSetup] = useState<DesktopSetup>(DEFAULT_SETUP);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState("");
  const [overlayWidth, setOverlayWidth] = useState<number>(OVERLAY_WIDTH.initial);
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const setupLoaded = useRef(false);
  // Bumped when a session starts or ends, so a late shortcut report from an earlier session is ignored.
  const liveRun = useRef(0);

  const loadData = useCallback(async () => {
    const [sourceList, sessionList] = await Promise.allSettled([api<Source[]>("/sources"), api<Session[]>("/sessions")]);
    if (sourceList.status === "fulfilled") setSources(sourceList.value);
    if (sessionList.status === "fulfilled") setSessions(sessionList.value);
  }, []);

  const signedIn = useCallback((value: User) => {
    setUser(value); setAuth("ready"); setAuthError(""); setWaitingForBrowser(false);
    if (!setupLoaded.current) {
      setupLoaded.current = true;
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(SETUP_STORAGE_KEY); } catch { /* Defaults work without storage. */ }
      setSetup(readSetup(stored, value.preferences));
    }
    void loadData();
  }, [loadData]);

  // Leaving the page mid-session must not leave system-wide shortcuts or click-through behind.
  useEffect(() => () => { void bridge.setLive(false); }, [bridge]);

  // Outside the desktop app (a browser preview) the transparent UI gets a visible backdrop.
  useEffect(() => { document.documentElement.dataset.iwdShell = "iwDesktop" in window ? "app" : "browser"; }, []);

  // Who is signed in: the stored Supabase session, else the server cookie.
  useEffect(() => {
    let cancelled = false;
    void bridge.capabilities().then(value => { if (!cancelled) setCapabilities(value); });
    identify().then(value => { if (cancelled) return; if (value) signedIn(value); else setAuth("signed-out"); })
      .catch(error => { if (!cancelled) { setAuth("signed-out"); setAuthError(messageOf(error)); } });
    return () => { cancelled = true; };
  }, [bridge, signedIn]);

  // Supabase refreshes the access token hourly; long sessions need the fresh one.
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.access_token && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) adoptAccessToken(session.access_token);
      if (event === "SIGNED_IN" && session) void fetchSupabaseMe().then(signedIn).catch(error => setAuthError(messageOf(error)));
      if (event === "SIGNED_OUT") { setApiAuthToken(null); setUser(null); setAuth("signed-out"); }
    });
    return () => subscription.unsubscribe();
  }, [signedIn]);

  // The desktop app signs in with Google in the system browser and hands the session over here.
  useEffect(() => bridge.onAuth(event => {
    if (event.type === "error") { setWaitingForBrowser(false); setAuthError(event.message); return; }
    if (!supabase) { setAuthError("Sign-in is not configured on this site."); return; }
    void supabase.auth.setSession(event.session).then(({ error }) => {
      if (error) { setWaitingForBrowser(false); setAuthError("That sign-in expired. Try again."); }
    });
  }), [bridge]);

  useEffect(() => {
    if (!setupLoaded.current) return;
    try { window.localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(storedSetup)); } catch { /* A convenience only. */ }
  }, [storedSetup]);
  // Selections of deleted or unfinished files never reach a session.
  const setup = useMemo(() => withAvailableSources(storedSetup, sources), [storedSetup, sources]);

  const live = useDesktopLive({
    onUser: value => setUser(current => current && current.id === value.id ? value : current),
    onSession: session => setSessions(current => [session, ...current.filter(item => item.id !== session.id)]),
    onEnded: (reason, stats) => {
      liveRun.current += 1;
      void bridge.setLive(false);
      setShortcutStatus(null);
      setStep("home"); setCollapsed(false);
      setNotice(sessionEndNotice(reason, stats));
      void identify().then(value => { if (value) setUser(value); }).catch(() => undefined);
      void loadData();
    },
  });

  // Tell the desktop window how big the content is, so it can fit itself around the card or overlay.
  const mode = step === "live" ? "overlay" : "card";
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const report = () => { const box = element.getBoundingClientRect(); bridge.layout({ mode, width: Math.ceil(box.width), height: Math.ceil(box.height) }); };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bridge, mode]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const openSite = (path: string) => bridge.openExternal(`${origin}${path}`);
  async function signInWithGoogle() {
    setAuthError("");
    if (typeof window !== "undefined" && !("iwDesktop" in window)) {
      if (!supabase) { setAuthError("Google sign-in is not configured."); return; }
      await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/desktop` } });
      return;
    }
    setWaitingForBrowser(true);
    try { await bridge.signInWithGoogle(); }
    catch (error) { setWaitingForBrowser(false); setAuthError(messageOf(error)); }
  }
  async function signOut() {
    await live.stop();
    setApiAuthToken(null);
    if (supabase) await supabase.auth.signOut().catch(() => undefined);
    await api("/auth/logout", post()).catch(() => undefined);
    setUser(null); setAuth("signed-out"); setStep("home");
  }
  function activate(includeSystemAudio: boolean) {
    if (!user) return;
    // Save the session's answer settings to the profile too, so the web workspace matches.
    const preferences = setupPreferences(setup, user.preferences);
    void api<User>("/profile", { method: "PATCH", body: JSON.stringify({ preferences: { company: preferences.company, role: preferences.role, language: preferences.language, session_type: preferences.session_type, answer_model: preferences.answer_model, humanize: preferences.humanize, custom_instructions: preferences.custom_instructions } }) }).catch(() => undefined);
    live.start(setup, user, includeSystemAudio);
    const run = ++liveRun.current;
    void bridge.setLive(true, { shortcuts: setup.shortcuts }).then(status => { if (liveRun.current === run) setShortcutStatus(status); });
    setNotice(""); setStep("live");
  }

  if (step === "live" && user) {
    return <div className="iwd" data-mode="overlay"><div ref={frame} className="iwd-frame">
      <DesktopLiveOverlay live={live} user={user} setup={setup} overlayWidth={overlayWidth} onOverlayWidth={setOverlayWidth} shortcutStatus={shortcutStatus} platform={capabilities.platform} />
    </div></div>;
  }

  const left = user ? minutesLeft(user.minute_limit, user.minutes_used) : null;
  return <div className="iwd" data-mode="card"><div ref={frame} className="iwd-frame" style={{ width: CARD_WIDTH }}>
    <main className="iwd-card">
      <DesktopHeader minutes={user ? minutesLabel(user.minute_limit, user.minutes_used) : null} collapsed={collapsed} onCollapse={() => setCollapsed(value => !value)}
        onClose={() => bridge.close()} onDashboard={() => openSite("/interview")} onBuyMinutes={() => openSite("/interview?view=billing")} onSignOut={user ? () => { void signOut(); } : null} />
      {!collapsed && <>
        {auth === "checking" && <div className="iwd-body iwd-center"><Loader2 size={22} className="iwd-spin" aria-hidden="true" /><p className="iwd-muted">Getting things ready…</p></div>}
        {auth === "signed-out" && <DesktopSignIn onGoogle={signInWithGoogle} waitingForBrowser={waitingForBrowser} error={authError} onCreateAccount={() => openSite("/interview?signup=1")} />}
        {auth === "ready" && user && <>
          {step === "home" && <DesktopHome user={user} sessions={sessions} notice={notice} onDismissNotice={() => setNotice("")} onCreate={() => setStep("context")} onBuyMinutes={() => openSite("/interview?view=billing")} onRefresh={() => { void loadData(); }} />}
          {step === "context" && <DesktopSetupContext setup={setup} sources={sources} onChange={setSetup} onSourceAdded={source => setSources(current => [source, ...current.filter(item => item.id !== source.id)])} onBack={() => setStep("home")} onNext={() => setStep("options")} />}
          {step === "options" && <DesktopSetupOptions setup={setup} onChange={setSetup} onBack={() => setStep("context")} onNext={() => setStep("audio")} />}
          {step === "audio" && <DesktopSetupAudio setup={setup} capabilities={capabilities} minutesLeft={left} isFreePlan={user.plan === "free"} onChange={setSetup} onBack={() => setStep("options")} onActivate={activate} onOpenExternal={url => bridge.openExternal(url)} />}
        </>}
      </>}
    </main>
  </div></div>;
}
