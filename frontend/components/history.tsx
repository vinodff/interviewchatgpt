import { useEffect, useState } from "react";
import { ArrowUpRight, AudioLines, Clock3, LoaderCircle, Trash2 } from "lucide-react";
import { api, formatDate, messageOf } from "@/lib/api";
import type { Session } from "@/lib/types";
import { Alert, Button, Empty, EvidenceList, Modal, SectionHeader } from "./ui";
import { useOwnedApi } from "@/lib/use-owned-api";

export function History({ sessions, refresh, notice, loading }: { sessions: Session[]; refresh: () => Promise<void>; notice: (message: string) => void; loading: boolean }) {
  const mutation = useOwnedApi();
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    api<Session>(`/sessions/${selected}`, { signal: controller.signal }).then(setDetail).catch(error => { if (!controller.signal.aborted) setError(messageOf(error)); }).finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selected]);
  function open(id: string) { setDetail(null); setError(""); setDetailLoading(true); setSelected(id); }
  async function remove() {
    if (!deleting) return;
    setBusy(true); setError("");
    try { await mutation(`/sessions/${deleting.id}`, { method: "DELETE" }); setDeleting(null); notice("Session and its retained transcript deleted."); await refresh(); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <><SectionHeader eyebrow="GOOD CONVERSATIONS LEAVE SOMETHING BEHIND" title="Session history" description="Revisit retained transcripts, grounded answers, and source evidence." /><div className="panel session-panel">{sessions.length ? <><div className="session-table-heading"><span>Conversation</span><span>Date</span><span>Status</span><span>Actions</span></div>{sessions.map(session => <div className="session-row" key={session.id}><button className="session-title" onClick={() => open(session.id)}><span className="recent-icon"><AudioLines size={20} /></span><span><strong>{session.title}</strong><small>{session.audio_mode === "tab" ? "Separate tab & microphone" : "Mixed microphone"} · {session.retention ? "Transcript retained" : "No transcript retention"}</small></span><ArrowUpRight size={16} /></button><span className="session-date">{formatDate(session.created_at)}</span><span className={`session-badge session-${session.status}`}>{session.status}</span><Button variant="ghost" aria-label={`Delete session ${session.title}`} onClick={() => { setDeleting(session); setError(""); }}><Trash2 size={17} /></Button></div>)}</> : loading ? <div className="loading-inline"><LoaderCircle size={20} className="spin" /> Loading conversations…</div> : <Empty icon={<Clock3 size={28} />} title="Room for your next conversation">Live sessions appear here after you start. Choose transcript retention before each session.</Empty>}</div><p className="history-note"><Clock3 size={15} /> Raw audio is never saved. Retained session text is private to your account.</p>{selected && <Modal title={detail?.title || "Conversation details"} onClose={() => setSelected(null)}>{detailLoading && <div className="loading-inline"><LoaderCircle size={20} className="spin" /> Loading transcript…</div>}{error && <Alert>{error}</Alert>}{detail && <><div className="detail-meta"><span>{formatDate(detail.created_at)}</span><span>{detail.status}</span><span>{detail.audio_mode === "tab" ? "Tab + microphone" : "Microphone"}</span></div>{detail.summary && <div className="session-summary"><p className="eyebrow">CONVERSATION SUMMARY</p><p>{detail.summary}</p></div>}{!detail.retention ? <Alert tone="info">Transcript retention was disabled for this session.</Alert> : detail.turns?.length ? <div className="turn-list">{detail.turns.map(turn => <article key={turn.id} className={`history-turn turn-${turn.role}`}><span className="eyebrow">{turn.role === "user" ? "YOU" : turn.role === "interviewer" ? "INTERVIEWER" : "SPEAKER UNCERTAIN"}</span><p>{turn.question || turn.text}</p>{turn.answer && <div className="retained-answer"><span className="eyebrow">ASSISTED ANSWER</span><p>{turn.answer}</p><EvidenceList evidence={turn.evidence || []} /></div>}</article>)}</div> : <Empty icon={<AudioLines size={24} />} title="No transcript was retained">The session may have ended before speech was recognized.</Empty>}</>}</Modal>}{deleting && <Modal title="Delete this conversation?" onClose={() => { if (!busy) setDeleting(null); }}><p><strong>{deleting.title}</strong> and all retained text and evidence will be permanently removed.</p>{deleting.status === "live" && <Alert tone="info">This session is active. Stop the live session before deleting it.</Alert>}{error && <Alert>{error}</Alert>}<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep conversation</Button><Button variant="danger" busy={busy} disabled={deleting.status === "live"} onClick={() => { void remove(); }}>Delete conversation</Button></div></Modal>}</>;
}
