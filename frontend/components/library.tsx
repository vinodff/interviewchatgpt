import { useRef, useState, type FormEvent } from "react";
import { ArrowUpFromLine, BookOpen, CheckCircle2, FileText, FolderPlus, Github, LoaderCircle, Plus, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";
import { formatDate, messageOf, post } from "@/lib/api";
import { useOwnedApi } from "@/lib/use-owned-api";
import type { Evidence, Project, Source } from "@/lib/types";
import { Alert, Button, Empty, EvidenceList, Modal, SectionHeader } from "./ui";
import { addStoredGithubSource, createStoredProject, deleteStoredProject, deleteStoredSource, getStoredSources, searchStoredEvidence, uploadStoredSource } from "@/lib/browser-storage";

export function Library({ projects, sources, refresh, notice, loading }: { projects: Project[]; sources: Source[]; refresh: () => Promise<void>; notice: (message: string) => void; loading: boolean }) {
  const api = useOwnedApi();
  const [project, setProject] = useState("");
  const [dialog, setDialog] = useState<"project" | "github" | null>(null);
  const [deleting, setDeleting] = useState<{ type: "project" | "source"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const searchSerial = useRef(0);
  const visible = project ? sources.filter(source => source.project_id === project) : sources;
  const selected = projects.find(item => item.id === project);

  async function upload(files: FileList | File[]) {
    setUploading(true); setError("");
    let count = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than the 20 MB limit.`);
        const form = new FormData(); form.append("file", file); if (project) form.append("project_id", project);
        try {
          await uploadStoredSource(file, project || null);
          count++;
        } catch (err) {
          setError(messageOf(err));
        }
        try {
          await api<Source>("/sources/upload", { method: "POST", body: form });
        } catch {
          // Local storage is primary
        }
      }
      if (count) notice(`${count} ${count === 1 ? "source" : "sources"} uploaded. Ready for live answers.`);
    } catch (error) { setError(messageOf(error)); }
    finally { setUploading(false); if (input.current) input.current.value = ""; await refresh(); }
  }
  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const created = await api<Project>("/projects", post({ name: data.get("name"), description: data.get("description") }));
      setProject(created.id); setDialog(null); notice("Project created. Add documents or connect a repository."); await refresh();
    } catch {
      try {
        const created = createStoredProject({ name: String(data.get("name")), description: String(data.get("description") || "") });
        setProject(created.id); setDialog(null); notice("Project created. Add documents or connect a repository."); await refresh();
      } catch (err) { setError(messageOf(err)); }
    } finally { setBusy(false); }
  }
  async function submitGithub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const projId = String(data.get("project"));
    const url = String(data.get("url"));
    try {
      await api<Source>(`/projects/${projId}/github`, post({ url }));
      setDialog(null); notice("Repository added. Analysis is queued."); await refresh();
    } catch {
      try {
        addStoredGithubSource(projId, url);
        setDialog(null); notice("Repository added."); await refresh();
      } catch (err) { setError(messageOf(err)); }
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true); setError("");
    try {
      await api(`/${deleting.type === "project" ? "projects" : "sources"}/${deleting.id}`, { method: "DELETE" });
      if (deleting.type === "project" && project === deleting.id) setProject("");
      setDeleting(null); notice("Removed from your knowledge library."); await refresh();
    } catch {
      try {
        if (deleting.type === "project") deleteStoredProject(deleting.id);
        else deleteStoredSource(deleting.id);
        if (deleting.type === "project" && project === deleting.id) setProject("");
        setDeleting(null); notice("Removed from your knowledge library."); await refresh();
      } catch (err) { setError(messageOf(err)); }
    } finally { setBusy(false); }
  }
  async function retry(id: string) {
    setError("");
    try {
      await api(`/sources/${id}/retry`, post());
      await refresh();
    } catch {
      try {
        const sources = getStoredSources().map(s => s.id === id ? { ...s, status: "ready" as const, error: null } : s);
        localStorage.setItem("interviewpilot_sources", JSON.stringify(sources));
        await refresh();
      } catch (err) { setError(messageOf(err)); }
    }
  }
  async function search(event: FormEvent) {
    event.preventDefault(); if (!query.trim()) return;
    const serial = ++searchSerial.current;
    setSearching(true); setError("");
    try {
      const results = await api<Evidence[]>(`/knowledge/search?q=${encodeURIComponent(query.trim())}`);
      if (serial === searchSerial.current) { setEvidence(results); setSearched(true); }
    } catch {
      try {
        const results = searchStoredEvidence(query.trim());
        if (serial === searchSerial.current) { setEvidence(results); setSearched(true); }
      } catch (err) { if (serial === searchSerial.current) setError(messageOf(err)); }
    } finally { if (serial === searchSerial.current) setSearching(false); }
  }

  return <><SectionHeader eyebrow="YOUR EXPERIENCE, WITH THE RECEIPTS" title="Knowledge library" description="Build the source of truth behind every live answer." action={<Button onClick={() => { setDialog("project"); setError(""); }}><Plus size={17} /> New project</Button>} />{error && !dialog && !deleting && <Alert>{error}</Alert>}<div className="library-layout"><aside className="project-panel"><div className="panel-heading"><h2>Projects</h2><FolderPlus size={17} /></div><button className={`project-item ${project === "" ? "selected" : ""}`} onClick={() => setProject("")}><BookOpen size={17} /><span>All knowledge</span><small>{sources.length}</small></button>{projects.map(item => <button key={item.id} className={`project-item ${project === item.id ? "selected" : ""}`} onClick={() => setProject(item.id)}><FileText size={17} /><span>{item.name}</span><small>{item.source_count}</small></button>)}{!projects.length && <p className="project-hint">Group your work into projects to help the assistant find the right context.</p>}<button className="text-link project-add" onClick={() => { setDialog("project"); setError(""); }}><Plus size={15} /> Add a project</button></aside><div className="library-main">{selected && <div className="project-heading"><div><h2>{selected.name}</h2>{selected.description && <p className="muted">{selected.description}</p>}</div><Button variant="ghost" aria-label={`Delete project ${selected.name}`} onClick={() => { setDeleting({ type: "project", id: selected.id, name: selected.name }); setError(""); }}><Trash2 size={17} /></Button></div>}<div className={`upload-area ${uploading ? "uploading" : ""}`} onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!uploading && event.dataTransfer.files.length) void upload(event.dataTransfer.files); }}><div className="upload-icon">{uploading ? <LoaderCircle size={24} className="spin" /> : <UploadCloud size={25} />}</div><div><h3>{uploading ? "Uploading your sources…" : "Give your experience a home."}</h3><p>Drop files here, or choose from your device.<br /><small>PDF, DOCX, TXT, Markdown, or images · Up to 20 MB per file</small></p></div><Button variant="secondary" busy={uploading} onClick={() => input.current?.click()}><ArrowUpFromLine size={16} /> Choose files</Button><input ref={input} className="sr-only" type="file" multiple accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" aria-label="Upload knowledge files" disabled={uploading} onChange={event => { if (event.target.files?.length) void upload(event.target.files); }} /></div><div className="source-toolbar"><div><h2>{selected ? "Project sources" : "All sources"}</h2><span className="count-pill">{visible.length}</span></div><Button variant="secondary" onClick={() => { setDialog(projects.length ? "github" : "project"); setError(""); }}><Github size={16} /> Connect GitHub</Button></div><div className="source-list">{visible.length ? visible.map(source => <div className="source-row" key={source.id}><div className={`file-icon ${source.kind === "github" ? "github-icon" : ""}`}>{source.kind === "github" ? <Github size={20} /> : <FileText size={20} />}</div><div className="source-info"><strong>{source.name}</strong><small>{source.kind} · {formatDate(source.created_at)}{source.status === "ready" && ` · ${source.chunk_count} excerpts`}</small>{source.error && <p className="source-error">{source.error}</p>}</div><span className={`source-status status-${source.status}`}>{source.status === "ready" ? <CheckCircle2 size={13} /> : ["queued", "processing"].includes(source.status) ? <LoaderCircle size={13} className="spin" /> : null}{source.status}</span><div className="source-actions">{source.status === "failed" && <Button variant="ghost" aria-label={`Retry ${source.name}`} onClick={() => { void retry(source.id); }}><RefreshCw size={16} /></Button>}<Button variant="ghost" aria-label={`Delete source ${source.name}`} onClick={() => { setDeleting({ type: "source", id: source.id, name: source.name }); setError(""); }}><Trash2 size={16} /></Button></div></div>) : loading ? <div className="loading-inline"><LoaderCircle size={20} className="spin" /> Loading your sources…</div> : <Empty icon={<FileText size={25} />} title="A blank page, ready for your story">Upload your resume or project documents. The assistant will extract and connect useful evidence.</Empty>}</div><p className="source-footnote">GitHub sources are public repositories. Repository contents alone do not prove your personal contribution.</p></div></div><section className="panel knowledge-search"><div className="panel-heading"><div><h2>Explore your evidence</h2><p className="muted small">Find the exact source context the assistant can use.</p></div><Search size={19} /></div><form onSubmit={search} className="search-form"><label className="sr-only" htmlFor="knowledge-query">Search knowledge</label><Search size={18} aria-hidden="true" /><input id="knowledge-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your projects, skills, or contributions…" maxLength={1000} required /><Button type="submit" busy={searching} disabled={!query.trim()}>Search sources</Button></form>{searched && <div className="search-results"><p className="eyebrow">{evidence.length} SOURCE MATCH{evidence.length === 1 ? "" : "ES"}</p>{evidence.length ? <EvidenceList evidence={evidence} /> : <p className="muted">No matching evidence yet. Try a different phrase or wait for source processing to finish.</p>}</div>}</section>
{dialog === "project" && <Modal title="A new chapter of your work" onClose={() => { if (!busy) setDialog(null); }}><p className="muted">Keep related knowledge together for more relevant live answers.</p><form className="form-stack" onSubmit={submitProject}><label>Project name<input name="name" required maxLength={160} placeholder="e.g. Payment service redesign" autoFocus /></label><label>Description<textarea name="description" rows={3} maxLength={4000} placeholder="What did you build, and what was your role?" /></label>{error && <Alert>{error}</Alert>}<Button type="submit" busy={busy}>Create project <Plus size={16} /></Button></form></Modal>}
{dialog === "github" && <Modal title="Connect a public repository" onClose={() => { if (!busy) setDialog(null); }}><p className="muted">We extract repository context and compare it with your documents. Personal contributions require supporting evidence.</p><form className="form-stack" onSubmit={submitGithub}><label>Project<select name="project" defaultValue={project || projects[0]?.id} required>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>GitHub repository URL<input name="url" type="url" required placeholder="https://github.com/owner/repository" autoFocus /></label>{error && <Alert>{error}</Alert>}<Button type="submit" busy={busy}><Github size={17} /> Connect repository</Button></form></Modal>}
{deleting && <Modal title={`Delete ${deleting.type}?`} onClose={() => { if (!busy) setDeleting(null); }}><p>This permanently removes <strong>{deleting.name}</strong>{deleting.type === "project" ? " and its attached sources and extracted knowledge" : " and its extracted knowledge"} from your workspace.</p>{error && <Alert>{error}</Alert>}<div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep it</Button><Button variant="danger" busy={busy} onClick={() => { void remove(); }}>Delete {deleting.type}</Button></div></Modal>}</>;
}
