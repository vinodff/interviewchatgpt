import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AudioLines, Check, ChevronDown, Clock3, ListChecks, ListOrdered, MessageSquare, Mic, Power, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useOwnedApi } from "@/lib/use-owned-api";
import { ROLES, searchCompanies } from "@/lib/companies";
import type { Preferences, User } from "@/lib/types";
import { Alert, Button } from "./ui";

export function completePreferences(preferences: Preferences = {}): Preferences {
  return { include_simple_example: true, role: "", company: "", language: "English", answer_style: "concise", job_description: "", answer_tone: "professional", grounding: "balanced", english_level: "everyday", reading_mode: "auto", reading_wpm: 130, response_delivery: "natural", personalization: "grounded", answer_text_size: 17, answer_font: "system", answer_theme: "default", ...preferences };
}

type ComboItem = { key: string; label: string; sub?: string };

function ComboField({ label, name, value, defaultValue, placeholder, getItems, onPick }: {
  label: string; name: string; value?: string; defaultValue?: string; placeholder: string;
  getItems: (query: string) => ComboItem[]; onPick?: (value: string) => void;
}) {
  const controlled = value !== undefined;
  const [query, setQuery] = useState(value ?? defaultValue ?? "");
  // Sync when the saved value round-trips back (e.g. after auto-save).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (controlled) setQuery(value ?? ""); }, [controlled, value]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(event: MouseEvent) { if (!box.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const items = getItems(query);
  function commit(next: string) {
    const trimmed = next.trim();
    if (!controlled) setQuery(next);
    else setQuery(next);
    onPick?.(trimmed);
    setOpen(false);
  }
  const listId = `${name}-suggestions`;
  return <div className="combo-field" ref={box}>
    <label>{label}<input
      name={name} role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && items.length ? `${listId}-${Math.min(highlight, items.length - 1)}` : undefined} aria-autocomplete="list" autoComplete="off"
      value={query} placeholder={placeholder} maxLength={80}
      onChange={event => { setQuery(event.target.value); setOpen(true); setHighlight(0); }}
      onFocus={() => setOpen(true)}
      onBlur={() => { if (controlled) onPick?.(query.trim()); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" && items.length) { event.preventDefault(); setHighlight(h => (h + 1) % items.length); }
        else if (event.key === "ArrowUp" && items.length) { event.preventDefault(); setHighlight(h => (h - 1 + items.length) % items.length); }
        else if (event.key === "Enter" && open && items.length) { event.preventDefault(); commit(items[highlight]?.label ?? query); }
        else if (event.key === "Escape") setOpen(false);
      }}
    /></label>
    {open && items.length > 0 && <ul className="combo-list" id={listId} role="listbox" aria-label={`${label} suggestions`}>
      {items.map((item, index) => <li key={item.key}>
        <button type="button" id={`${listId}-${index}`} role="option" aria-selected={index === highlight}
          className={`combo-option ${index === highlight ? "highlight" : ""}`}
          onMouseDown={event => event.preventDefault()} onClick={() => commit(item.label)}>
          <span>{item.label}</span>{item.sub && <small>{item.sub}</small>}
        </button>
      </li>)}
    </ul>}
  </div>;
}

export function CompanyField({ preferences, controlled = false, onChange }: { preferences: Preferences; controlled?: boolean; onChange?: (preferences: Preferences) => void }) {
  return <ComboField label="Target company" name="company"
    value={controlled ? preferences.company || "" : undefined} defaultValue={controlled ? undefined : preferences.company || ""}
    placeholder="Search: Amazon, Meta, TCS, Lumen…"
    getItems={query => searchCompanies(query).map(c => ({ key: c.name, label: c.name, sub: `${c.category} · ${c.focus.slice(0, 52)}…` }))}
    onPick={company => onChange?.({ ...preferences, company })} />;
}

