import type { DesktopShortcut, ShortcutName, ShortcutStatus } from "./desktop-bridge";

/** One live-session shortcut. "Mod" is Ctrl on Windows and Linux, ⌘ on macOS. */
export type ShortcutInfo = { name: ShortcutName; keys: readonly string[]; label: string };
export type ShortcutAvailability = "on" | "taken" | "off";

/** What the help panel lists. The accelerators mirror desktop/src/shortcuts.js. */
export const SHORTCUTS: readonly ShortcutInfo[] = [
  { name: "answer", keys: ["Mod", "Alt", "Enter"], label: "Answer the latest question" },
  { name: "analyze", keys: ["Mod", "Alt", "A"], label: "Analyze the question on your screen" },
  { name: "glance", keys: ["Mod", "G"], label: "Switch Glance and full answer" },
  { name: "toggle-window", keys: ["Mod", "Alt", "H"], label: "Hide or show this window" },
  { name: "scroll-up", keys: ["Mod", "Alt", "↑"], label: "Scroll the answer up" },
  { name: "scroll-down", keys: ["Mod", "Alt", "↓"], label: "Scroll the answer down" },
  { name: "previous", keys: ["Mod", "Alt", "←"], label: "Previous answer" },
  { name: "next", keys: ["Mod", "Alt", "→"], label: "Next answer" },
  { name: "click-through", keys: ["Mod", "Alt", "M"], label: "Click-through: clicks reach the app behind" },
];

const MAC_KEYS: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Enter: "↩" };

/** Key caps for a platform: ["⌘", "⇧", "A"] on macOS, ["Ctrl", "Shift", "A"] elsewhere. */
export function keyLabels(keys: readonly string[], platform: string): string[] {
  return keys.map(key => platform === "darwin" ? MAC_KEYS[key] ?? key : key === "Mod" ? "Ctrl" : key);
}

/** "Ctrl+Alt+A", or "⌘⌥A" on macOS — for buttons' tooltips. */
export function shortcutLabel(name: ShortcutName, platform: string): string {
  const info = SHORTCUTS.find(shortcut => shortcut.name === name);
  if (!info) return "";
  const labels = keyLabels(info.keys, platform);
  return platform === "darwin" ? labels.join("") : labels.join("+");
}

/** Whether a shortcut works this session: registered, owned by another app, or switched off. */
export function shortcutAvailability(name: ShortcutName, status: ShortcutStatus | null): ShortcutAvailability {
  if (status?.registered.includes(name)) return "on";
  if (status?.unavailable.includes(name)) return "taken";
  return "off";
}

type KeyPress = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
const ALT_KEYS: Record<string, DesktopShortcut> = { Enter: "answer", a: "analyze", ArrowUp: "scroll-up", ArrowDown: "scroll-down", ArrowLeft: "previous", ArrowRight: "next" };

/**
 * The page shortcut a key press means. In the desktop app these are global shortcuts; this is the
 * fallback for the browser preview, where they work while the page has focus.
 */
export function shortcutFromKey(event: KeyPress): DesktopShortcut | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey) return null;
  if (event.altKey) return ALT_KEYS[key] ?? null;
  if (key === "g") return "glance";
  return null;
}
