"use client";
import type { ReactNode } from "react";
import { ArrowLeft, AudioLines, Info, Loader2 } from "lucide-react";

/** The InterviewWin mark: the audio-lines glyph on the brand green. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return <span className="iwd-mark" style={{ width: size, height: size }} aria-hidden="true"><AudioLines size={Math.round(size * 0.6)} strokeWidth={2} /></span>;
}

/** A small ⓘ with a native tooltip and an accessible description. */
export function InfoTip({ text }: { text: string }) {
  return <span className="iwd-info" title={text} aria-label={text} role="img"><Info size={13} aria-hidden="true" /></span>;
}

export function FieldLabel({ children, tip, htmlFor, action }: { children: ReactNode; tip?: string; htmlFor?: string; action?: ReactNode }) {
  return <div className="iwd-label-row"><label htmlFor={htmlFor}>{children}</label>{tip && <InfoTip text={tip} />}{action}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (value: T) => void; label: string }) {
  return <div className="iwd-segmented" role="radiogroup" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? "is-on" : ""} onClick={() => onChange(option.value)}>{option.icon}{option.label}</button>)}
  </div>;
}

export function ToggleRow({ checked, onChange, icon, label, badge, tip, children }: { checked: boolean; onChange: (checked: boolean) => void; icon: ReactNode; label: string; badge?: string; tip?: string; children?: ReactNode }) {
  return <div className="iwd-toggle">
    <label>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="iwd-toggle-icon" aria-hidden="true">{icon}</span>
      <span className="iwd-toggle-label">{label}</span>
      {badge && <span className="iwd-badge">{badge}</span>}
    </label>
    {tip && <InfoTip text={tip} />}
    {children && <p className="iwd-toggle-help">{children}</p>}
  </div>;
}

export function StepFooter({ onBack, primary, primaryLabel, busy = false, disabled = false }: { onBack?: () => void; primary: () => void; primaryLabel: string; busy?: boolean; disabled?: boolean }) {
  return <div className="iwd-footer">
    {onBack && <button type="button" className="iwd-btn iwd-btn-ghost" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> Back</button>}
    <button type="button" className="iwd-btn iwd-btn-primary" onClick={primary} disabled={disabled || busy}>{busy && <Loader2 size={15} className="iwd-spin" aria-hidden="true" />}{primaryLabel}</button>
  </div>;
}

export function Notice({ tone = "info", children, onDismiss }: { tone?: "info" | "error" | "success"; children: ReactNode; onDismiss?: () => void }) {
  return <div className={`iwd-notice iwd-notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
    <span>{children}</span>
    {onDismiss && <button type="button" className="iwd-link" onClick={onDismiss}>Dismiss</button>}
  </div>;
}

/** "42 / 60 min" — what is left out of the plan's minutes. */
export function minutesLabel(minuteLimit: number | null, minutesUsed: number): string {
  if (minuteLimit === null) return "Unlimited";
  return `${Math.max(0, Math.floor(minuteLimit - minutesUsed))} / ${Math.round(minuteLimit)} min`;
}

export function minutesLeft(minuteLimit: number | null, minutesUsed: number): number | null {
  return minuteLimit === null ? null : Math.max(0, minuteLimit - minutesUsed);
}