export function RoleField({ preferences, controlled = false, onChange }: { preferences: Preferences; controlled?: boolean; onChange?: (preferences: Preferences) => void }) {
  return <ComboField label="Job role" name="role"
    value={controlled ? preferences.role || "" : undefined} defaultValue={controlled ? undefined : preferences.role || ""}
    placeholder="e.g. SDE II, Frontend Developer…"
    getItems={query => {
      const q = query.trim().toLowerCase();
      const matches = (q ? ROLES.filter(r => r.toLowerCase().includes(q)) : ROLES).slice(0, 8);
      const items = matches.map(r => ({ key: r, label: r }));
      if (q && !matches.some(r => r.toLowerCase() === q)) items.unshift({ key: `custom:${q}`, label: query.trim() });
      return items;
    }}
    onPick={role => onChange?.({ ...preferences, role })} />;
}

function ChipGroup({ name, label, value, options, onSelect }: { name: string; label: string; value: string; options: { value: string; label: string; icon: LucideIcon }[]; onSelect: (value: string) => void }) {
  return <fieldset className="preference-chips"><legend>{label}</legend><input type="hidden" name={name} value={value} /><div>{options.map(option => {
    const Icon = option.icon; const selected = value === option.value;
    return <button key={option.value} type="button" aria-pressed={selected} className={`preference-chip ${selected ? "selected" : ""}`} onClick={() => onSelect(option.value)}><Icon size={15} aria-hidden="true" />{option.label}{selected && <Check size={13} aria-hidden="true" />}</button>;
  })}</div></fieldset>;
}

