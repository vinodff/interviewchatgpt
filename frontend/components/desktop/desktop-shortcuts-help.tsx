"use client";
import { X } from "lucide-react";
import type { ShortcutStatus } from "@/lib/desktop-bridge";
import { SHORTCUTS, keyLabels, shortcutAvailability, type ShortcutAvailability } from "@/lib/desktop-shortcuts";

type Props = {
  status: ShortcutStatus | null;
  platform: string;
  /** Running inside the desktop app (global shortcuts), rather than a browser preview. */
  inApp: boolean;
  /** The user left Keyboard shortcuts on in Answer options. */
  requested: boolean;
  onClose: () => void;
};

const WINDOW_ONLY = new Set(["toggle-window", "click-through"]);
const STATE_LABELS: Record<ShortcutAvailability, string> = { on: "", taken: "Used by another app", off: "Off" };

function footnote({ status, inApp, requested }: Pick<Props, "status" | "inApp" | "requested">): string {
  if (!inApp) return "In this browser preview, shortcuts work while the page has focus. In the desktop app they work from any app.";
  if (!requested) return "Shortcuts are off for this session. Turn on Keyboard shortcuts in Answer options before your next session.";
  if (status && status.registered.length + status.unavailable.length <= 1) return "Update InterviewWin desktop to use these shortcuts.";
  if (status?.unavailable.length) return "Another app already uses some of these keys. Close it, or use the buttons instead.";
  return "These work from any app while your session is live, so you never need to move the mouse onto this window.";
}

/** The live session's keyboard shortcuts, and whether each one works right now. */
export function DesktopShortcutsHelp({ status, platform, inApp, requested, onClose }: Props) {
  return <section className="iwd-help" aria-label="Keyboard shortcuts">
    <header><strong>Keyboard shortcuts</strong><button type="button" className="iwd-dark-btn" aria-label="Close shortcuts" onClick={onClose}><X size={14} /></button></header>
    <ul>
      {SHORTCUTS.map(shortcut => {
        const appOnly = !inApp && WINDOW_ONLY.has(shortcut.name);
        const availability: ShortcutAvailability = inApp ? shortcutAvailability(shortcut.name, status) : appOnly ? "off" : "on";
        const note = appOnly ? "Desktop app only" : STATE_LABELS[availability];
        return <li key={shortcut.name} className={availability === "on" ? "" : "is-off"}>
          <span>{shortcut.label}{note && <small>{note}</small>}</span>
          <span className="iwd-keys">{keyLabels(shortcut.keys, platform).map((key, index) => <kbd key={index}>{key}</kbd>)}</span>
        </li>;
      })}
    </ul>
    <p>{footnote({ status, inApp, requested })}</p>
  </section>;
}
