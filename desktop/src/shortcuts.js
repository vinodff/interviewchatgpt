"use strict";

// Global keyboard shortcuts while a session is live, so the overlay can be driven without the mouse:
// during screen sharing the interviewer sees your cursor, but not this window. They are registered
// only while live and released the moment the session ends, so they never block other apps otherwise.
// Pure (globalShortcut is passed in) so the registration logic is unit-tested in test/shortcuts.test.js.
// The accelerators mirror frontend/lib/desktop-shortcuts.ts, which labels them in the page.
// Everything new uses Ctrl+Alt: a global registration swallows the key in every app, and meeting
// apps own the Ctrl+Shift letters (Teams: Ctrl+Shift+M mute, +A accept call, +H hang up).

/** Handled by the page: the main process only forwards the name. */
const PAGE_SHORTCUTS = Object.freeze([
  { name: "glance", accelerator: "CommandOrControl+G" },
  { name: "answer", accelerator: "CommandOrControl+Alt+Enter" },
  { name: "analyze", accelerator: "CommandOrControl+Alt+A" },
  { name: "scroll-up", accelerator: "CommandOrControl+Alt+Up" },
  { name: "scroll-down", accelerator: "CommandOrControl+Alt+Down" },
  { name: "previous", accelerator: "CommandOrControl+Alt+Left" },
  { name: "next", accelerator: "CommandOrControl+Alt+Right" },
]);

/** Handled by the main process: they must work while the page can't be seen or clicked. */
const WINDOW_SHORTCUTS = Object.freeze([
  { name: "toggle-window", accelerator: "CommandOrControl+Alt+H" },
  { name: "click-through", accelerator: "CommandOrControl+Alt+M" },
]);

// Ctrl+G predates the opt-out setting, so it stays on even when the other shortcuts are off.
const ALWAYS_ON = new Set(["glance"]);
const WINDOW_NAMES = new Set(WINDOW_SHORTCUTS.map((shortcut) => shortcut.name));

const isWindowShortcut = (name) => WINDOW_NAMES.has(name);

/** The shortcuts for a session: all of them, or only the always-on ones when the user turned them off. */
function shortcutsFor(extended) {
  return [...PAGE_SHORTCUTS, ...WINDOW_SHORTCUTS].filter((shortcut) => extended || ALWAYS_ON.has(shortcut.name));
}

/**
 * Register a session's shortcuts. One taken by another app is reported, not fatal.
 * @returns {{ registered: string[], unavailable: string[], release: () => void }}
 */
function registerShortcuts(globalShortcut, { extended, onShortcut }) {
  const registered = [];
  const unavailable = [];
  const owned = [];
  for (const shortcut of shortcutsFor(extended)) {
    let ok = false;
    try { ok = globalShortcut.register(shortcut.accelerator, () => onShortcut(shortcut.name)) !== false; } catch { ok = false; }
    if (ok) { registered.push(shortcut.name); owned.push(shortcut.accelerator); } else unavailable.push(shortcut.name);
  }
  const release = () => {
    for (const accelerator of owned.splice(0)) {
      try { if (globalShortcut.isRegistered(accelerator)) globalShortcut.unregister(accelerator); } catch { /* already gone */ }
    }
  };
  return { registered, unavailable, release };
}

/** Accept only a well-formed options object from the page. */
function sanitizeLiveOptions(input) {
  return { shortcuts: !(input && typeof input === "object" && input.shortcuts === false) };
}

module.exports = { PAGE_SHORTCUTS, WINDOW_SHORTCUTS, isWindowShortcut, shortcutsFor, registerShortcuts, sanitizeLiveOptions };