export function AnswerPreferenceFields({ preferences, controlled = false, onChange }: { preferences: Preferences; controlled?: boolean; onChange?: (preferences: Preferences) => void }) {
  const [draftGrounding, setDraftGrounding] = useState(preferences.grounding || "balanced");
  const grounding = controlled ? preferences.grounding || "balanced" : draftGrounding;
  const [draftMode, setDraftMode] = useState(preferences.reading_mode || "auto");
  const mode = controlled ? preferences.reading_mode || "auto" : draftMode;
  const [draftFormat, setDraftFormat] = useState(preferences.response_delivery || "natural");
  const format = controlled ? preferences.response_delivery || "natural" : draftFormat;
  const [draftLength, setDraftLength] = useState(preferences.answer_style || "concise");
  const length = controlled ? preferences.answer_style || "concise" : draftLength;
  const recommended = format === "natural" && length === "concise" && mode === "auto";
  const textSize = preferences.answer_text_size ?? 17;
  const [sizeDraft, setSizeDraft] = useState({ base: textSize, value: textSize });
  const displayedTextSize = controlled || sizeDraft.base !== textSize ? textSize : sizeDraft.value;
  function value(key: "answer_tone" | "grounding" | "english_level" | "response_delivery" | "personalization" | "answer_style" | "reading_mode" | "answer_font" | "answer_theme", fallback: string) {
    return controlled ? { value: (preferences[key] as string) || fallback } : { defaultValue: (preferences[key] as string) || fallback };
  }
  return <div className="answer-preference-fields">
    <div className="preference-primary">
      {!controlled && <><CompanyField preferences={preferences} /><RoleField preferences={preferences} /></>}
      {!recommended && <button type="button" className="preference-preset" onClick={() => { setDraftFormat("natural"); setDraftLength("concise"); setDraftMode("auto"); onChange?.({ ...preferences, response_delivery: "natural", answer_style: "concise", reading_mode: "auto" }); }}><Sparkles size={15} aria-hidden="true" /> Use recommended: Natural · Short · Auto</button>}
      {recommended && <p className="preference-preset-note"><Sparkles size={15} aria-hidden="true" /> Recommended setup for interviews</p>}
      <ChipGroup name="response_delivery" label="Answer format" value={format} options={[{ value: "natural", label: "Natural", icon: MessageSquare }, { value: "talking_points", label: "Talking points", icon: ListChecks }, { value: "structured", label: "Step by step", icon: ListOrdered }]} onSelect={selected => { const next = selected as NonNullable<Preferences["response_delivery"]>; setDraftFormat(next); onChange?.({ ...preferences, response_delivery: next }); }} />
      <ChipGroup name="answer_style" label="Answer length" value={length} options={[{ value: "concise", label: "Short", icon: AlignLeft }, { value: "balanced", label: "Balanced", icon: AlignCenter }, { value: "detailed", label: "Detailed", icon: AlignJustify }]} onSelect={selected => { setDraftLength(selected); onChange?.({ ...preferences, answer_style: selected }); }} />
      <ChipGroup name="reading_mode" label="Hands-free scrolling" value={mode} options={[{ value: "auto", label: "Auto", icon: AudioLines }, { value: "speech", label: "Follow speech", icon: Mic }, { value: "paced", label: "Timed", icon: Clock3 }, { value: "off", label: "Off", icon: Power }]} onSelect={selected => { const next = selected as NonNullable<Preferences["reading_mode"]>; setDraftMode(next); onChange?.({ ...preferences, reading_mode: next }); }} />
    </div>
    <details className="preference-display"><summary>Reading options</summary>
      <label className="answer-size-control">Answer text size <output>{displayedTextSize}px</output><input aria-label="Answer text size" name="answer_text_size" type="range" min={14} max={24} step={1} value={controlled ? textSize : undefined} defaultValue={controlled ? undefined : textSize} onChange={event => { const next = Number(event.target.value); setSizeDraft({ base: textSize, value: next }); onChange?.({ ...preferences, answer_text_size: next }); }} /></label>
      <div className="preference-display-row">
        <label>Reading font<select name="answer_font" {...value("answer_font", "system")} onChange={event => onChange?.({ ...preferences, answer_font: event.target.value as Preferences["answer_font"] })}><option value="system">System · easy to read</option><option value="serif">Serif · calm</option><option value="readable">Readable · wide spacing</option></select></label>
        <label>Answer theme<select name="answer_theme" {...value("answer_theme", "default")} onChange={event => onChange?.({ ...preferences, answer_theme: event.target.value as Preferences["answer_theme"] })}><option value="default">Default</option><option value="easy">Easy-read · highlighted</option><option value="contrast">High contrast</option></select></label>
      </div>
      <p className="preference-help">{controlled ? "Changes save automatically." : "Save profile to apply changes."} Saved text size, font and theme apply on this device, including on mobile. Answer format and examples apply to the next question.</p>
    </details>
    <details className="preference-advanced">
      <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>More options<small>Tone, sources &amp; reading speed</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="preference-advanced-fields">
        {controlled && <><CompanyField preferences={preferences} controlled onChange={onChange} /><RoleField preferences={preferences} controlled onChange={onChange} /></>}
        <label>English level<select name="english_level" {...value("english_level", "everyday")} onChange={event => onChange?.({ ...preferences, english_level: event.target.value as Preferences["english_level"] })}><option value="simple">Simple English</option><option value="everyday">Everyday English</option><option value="advanced">Advanced English</option></select></label>
        <label>Simple example<select name="include_simple_example" {...(controlled ? { value: String(preferences.include_simple_example !== false) } : { defaultValue: String(preferences.include_simple_example !== false) })} onChange={event => onChange?.({ ...preferences, include_simple_example: event.target.value === "true" })}><option value="true">Include one relevant example</option><option value="false">Only when I ask</option></select></label>
        <label>Answer tone<select name="answer_tone" {...value("answer_tone", "professional")} onChange={event => onChange?.({ ...preferences, answer_tone: event.target.value as Preferences["answer_tone"] })}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="casual">Casual</option></select></label>
        <label>Personalization<select name="personalization" {...value("personalization", "grounded")} onChange={event => onChange?.({ ...preferences, personalization: event.target.value as Preferences["personalization"] })}><option value="grounded">Use my experience</option><option value="technical">Focus on the technical topic</option></select></label>
        <label>Answer sources<select name="grounding" {...value("grounding", "balanced")} onChange={event => { const selected = event.target.value as NonNullable<Preferences["grounding"]>; setDraftGrounding(selected); onChange?.({ ...preferences, grounding: selected }); }}><option value="balanced">My sources + technical knowledge</option><option value="strict">My uploaded sources only</option></select></label>
        <p className="preference-help">{grounding === "strict" ? "If your sources cannot support an answer, we’ll say so." : "Personal experience always stays grounded in your sources."}</p>
        <ReadingSpeedField preferences={preferences} controlled={controlled} onChange={onChange} />
        <p className="preference-help">{mode === "auto" ? "Follows your speech, then scrolls at your reading speed when you’re quiet." : mode === "speech" ? "Follows recognized speech. Pauses when you’re quiet." : mode === "paced" ? "Scrolls at your reading speed." : "Scrolling is off. Your reading speed is saved for later."} Position is estimated, without eye tracking.</p>
      </div>
    </details>
  </div>;
}

