"use client";
import { Eye, Keyboard, Sparkles, Zap } from "lucide-react";
import { CUSTOM_INSTRUCTIONS_LIMIT, type DesktopSetup } from "@/lib/desktop-setup";
import { FieldLabel, StepFooter, ToggleRow } from "./desktop-ui";

type Props = { setup: DesktopSetup; onChange: (setup: DesktopSetup) => void; onBack: () => void; onNext: () => void };

export function DesktopSetupOptions({ setup, onChange, onBack, onNext }: Props) {
  const set = (patch: Partial<DesktopSetup>) => onChange({ ...setup, ...patch });
  return <div className="iwd-body">
    <p className="iwd-lead">How answers behave during your session. You can change Glance and Auto answer while you’re live.</p>
    <ToggleRow checked={setup.humanize} onChange={humanize => set({ humanize })} icon={<Sparkles size={15} />} label="Humanize" tip="Answers use plain, varied sentences instead of stiff, AI-sounding phrasing." />
    <ToggleRow checked={setup.glance} onChange={glance => set({ glance })} icon={<Eye size={15} />} label="Start in Glance mode" badge="BETA" tip="Shows a three-point summary of each answer. Short answers always show in full.">
      Press <kbd>Ctrl</kbd>+<kbd>G</kbd> during the session to switch Glance on or off.
    </ToggleRow>
    <ToggleRow checked={setup.autoAnswer} onChange={autoAnswer => set({ autoAnswer })} icon={<Zap size={15} />} label="Auto AI answer" badge="BETA" tip="On: questions are answered as soon as they’re heard. Off: questions wait until you press Answer." />
    <ToggleRow checked={setup.shortcuts} onChange={shortcuts => set({ shortcuts })} icon={<Keyboard size={15} />} label="Keyboard shortcuts" tip="Drive the overlay from any app without touching the mouse. Turn this off if the keys clash with your code editor.">
      <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Enter</kbd> answers, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> analyzes your screen, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> hides the window. The live menu lists them all.
    </ToggleRow>
    <div className="iwd-field">
      <FieldLabel htmlFor="iwd-instructions" tip="Style wishes for every answer, like length or format. Grounding and honesty rules still apply.">Custom instructions (optional)</FieldLabel>
      <textarea id="iwd-instructions" rows={3} maxLength={CUSTOM_INSTRUCTIONS_LIMIT} value={setup.customInstructions} placeholder="e.g. Write in points and be concise." onChange={event => set({ customInstructions: event.target.value.slice(0, CUSTOM_INSTRUCTIONS_LIMIT) })} />
      <span className="iwd-counter" aria-live="polite">{setup.customInstructions.length} / {CUSTOM_INSTRUCTIONS_LIMIT}</span>
    </div>
    <StepFooter onBack={onBack} primary={onNext} primaryLabel="Continue" />
  </div>;
}
