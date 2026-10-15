import { LoaderCircle, X, CircleAlert, ArrowUpRight, FileText } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Evidence } from "@/lib/types";

export function Button({ children, variant = "primary", busy, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return <button className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy} aria-busy={busy || undefined}>{busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}{children}</button>;
}
export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "info" | "success" }) {
  return <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}><CircleAlert size={18} aria-hidden="true" /><span>{children}</span></div>;
}
export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-inner"><div className="modal-heading"><h2 id="modal-title">{title}</h2><Button variant="ghost" aria-label="Close dialog" onClick={onClose}><X size={20} /></Button></div>{children}</div></dialog>;
}
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="muted small">No source evidence is attached. Treat this answer as general guidance.</p>;
  const warning = evidence.find(item => item.retrieval_warning)?.retrieval_warning;
  return <div className="evidence-list">{warning && <Alert tone="info">{warning}</Alert>}{evidence.map(item => <details key={item.id} className="evidence"><summary><FileText size={16} aria-hidden="true" /><span>{item.source_name}<small>{item.locator || "Source excerpt"}</small></span><span className="evidence-tag">{item.verified_contribution ? "Verified contribution" : "Source context"}</span><ArrowUpRight size={15} aria-hidden="true" /></summary><p>{item.text}</p><a href={`/api/sources/${encodeURIComponent(item.source_id)}/download`} target="_blank" rel="noreferrer">Open original source <ArrowUpRight size={13} aria-hidden="true" /></a></details>)}</div>;
}
export function SectionHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}
