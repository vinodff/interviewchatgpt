import { useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight, Check, CreditCard, ExternalLink, Github, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { messageOf, post } from "@/lib/api";
import { useOwnedApi } from "@/lib/use-owned-api";
import type { Health, Preferences, User } from "@/lib/types";
import { Alert, Button, Empty, Modal, SectionHeader } from "./ui";
import { AnswerPreferenceFields } from "./answer-preferences";

const subscribeHost = () => () => {};
const androidSnapshot = () => navigator.userAgent.includes("InterviewPilotAndroid/");
const serverHostSnapshot = () => false;

export function Profile({ user, setUser, notice }: { user: User; setUser: (user: User | null) => void; notice: (message: string) => void }) {
  const api = useOwnedApi();
  const androidHost = useSyncExternalStore(subscribeHost, androidSnapshot, serverHostSnapshot);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; detail: string } | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const preferences: Preferences = user.preferences || {};
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const updated = await api<User>("/profile", { method: "PATCH", body: JSON.stringify({ name: data.get("name"), github_username: data.get("github"), preferences: { ...preferences, role: data.get("role"), language: data.get("language"), answer_style: data.get("answer_style"), job_description: data.get("description"), answer_tone: data.get("answer_tone"), grounding: data.get("grounding"), english_level: data.get("english_level"), reading_mode: data.get("reading_mode"), reading_wpm: Number(data.get("reading_wpm")), response_delivery: data.get("response_delivery"), personalization: data.get("personalization") } }) });
      setUser(updated); notice("Profile saved. Upcoming questions will use this context.");
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await api("/auth/account", { method: "DELETE" }); setUser(null); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  async function verify() {
    setChecking(true); setCheck(null);
    try { setCheck(await api<{ ok: boolean; detail: string }>("/provider/check")); } catch (error) { setCheck({ ok: false, detail: messageOf(error) }); } finally { setChecking(false); }
  }
  async function github(connect: boolean) {
    if (connect && androidHost) { setError("Verify GitHub in your desktop browser, then refresh this app. Public repository imports work here."); return; }
    setGithubBusy(true); setError("");
    try {
      if (connect) {
        const { url } = await api<{ url: string }>("/profile/github/connect", post());
        const destination = new URL(url);
        if (destination.protocol !== "https:" || destination.hostname !== "github.com") throw new Error("The server returned an invalid GitHub authorization destination.");
        window.location.assign(destination.toString());
      } else {
        await api("/profile/github/connect", { method: "DELETE" }); setUser(await api<User>("/auth/me")); notice("GitHub identity disconnected.");
      }
    } catch (error) { setError(messageOf(error)); } finally { setGithubBusy(false); }
  }
  const profile = Object.entries(user.profile || {}).filter(([key, value]) => key !== "preferences" && value !== null && value !== "" && !(Array.isArray(value) && !value.length));
  return <><SectionHeader eyebrow="KEEP THE CONTEXT PERSONAL" title="Your profile" description="Your background and preferences help shape the conversation." /><div className="settings-columns"><form className="panel profile-form form-stack" onSubmit={save}><div className="panel-heading"><h2>Conversation context</h2><UserRound size={19} /></div><div className="form-grid"><label>Your name<input name="name" defaultValue={user.name} required maxLength={120} /></label><label>Email address<input value={user.email} readOnly type="email" className="read-only" /></label></div><label><span className="label-icon"><Github size={15} /> GitHub username</span><input name="github" defaultValue={user.github_username} maxLength={39} pattern="[a-zA-Z0-9-]*" placeholder="Your public GitHub identity" /></label><div className="github-identity"><p>{user.github_verified ? `Verified GitHub identity: ${user.github_verified_username}` : "Your typed username is unverified. Connect GitHub to prove repository identity."}</p><Button type="button" variant="secondary" busy={githubBusy} disabled={androidHost && !user.github_verified} onClick={() => { void github(!user.github_verified); }}><Github size={16} />{user.github_verified ? "Disconnect GitHub" : "Verify GitHub identity"}</Button><small>{androidHost ? "Verify GitHub in your desktop browser, then refresh this app. Public repository imports work here." : "After connecting, retry existing repository sources. Only eligible signed commits linked to this identity establish verified contribution."}</small></div><div className="form-grid"><label>Target role<input name="role" defaultValue={preferences.role || ""} maxLength={160} placeholder="e.g. Senior software engineer" /></label><label>Answer language<input name="language" defaultValue={preferences.language || "English"} maxLength={80} placeholder="English" /></label></div><AnswerPreferenceFields preferences={preferences} /><label>Job or meeting context<textarea name="description" defaultValue={preferences.job_description || ""} rows={5} maxLength={12000} placeholder="Paste the job description or describe the purpose of your meeting…" /></label>{error && !deleting && <Alert>{error}</Alert>}<Button type="submit" busy={busy}>Save profile <Check size={17} /></Button></form><div className="settings-right"><section className="panel"><div className="panel-heading"><h2>What your sources say</h2><Sparkles size={19} /></div><p className="muted small">Extracted from your knowledge library. We keep claims tied to supporting evidence.</p>{profile.length ? <dl className="extracted-profile">{profile.map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{typeof value === "string" ? value : Array.isArray(value) ? value.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" · ") : JSON.stringify(value, null, 2)}</dd></div>)}</dl> : <Empty icon={<UserRound size={23} />} title="Your story is still taking shape">Add a resume and project sources to build an evidence-grounded profile.</Empty>}</section><section className="panel provider-check"><h2>Live service readiness</h2><p className="muted small">Verify that the configured Google models are available before an important conversation.</p><Button variant="secondary" busy={checking} onClick={() => { void verify(); }}>Check AI connection</Button>{check && <Alert tone={check.ok ? "success" : "error"}>{check.detail || (check.ok ? "Configured models are available." : "Provider verification failed.")}</Alert>}</section></div></div>{!user.testing_mode && <section className="danger-zone"><div><h2>Delete your account</h2><p>Remove your profile, sources, projects, and retained conversations permanently.</p></div><Button variant="danger" onClick={() => { setDeleting(true); setError(""); }}>Delete account</Button></section>}{deleting && !user.testing_mode && <Modal title="Permanently delete your account?" onClose={() => { if (!busy) setDeleting(false); }}><p>This deletes <strong>{user.email}</strong> and every source, project, and session in your workspace. This action cannot be undone.</p><p className="muted small">Manage or cancel an active subscription through the billing portal before deleting your account.</p>{error && <Alert>{error}</Alert>}<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setDeleting(false)}>Keep account</Button><Button variant="danger" busy={busy} onClick={() => { void remove(); }}>Delete everything</Button></div></Modal>}</>;
}

