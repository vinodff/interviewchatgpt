"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ArrowRight, AudioLines, BookOpen, Check, ChevronRight, Clock3, CreditCard, FileText, Folder, LayoutDashboard, LogOut, Menu, Radio, RefreshCw, ShieldCheck, UserRound, X } from "lucide-react";
import { api, ApiError, formatDate, messageOf, post } from "@/lib/api";
import type { Health, Project, Session, Source, User } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { Auth, Brand } from "./auth";
import { Alert, Button, Empty, SectionHeader } from "./ui";
import { Library } from "./library";
import { History } from "./history";
import { Profile } from "./settings";
import { Billing } from "./billing";
import { LivePanel } from "./live-panel";
import { interviewUrl, interviewView, type InterviewView } from "@/lib/interview-navigation";

type Page = InterviewView;
const mobileQuery = "(max-width:760px)";
function subscribeMobile(change: () => void) { const media = window.matchMedia(mobileQuery); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }
const navigation = [
  { id: "overview", label: "My interviews", icon: LayoutDashboard },
  { id: "live", label: "Live interview", icon: Radio },
  { id: "library", label: "Resume & projects", icon: BookOpen },
  { id: "history", label: "Past interviews", icon: Clock3 },
  { id: "profile", label: "My profile", icon: UserRound },
  { id: "billing", label: "Plans & billing", icon: CreditCard },
] as const;

