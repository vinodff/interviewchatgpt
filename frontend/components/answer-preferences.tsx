import { useState, type FormEvent } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { messageOf } from "@/lib/api";
import { useOwnedApi } from "@/lib/use-owned-api";
import type { Preferences, User } from "@/lib/types";
import { Alert, Button } from "./ui";

function completePreferences(preferences: Preferences = {}): Preferences {
  return { role: "", language: "English", answer_style: "concise", job_description: "", answer_tone: "professional", grounding: "balanced", english_level: "everyday", reading_mode: "auto", reading_wpm: 130, response_delivery: "natural", personalization: "grounded", ...preferences };
}

export function AnswerPreferenceFields({ preferences, controlled = false, onChange }: { preferences: Preferences; controlled?: boolean; onChange?: (preferences: Preferences) => void }) {
  const [draftGrounding, setDraftGrounding] = useState(preferences.grounding || "balanced");
  const grounding = controlled ? preferences.grounding || "balanced" : draftGrounding;
  const [draftMode, setDraftMode] = useState(preferences.reading_mode || "auto");
  const mode = controlled ? preferences.reading_mode || "auto" : draftMode;
  function value(key: "answer_tone" | "grounding" | "english_level" | "response_delivery" | "personalization" | "answer_style" | "reading_mode", fallback: string) {
    return controlled ? { value: preferences[key] || fallback } : { defaultValue: preferences[key] || fallback };
  }
  return <div className="answer-preference-fields">
    <div className="preference-primary">
      <label>Answer format<select name="response_delivery" {...value("response_delivery", "natural")} onChange={event => onChange?.({ ...preferences, response_delivery: event.target.value as Preferences["response_delivery"] })}><option value="natural">Natural answer</option><option value="talking_points">Talking points</option><option value="structured">Step by step</option></select></label>
      <label>English level<select name="english_level" {...value("english_level", "everyday")} onChange={event => onChange?.({ ...preferences, english_level: event.target.value as Preferences["english_level"] })}><option value="simple">Simple English</option><option value="everyday">Everyday English</option><option value="advanced">Advanced English</option></select></label>
      <label>Answer length<select name="answer_style" {...value("answer_style", "concise")} onChange={event => onChange?.({ ...preferences, answer_style: event.target.value })}><option value="concise">Short</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
      <label>Hands-free scrolling<select name="reading_mode" {...value("reading_mode", "auto")} onChange={event => { const selected = event.target.value as NonNullable<Preferences["reading_mode"]>; setDraftMode(selected); onChange?.({ ...preferences, reading_mode: selected }); }}><option value="auto">Auto · speech + timed</option><option value="speech">Follow my speech</option><option value="paced">Timed scrolling</option><option value="off">Off</option></select></label>
    </div>
    <details className="preference-advanced">
      <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>More options<small>Tone, sources &amp; reading speed</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="preference-advanced-fields">
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
  return <label>Reading speed<span className="preference-speed"><input name="reading_wpm" aria-label="Reading speed" type="number" min={60} max={240} step={1} required {...speedProps} onInvalid={event => { const details = event.currentTarget.closest("details"); if (details) details.open = true; }} onChange={event => { setSpeedDraft({ base: wpm, value: event.target.value }); if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) onChange?.({ ...preferences, reading_wpm: event.target.valueAsNumber }); }} /><span>words / min</span></span></label>;
}

export function LiveAnswerPreferences({ user, onUser }: { user: User; onUser: (user: User) => void }) {
  const api = useOwnedApi();
  const currentPreferences = completePreferences(user.preferences);
  const signature = JSON.stringify(currentPreferences);
  const [draft, setDraft] = useState(() => ({ signature, value: currentPreferences }));
  const preferences = draft.signature === signature ? draft.value : currentPreferences;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  function setPreferences(value: Preferences) { setDraft({ signature, value }); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      const updated = await api<User>("/profile", { method: "PATCH", body: JSON.stringify({ preferences }) });
      onUser(updated); setSaved(true);
    } catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <form className="form-stack live-preference-form" onSubmit={save}>
    <fieldset disabled={busy} className="preference-fields">
      <AnswerPreferenceFields preferences={preferences} controlled onChange={value => { setPreferences(value); setSaved(false); }} />
    </fieldset>
    {error && <Alert>{error}</Alert>}
    <Button type="submit" variant="secondary" busy={busy}>Save answer preferences <Check size={16} /></Button>
    <p className="preference-help" role="status">{saved ? "Saved. Answers update next question; scrolling updates now." : "Answers update next question. Scrolling updates when saved."}</p>
  </form>;
}
