"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Clock3, Copy, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { answeredTurns, filterSessions, sessionFileName, sessionMarkdown } from "@/lib/desktop-export";
import { api, formatDate, messageOf } from "@/lib/api";
import type { Session, User } from "@/lib/types";
import { InfoTip, Notice, Segmented, minutesLeft } from "./desktop-ui";

const MAX_LISTED = 20;
const STATUS_MS = 2500;
const REVOKE_DELAY_MS = 1000;

type Props = {
  user: User;
  sessions: Session[];
  notice: string;
  onDismissNotice: () => void;
  onCreate: () => void;
  onBuyMinutes: () => void;
  onRefresh: () => void;
};

export function DesktopHome({ user, sessions, notice, onDismissNotice, onCreate, onBuyMinutes, onRefresh }: Props) {
  const [tab, setTab] = useState<"create" | "past">("create");
  const left = minutesLeft(user.minute_limit, user.minutes_used);
  const canStart = left === null || left >= 1;
  const startLabel = user.plan === "free" ? "Free session" : "Start session";
  return <div className="iwd-body">
    <Segmented label="Sessions" value={tab} onChange={setTab} options={[{ value: "create", label: "Create" }, { value: "past", label: "Past Sessions" }]} />
    {notice && <Notice tone="info" onDismiss={onDismissNotice}>{notice}</Notice>}
    {tab === "create" ? <>
      <div className="iwd-label-row"><span className="iwd-section-title">Select session type</span><InfoTip text="Sessions use your live minutes while they run. Minutes stop the moment you end the session." /></div>
      <div className="iwd-choice-row">
        <button type="button" className="iwd-choice" onClick={onCreate} disabled={!canStart}>
          <span>{startLabel}</span>
          <strong>{left === null ? "Unlimited" : `${Math.floor(left)} min`}</strong>
        </button>
        <button type="button" className="iwd-choice iwd-choice-dark" onClick={onBuyMinutes}>Buy minutes</button>
      </div>
      {!canStart && <p className="iwd-hint">You’re out of live minutes. Buy a minute pack to start a session — it opens in your browser.</p>}
    </> : <PastSessions sessions={sessions} onRefresh={onRefresh} />}
  </div>;
}

function PastSessions({ sessions, onRefresh }: { sessions: Session[]; onRefresh: () => void }) {
  const [open, setOpen] = useState<Session | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  async function show(session: Session) {
    setLoading(session.id); setError("");
    try { setOpen(await api<Session>(`/sessions/${encodeURIComponent(session.id)}`)); }
    catch (caught) { setError(messageOf(caught)); }
    finally { setLoading(null); }
  }
  if (open) return <SessionDetail session={open} onBack={() => setOpen(null)} />;
  const shown = filterSessions(sessions, query).slice(0, MAX_LISTED);
  const empty = sessions.length ? `No sessions match “${query.trim()}”.` : "Your sessions appear here after you run one.";
  return <div className="iwd-past">
    <div className="iwd-label-row"><span className="iwd-section-title">Recent sessions</span><button type="button" className="iwd-icon-btn" aria-label="Refresh sessions" onClick={onRefresh}><RefreshCw size={14} /></button></div>
    {sessions.length > 1 && <label className="iwd-search"><Search size={14} aria-hidden="true" /><input type="search" value={query} maxLength={80} placeholder="Search by company or role" aria-label="Search sessions" onChange={event => setQuery(event.target.value)} /></label>}
    {error && <Notice tone="error">{error}</Notice>}
    {shown.length ? <ul className="iwd-session-list">{shown.map(session => <li key={session.id}>
      <button type="button" onClick={() => { void show(session); }} disabled={loading !== null}>
        <Clock3 size={15} aria-hidden="true" />
        <span><strong>{session.title}</strong><small>{formatDate(session.created_at)} · {session.status === "ended" ? "Ended" : session.status === "live" ? "Live" : "Started"}</small></span>
        {loading === session.id ? <Loader2 size={15} className="iwd-spin" aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
      </button>
    </li>)}</ul> : <p className="iwd-muted">{empty}</p>}
  </div>;
}

/** Save text as a file: a save dialog in the desktop app, a download in a browser. */
function saveTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

function SessionDetail({ session, onBack }: { session: Session; onBack: () => void }) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(""), STATUS_MS);
    return () => clearTimeout(timer);
  }, [status]);
  const answered = answeredTurns(session);
  const markdown = () => sessionMarkdown(session, formatDate(session.created_at));
  async function copy() {
    try { await navigator.clipboard.writeText(markdown()); setStatus("Copied all answers."); }
    catch { setStatus("Couldn’t copy. Try again."); }
  }
  function save() {
    try { saveTextFile(sessionFileName(session), markdown()); }
    catch { setStatus("Couldn’t save the file. Try Copy instead."); }
  }
  return <div className="iwd-past">
    <div className="iwd-label-row">
      <button type="button" className="iwd-btn iwd-btn-ghost iwd-small" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /> All sessions</button>
      <span className="iwd-spacer" />
      {answered.length > 0 && <>
        <button type="button" className="iwd-btn iwd-btn-ghost iwd-small" onClick={() => { void copy(); }}><Copy size={13} aria-hidden="true" /> Copy</button>
        <button type="button" className="iwd-btn iwd-btn-ghost iwd-small" onClick={save}><Download size={13} aria-hidden="true" /> Save .md</button>
      </>}
    </div>
    <h2 className="iwd-past-title">{session.title}</h2>
    <p className="iwd-muted iwd-small-text" role="status">{status || `${formatDate(session.created_at)} · ${answered.length} answered`}</p>
    <div className="iwd-scroll">
      {answered.length ? answered.map(turn => <article key={turn.id} className="iwd-turn"><h3>{turn.question}</h3><p>{turn.answer}</p></article>)
        : <p className="iwd-muted">No answers were saved for this session.</p>}
    </div>
  </div>;
}