export function Billing({ user, health }: { user: User; health: Health | null }) {
  const api = useOwnedApi();
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState("");
  async function redirect(action: "checkout" | "portal") {
    setBusy(action); setError("");
    try {
      const { url } = await api<{ url: string }>(`/billing/${action}`, post());
      const target = new URL(url);
      if (target.protocol !== "https:" || !(target.hostname === "stripe.com" || target.hostname.endsWith(".stripe.com"))) throw new Error("The billing service returned an invalid Stripe destination.");
      window.location.assign(target.toString());
    } catch (error) { setError(messageOf(error)); setBusy(null); }
  }
  if (user.testing_mode || user.minute_limit === null) return <><SectionHeader title="Testing mode" description="Your testing workspace has unlimited live minutes." /><section className="panel provider-check"><h2>Unlimited minutes</h2><p className="muted small">No subscription is needed. AI provider quotas still apply.</p></section></>;
  return <><SectionHeader eyebrow="SPACE FOR MORE CONVERSATIONS" title="Plan & billing" description="A clear view of your monthly live usage and subscription." />{error && <Alert>{error}</Alert>}<div className="billing-columns"><section className="panel current-plan"><div className="panel-heading"><h2>Your workspace</h2><span className="plan-label">{user.plan}</span></div><div className="minutes-number">{Math.max(0, Math.ceil(user.minute_limit - user.minutes_used))}<span>minutes remaining</span></div><progress value={Math.min(user.minutes_used, user.minute_limit)} max={user.minute_limit || 1} aria-label="Minutes used this month" /><p className="muted">{Math.ceil(user.minutes_used)} of {user.minute_limit} minutes used this month.</p><div className="plan-details"><p><Check size={17} /> Evidence from your private knowledge</p><p><Check size={17} /> Automatic live question detection</p><p><Check size={17} /> Separate audio channels when available</p><p><Check size={17} /> Your choice of transcript retention</p></div></section><section className="billing-offer"><span className="eyebrow">ROOM TO GO FURTHER</span><h2>More time.<br /><em>Same personal touch.</em></h2><p>Upgrade for a larger monthly allowance of authorized live conversations. Your current price and plan terms appear in secure checkout before you subscribe.</p>{health && !health.billing_configured && <Alert tone="info">Billing is not configured on this installation. Ask your workspace administrator to enable Stripe.</Alert>}<Button busy={busy === "checkout"} disabled={!!busy || health?.billing_configured === false || user.plan !== "free"} onClick={() => { void redirect("checkout"); }}>Upgrade workspace <ArrowRight size={17} /></Button><Button variant="secondary" busy={busy === "portal"} disabled={!!busy || health?.billing_configured === false} onClick={() => { void redirect("portal"); }}><CreditCard size={17} /> Manage billing <ExternalLink size={14} /></Button><small><ShieldCheck size={14} /> Payments are handled securely by Stripe.</small></section></div></>;
}
