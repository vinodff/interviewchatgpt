"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { Briefcase, ChevronDown, Loader2, Phone, Plus } from "lucide-react";
import { api, messageOf } from "@/lib/api";
import { ROLES, searchCompanies } from "@/lib/companies";
import { ANSWER_LANGUAGES, looksLikeResume, type DesktopSetup } from "@/lib/desktop-setup";
import type { Source } from "@/lib/types";
import { FieldLabel, Notice, Segmented, StepFooter } from "./desktop-ui";

type Props = {
  setup: DesktopSetup;
  sources: Source[];
  onChange: (setup: DesktopSetup) => void;
  onSourceAdded: (source: Source) => void;
  onBack: () => void;
  onNext: () => void;
};

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";

function AddButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" className="iwd-icon-btn iwd-add" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{busy ? <Loader2 size={13} className="iwd-spin" /> : <Plus size={13} />}</button>;
}
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function DesktopSetupContext({ setup, sources, onChange, onSourceAdded, onBack, onNext }: Props) {
  const ready = sources.filter(source => source.status === "ready");
  const resumes = ready.filter(looksLikeResume);
  const resumeOptions = resumes.length ? resumes : ready;
  const docOptions = ready.filter(source => source.id !== setup.resumeId);
  const [uploading, setUploading] = useState<"resume" | "doc" | null>(null);
  const [uploadError, setUploadError] = useState("");
  const resumeInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<DesktopSetup>) => onChange({ ...setup, ...patch });

  async function upload(event: ChangeEvent<HTMLInputElement>, target: "resume" | "doc") {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) { setUploadError("That file is over 10 MB. Upload a smaller PDF, DOCX or text file."); return; }
    setUploading(target); setUploadError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const source = await api<Source>("/sources/upload", { method: "POST", body });
      onSourceAdded(source);
      if (target === "resume") set({ resumeId: source.id, docIds: setup.docIds.filter(id => id !== source.id) });
      else set({ docIds: [...new Set([...setup.docIds, source.id])].slice(0, 10) });
    } catch (error) { setUploadError(messageOf(error)); }
    finally { setUploading(null); }
  }

  const companySuggestions = searchCompanies(setup.company, 8);
  const roleSuggestions = ROLES.filter(role => role.toLowerCase().includes(setup.role.toLowerCase())).slice(0, 8);
  const docSummary = setup.docIds.length ? `${setup.docIds.length} document${setup.docIds.length === 1 ? "" : "s"} selected` : "No documents selected";

  return <div className="iwd-body">
    <FieldLabel tip="Interview answers sound like a candidate. Meeting answers suggest short replies you can say.">Session type</FieldLabel>
    <Segmented label="Session type" value={setup.sessionType} onChange={sessionType => set({ sessionType })} options={[{ value: "interview", label: "Interview", icon: <Briefcase size={14} aria-hidden="true" /> }, { value: "meeting", label: "Meeting", icon: <Phone size={14} aria-hidden="true" /> }]} />
    <p className="iwd-lead">{setup.sessionType === "interview" ? "Add the company and position, then pick a resume so answers draw on your own background and experience." : "Add who you’re meeting and your role, then pick any documents the meeting is about."}</p>

    <div className="iwd-grid">
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-company" tip="Answers mention the company only when a question is about it.">{setup.sessionType === "interview" ? "Company" : "Meeting with"}</FieldLabel>
        <input id="iwd-company" list="iwd-company-list" value={setup.company} maxLength={120} placeholder="e.g. Google" onChange={event => set({ company: event.target.value })} />
        <datalist id="iwd-company-list">{companySuggestions.map(company => <option key={company.name} value={company.name} />)}</datalist>
      </div>
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-role" tip="Your target role sets the vocabulary and depth of answers.">{setup.sessionType === "interview" ? "Position" : "Your role"}</FieldLabel>
        <input id="iwd-role" list="iwd-role-list" value={setup.role} maxLength={120} placeholder="e.g. Software Engineer" onChange={event => set({ role: event.target.value })} />
        <datalist id="iwd-role-list">{roleSuggestions.map(role => <option key={role} value={role} />)}</datalist>
      </div>
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-language" tip="The language answers are written in. Speech recognition listens for English.">Answer language</FieldLabel>
        <div className="iwd-select"><select id="iwd-language" value={setup.language} onChange={event => set({ language: event.target.value })}>{ANSWER_LANGUAGES.map(language => <option key={language}>{language}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></div>
      </div>
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-model" tip="Fast starts answering soonest. Smart thinks a little longer for tricky questions.">AI model</FieldLabel>
        <div className="iwd-select"><select id="iwd-model" value={setup.model} onChange={event => set({ model: event.target.value === "smart" ? "smart" : "fast" })}><option value="fast">Fast · quickest answers</option><option value="smart">Smart · deeper reasoning</option></select><ChevronDown size={14} aria-hidden="true" /></div>
      </div>
      <div className="iwd-field">
        <FieldLabel htmlFor="iwd-resume" tip="Answers about your experience use only this resume. Without one, answers stay technical." action={<AddButton label="Upload a resume" busy={uploading === "resume"} disabled={uploading !== null} onClick={() => resumeInput.current?.click()} />}>Select resume</FieldLabel>
        <div className="iwd-select"><select id="iwd-resume" value={setup.resumeId || ""} onChange={event => set({ resumeId: event.target.value || null, docIds: setup.docIds.filter(id => id !== event.target.value) })}>
          <option value="">No resume selected</option>
          {resumeOptions.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select><ChevronDown size={14} aria-hidden="true" /></div>
        <input ref={resumeInput} type="file" accept={ACCEPTED_FILES} className="iwd-hidden" onChange={event => { void upload(event, "resume"); }} />
      </div>
      <div className="iwd-field">
        <FieldLabel tip="Job descriptions, project notes or anything answers should draw on." action={<AddButton label="Upload a reference document" busy={uploading === "doc"} disabled={uploading !== null} onClick={() => docInput.current?.click()} />}>Reference docs</FieldLabel>
        <details className="iwd-multiselect">
          <summary><span>{docSummary}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="iwd-multiselect-list">
            {docOptions.length ? docOptions.map(source => <label key={source.id}><input type="checkbox" checked={setup.docIds.includes(source.id)} onChange={event => set({ docIds: event.target.checked ? [...setup.docIds, source.id].slice(0, 10) : setup.docIds.filter(id => id !== source.id) })} /><span>{source.name}</span></label>)
              : <p className="iwd-muted">No documents yet. Use + to upload one.</p>}
          </div>
        </details>
        <input ref={docInput} type="file" accept={ACCEPTED_FILES} className="iwd-hidden" onChange={event => { void upload(event, "doc"); }} />
      </div>
    </div>
    {uploadError && <Notice tone="error" onDismiss={() => setUploadError("")}>{uploadError}</Notice>}
    <StepFooter onBack={onBack} primary={onNext} primaryLabel={setup.resumeId || setup.docIds.length ? "Continue" : "Continue without resume"} disabled={uploading !== null} />
  </div>;
}