function ReadingSpeedField({ preferences, controlled, onChange }: { preferences: Preferences; controlled: boolean; onChange?: (preferences: Preferences) => void }) {
  const wpm = preferences.reading_wpm ?? 130;
  const [speedDraft, setSpeedDraft] = useState(() => ({ base: wpm, value: String(wpm) }));
  const speed = speedDraft.base === wpm ? speedDraft.value : String(wpm);
  const speedProps = controlled ? { value: speed } : { defaultValue: wpm };
  return <label>Reading speed<span className="preference-speed"><input name="reading_wpm" aria-label="Reading speed" type="number" min={60} max={240} step={1} required {...speedProps} onInvalid={event => { const details = event.currentTarget.closest("details"); if (details) details.open = true; }} onChange={event => { const next = event.target.valueAsNumber; setSpeedDraft({ base: wpm, value: event.target.value }); if (event.target.value !== "" && Number.isInteger(next) && next >= 60 && next <= 240) onChange?.({ ...preferences, reading_wpm: next }); }} /><span>words / min</span></span></label>;
}

export function LiveAnswerPreferences({ user, onUser }: { user: User; onUser: (user: User) => void }) {
  const api = useOwnedApi();
  const currentPreferences = completePreferences(user.preferences);
  const signature = JSON.stringify(currentPreferences);
  const [draft, setDraft] = useState(() => ({ signature, value: currentPreferences }));
  const preferences = draft.signature === signature ? draft.value : currentPreferences;
  const draftSignature = JSON.stringify(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [autoState, setAutoState] = useState<"idle" | "saving" | "applied">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(preferences);
  useEffect(() => {
    latest.current = preferences;
  }, [preferences]);
  function setPreferences(value: Preferences) {
    setDraft({ signature, value });
    setError("");
    setSaved(false);
    setAutoState("saving");

  }
  // Auto-apply: every dropdown/slider change persists immediately so the next
  // question uses it. No Save click required (fixes "selected parameters not applying").
  useEffect(() => {
    if (draftSignature === signature) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setBusy(true);
      try {
        const updated = await api<User>("/profile", { method: "PATCH", body: JSON.stringify({ preferences: latest.current }) });
        onUser(updated);
        setSaved(true); setAutoState("applied");
      } catch (error) {
        setError(messageOf(error)); setAutoState("idle");
      } finally {
        setBusy(false);
      }
    }, 300);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSignature]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draftSignature === signature) { setSaved(true); return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setBusy(true); setError(""); setSaved(false);
    try {
      const updated = await api<User>("/profile", { method: "PATCH", body: JSON.stringify({ preferences }) });
      onUser(updated); setSaved(true); setAutoState("applied");
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  const formatLabel = preferences.response_delivery === "natural" ? "Natural answer" : preferences.response_delivery === "talking_points" ? "Talking points" : "Step by step";
  return <form className="form-stack live-preference-form" onSubmit={save}>
    <fieldset disabled={busy} className="preference-fields">
      <AnswerPreferenceFields preferences={preferences} controlled onChange={value => { setPreferences(value); setSaved(false); }} />
    </fieldset>
    {error && <Alert>{error}</Alert>}
    {error && <Button type="submit" variant="secondary" busy={busy}>Retry saving <Check size={16} /></Button>}
    <p className="preference-help" role="status">{autoState === "saving" ? "Saving your preferences…" : saved || autoState === "applied" ? `Saved. The next question will use ${formatLabel}.` : "Changes save automatically."}</p>
  </form>;
}