export function Workspace({ initialPage = "overview", initialRegister = false, initialPlan }: { initialPage?: Page; initialRegister?: boolean; initialPlan?: "starter" | "pro" | "value" }) {
  const [user, setUser] = useState<User | null>(null);
  const [initial, setInitial] = useState(true);
  const [page, setPage] = useState<Page>(initialPage);
  const [menu, setMenu] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const [answerHeight, setAnswerHeight] = useState(30);
  const [mobileViewportHeight, setMobileViewportHeight] = useState<number | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia(mobileQuery).matches, () => false);
  const mobileLive = mobile && page === "live";
  const sidebar = useRef<HTMLElement>(null);
  const dataRequest = useRef<AbortController | null>(null);
  const authEpoch = useRef(0);
  const identity = useRef<string | null>(null);
  const authTransition = useRef(false);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async (replace = true) => {
    if (authTransition.current) return;
    if (!replace && refreshInFlight.current) return;
    const epoch = authEpoch.current;
    dataRequest.current?.abort();
    const request = new AbortController(); dataRequest.current = request;
    refreshInFlight.current = true;
    setLoading(true);
    const results = await Promise.allSettled([
      api<Project[]>("/projects", { signal: request.signal }),
      api<Source[]>("/sources", { signal: request.signal }),
      api<Session[]>("/sessions", { signal: request.signal }),
      api<User>("/auth/me", { signal: request.signal }),
      api<Health>("/health", { signal: request.signal })
    ]);
    if (dataRequest.current === request) refreshInFlight.current = false;
    if (request.signal.aborted || epoch !== authEpoch.current) return;

    if (results[0].status === "fulfilled") setProjects(results[0].value);
    if (results[1].status === "fulfilled") setSources(results[1].value);
    if (results[2].status === "fulfilled") setSessions(results[2].value);
    if (results[3].status === "fulfilled") {
      const me = results[3].value;
      if (me.id !== identity.current) {
        authEpoch.current++; setAuthVersion(authEpoch.current); identity.current = me.id; setNotice("");
      }
      setUser(me);
    } else if (results[3].reason instanceof ApiError && results[3].reason.status === 401) {
      identity.current = null; setUser(null); setProjects([]); setSources([]); setSessions([]);
    }
    if (results[4].status === "fulfilled") setHealth(results[4].value);
    const rejected = results.find(result => result.status === "rejected");
    const failure = rejected?.status === "rejected" ? messageOf(rejected.reason) : "";
    setError(failure); setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 15000);
    api<User>("/auth/me", { signal: controller.signal }).then(value => {
      identity.current = value.id;
      setUser(value);
      void refresh();
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof ApiError && error.status === 401 ? "" : messageOf(error));
    }).finally(() => {
      clearTimeout(timer);
      setInitial(false);
    });
    return () => { clearTimeout(timer); controller.abort(); dataRequest.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (!menu || !mobile) return;
    const drawer = sidebar.current;
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])") || []);
    focusable()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key === "Escape") { setMenu(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus()); }
      if (event.key !== "Tab") return;
      const nodes = focusable(); const first = nodes[0]; const last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [menu, mobile]);
  useEffect(() => {
    if (!mobileLive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileLive]);
  const pending = sources.some(source => source.status === "queued" || source.status === "processing");
  useEffect(() => {
    if (!pending || !user) return;
    const interval = setInterval(() => { void refresh(false); }, 5000);
    return () => clearInterval(interval);
  }, [pending, user, refresh]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const followHistory = () => { setPage(interviewView(new URLSearchParams(window.location.search).get("view"))); setMenu(false); };
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);

  function navigate(next: Page) {
    if (next !== page) {
      const target = `${interviewUrl(next)}${initialPlan ? `&plan=${initialPlan}` : ""}`;
      window.history.pushState(null, "", target);
    }
    setPage(next); setMenu(false);
    if (mobile) requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  }
  function closeMenu() { setMenu(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')?.focus()); }
  function updateUser(value: User | null) {
    authEpoch.current++; setAuthVersion(authEpoch.current); dataRequest.current?.abort();
    const nextUser = value;
    if (nextUser?.id !== identity.current) {
      setProjects([]); setSources([]); setSessions([]); setNotice(""); setMenu(false); setActive(false);
    }
    identity.current = nextUser?.id || null;
    setUser(nextUser);
  }
  async function logout() {
    if (authTransition.current) return;
    authTransition.current = true;
    authEpoch.current++;
    setAuthVersion(authEpoch.current);
    dataRequest.current?.abort();
    try {
      await supabase.auth.signOut().catch(() => {});
      await api("/auth/logout", post());
      updateUser(null);
      setPage("overview");
      window.history.replaceState(null, "", interviewUrl("overview"));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      authTransition.current = false;
      setLoading(false);
    }
  }
  if (initial) return <main className="initial-loader"><Brand /><AudioLines size={30} className="pulse" /><p>Getting your interview ready…</p></main>;
  if (!user) return <Auth initialRegister={initialRegister} onAuthenticated={value => { updateUser(value); void refresh(); }} serviceError={error} />;
  const visibleNavigation = navigation;
  const ready = sources.filter(source => source.status === "ready").length;
  const renderEpoch = authVersion;
  function ownedNotice(message: string) { if (renderEpoch === authEpoch.current && identity.current === user?.id) setNotice(message); }
  function ownedUpdateUser(value: User | null) {
    if (renderEpoch !== authEpoch.current || identity.current !== user?.id) return;
    if (value === null) { updateUser(null); return; }
    if (value.id !== identity.current) return;
    // A same-account profile save keeps the live controller and auth identity intact.
    dataRequest.current?.abort(); refreshInFlight.current = false; setLoading(false); setUser(value);
  }
  const globalAlerts = <>{error && <div className="global-alert"><Alert>{error}</Alert></div>}{notice && <div className="global-alert"><Alert tone="success">{notice}</Alert></div>}</>;
  const liveToolbar = <><div className="mobile-live-brand"><AudioLines size={25} aria-hidden="true" /><div><strong>InterviewWin Live</strong><h1>Live interview</h1></div></div><nav aria-label="Live interview navigation"><Button variant="ghost" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={21} /></Button><Button variant="ghost" aria-label="Refresh interview" busy={loading} onClick={() => { void refresh(); }}><RefreshCw size={17} /></Button><Button variant="ghost" aria-label="Open your profile" onClick={() => navigate("profile")}><UserRound size={19} /></Button></nav></>;
  async function ownedRefresh() { if (identity.current === user?.id) await refresh(); }
  return <div className={`workspace ${mobileLive ? "mobile-live" : ""}`} style={{ "--answer-height": `${answerHeight}%`, "--mobile-answer-top": mobileViewportHeight ? `${mobileViewportHeight * answerHeight / 100}px` : `${answerHeight}dvh`, ...(mobileViewportHeight ? { "--live-viewport-height": `${mobileViewportHeight}px` } : {}) } as CSSProperties}><a className="skip-link" href="#main-content">Skip to content</a>{menu && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={closeMenu} />}<aside ref={sidebar} role={mobile ? "dialog" : undefined} aria-modal={mobile && menu || undefined} inert={mobile && !menu || undefined} aria-hidden={mobile && !menu || undefined} className={`sidebar ${menu ? "open" : ""}`} aria-label="Interview navigation"><div className="sidebar-brand"><Brand /><Button variant="ghost" className="mobile-only" aria-label="Close navigation" onClick={closeMenu}><X size={20} /></Button></div><div className="workspace-label"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.testing_mode ? "Local preview" : `Personal · ${user.plan}`}</small></div></div><p className="nav-label">INTERVIEWS</p><nav>{visibleNavigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? "selected" : ""}`} aria-current={page === id ? "page" : undefined} onClick={() => navigate(id)}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{id === "live" && active && <span className="status-dot" aria-label="Live session active" />}{id === "library" && sources.length > 0 && <span className="nav-count">{sources.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="usage-card">{user.minute_limit === null ? <><div><span>Preview access</span><span>Unlimited minutes</span></div><small>{Math.ceil(user.minutes_used)} minutes used · AI service limits may apply</small></> : <><div><span>{user.plan === "free" ? "Free plan" : `${user.plan} plan`}</span><span>{Math.max(0, Math.ceil(user.minute_limit - user.minutes_used))} min left</span></div><progress value={Math.min(user.minutes_used, user.minute_limit)} max={user.minute_limit || 1} aria-label="Monthly live minute usage" /><small>{Math.ceil(user.minutes_used)} of {user.minute_limit} monthly minutes used</small><button onClick={() => navigate("billing")}>Manage your plan <ArrowRight size={14} /></button></>}</div>{!user.testing_mode && <button className="logout-button" onClick={() => { void logout(); }}><LogOut size={17} /> Sign out</button>}<div className="sidebar-fine"><ShieldCheck size={14} /> Private by design</div></div></aside><div className="main-column" inert={mobile && menu || undefined}>{!mobileLive && <header className="topbar"><div><Button variant="ghost" className="mobile-only" aria-label="Open navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={21} /></Button><span className="breadcrumb">InterviewWin <ChevronRight size={14} /> <strong>{navigation.find(item => item.id === page)?.label}</strong></span></div><div className="topbar-right"><span className={`service-status ${health?.ai_configured ? "" : "unconfigured"}`}><span className="status-dot" />{health ? health.ai_configured ? "Ready for interviews" : "Live answers unavailable" : "Checking service"}</span><Button variant="ghost" aria-label="Refresh interview" busy={loading} onClick={() => { void refresh(); }}><RefreshCw size={17} /></Button><button className="avatar avatar-button" aria-label="Open your profile" onClick={() => navigate("profile")}>{user.name.slice(0, 1).toUpperCase()}</button></div></header>}<main id="main-content" className="main-content" tabIndex={-1}>{!mobileLive && globalAlerts}{page === "overview" && <><SectionHeader eyebrow="A LITTLE PREPARATION. A BETTER CONVERSATION." title={`Welcome${user.name ? `, ${user.name.split(" ")[0]}` : " back"}.`} description="Make your experience easy to reach when the conversation gets going." /><section className="overview-hero"><div className="hero-copy"><span className="live-label"><span className="status-dot" /> LIVE ASSISTANCE, GROUNDED IN YOU</span><h2>Be present.<br /><em>We’ll connect the dots.</em></h2><p>Your projects, your experience, and the right evidence — ready as questions come in.</p><Button onClick={() => navigate("live")}><Radio size={18} /> Start live interview <ArrowRight size={16} /></Button><small><ShieldCheck size={14} /> Starts only after your explicit consent.</small></div><div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" /><div className="signal-mark"><AudioLines size={62} strokeWidth={1.2} /></div><div className="orbit-word word-one"><FileText size={14} /> Your sources</div><div className="orbit-word word-two"><Folder size={14} /> Your projects</div><div className="orbit-word word-three">Your voice <AudioLines size={14} /></div></div></section><div className="stat-strip"><div><BookOpen size={20} /><span><strong>{ready}</strong> ready sources</span></div><div><Folder size={20} /><span><strong>{projects.length}</strong> projects</span></div><div><Clock3 size={20} /><span><strong>{sessions.length}</strong> conversations</span></div><div><AudioLines size={20} /><span><strong>{Math.ceil(user.minutes_used)}</strong> minutes this month</span></div></div><div className="overview-columns"><section className="panel"><div className="panel-heading"><h2>Make it yours</h2><span className="muted small">QUICK SETUP</span></div><div className="setup-list">{[
    { completed: ready > 0, title: "Bring your experience", detail: "Upload a resume, project notes, or portfolio.", page: "library" as Page, icon: FileText },
    { completed: projects.length > 0, title: "Connect your projects", detail: "Add source context and a public GitHub repository.", page: "library" as Page, icon: Folder },
    { completed: !!user.preferences?.role, title: "Set the conversation context", detail: "Your role, language, and preferred answer style.", page: "profile" as Page, icon: UserRound },
  ].map(({ completed, title, detail, page, icon: Icon }) => <button className="setup-item" key={title} onClick={() => navigate(page)}><span className={`setup-icon ${completed ? "completed" : ""}`}>{completed ? <Check size={19} /> : <Icon size={19} />}</span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} /></button>)}</div></section><section className="panel"><div className="panel-heading"><h2>Recent conversations</h2><button className="text-link" onClick={() => navigate("history")}>View all <ArrowRight size={14} /></button></div>{sessions.length ? <div className="recent-list">{sessions.slice(0, 3).map(session => <button key={session.id} onClick={() => navigate("history")}><span className="recent-icon"><AudioLines size={19} /></span><span><strong>{session.title}</strong><small>{formatDate(session.created_at)} · {session.status}</small></span><ChevronRight size={16} /></button>)}</div> : <Empty icon={<Clock3 size={23} />} title="Your next conversation starts here">Completed sessions appear here when transcript retention is enabled.</Empty>}</section></div><div className="privacy-line"><ShieldCheck size={17} /><p>Your resume helps personalize your answers. Audio is processed live, never saved. Only use live assistance with everyone’s consent.</p></div></>}
{page === "library" && <Library key={user.id} projects={projects} sources={sources} refresh={ownedRefresh} notice={ownedNotice} loading={loading} />}
{page === "history" && <History key={user.id} sessions={sessions} refresh={ownedRefresh} notice={ownedNotice} loading={loading} />}
{page === "profile" && <Profile key={user.id} user={user} setUser={ownedUpdateUser} notice={ownedNotice} />}
{page === "billing" && <Billing key={user.id} user={user} health={health} selectedPlan={initialPlan} />}
<div hidden={page !== "live"}><LivePanel key={user.id} sources={sources} health={health} user={user} mobile={mobile} visible={page === "live"} toolbar={liveToolbar} alerts={mobileLive ? globalAlerts : null} onUser={ownedUpdateUser} onAnswerHeight={setAnswerHeight} onViewportHeight={setMobileViewportHeight} onActive={setActive} onSession={session => { if (renderEpoch !== authEpoch.current || identity.current !== user.id) return; setSessions(current => [session, ...current.filter(item => item.id !== session.id)]); if (session.status === "ended") void refresh(); }} /></div>
</main><footer className="main-footer"><span>InterviewWin Live</span><nav aria-label="Website resources"><a href="/help" target="_blank" rel="noreferrer">Help</a><a href="/contact" target="_blank" rel="noreferrer">Contact</a><a href="/" target="_blank" rel="noreferrer">Website</a></nav><span>Your experience is the source of truth.</span></footer></div></div>;
}
