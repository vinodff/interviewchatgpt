"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PAGE_SHORTCUTS, WINDOW_SHORTCUTS, isWindowShortcut, registerShortcuts, sanitizeLiveOptions, shortcutsFor } = require("../src/shortcuts");

/** A stand-in for Electron's globalShortcut; `taken` accelerators belong to another app. */
function fakeGlobalShortcut(taken = []) {
  const handlers = new Map();
  return {
    handlers,
    register(accelerator, handler) { if (taken.includes(accelerator) || handlers.has(accelerator)) return false; handlers.set(accelerator, handler); return true; },
    isRegistered: (accelerator) => handlers.has(accelerator),
    unregister(accelerator) { handlers.delete(accelerator); },
  };
}

test("every shortcut has a unique name and accelerator", () => {
  const all = [...PAGE_SHORTCUTS, ...WINDOW_SHORTCUTS];
  assert.equal(new Set(all.map((s) => s.name)).size, all.length);
  assert.equal(new Set(all.map((s) => s.accelerator)).size, all.length);
});

test("never takes the keys meeting apps use mid-call (Teams: Ctrl+Shift+M mute, +A accept, +H hang up)", () => {
  const meetingKeys = ["M", "A", "H", "O", "E", "D", "S", "K", "Space"].map((key) => `CommandOrControl+Shift+${key}`);
  for (const shortcut of [...PAGE_SHORTCUTS, ...WINDOW_SHORTCUTS]) assert.ok(!meetingKeys.includes(shortcut.accelerator), shortcut.accelerator);
});

test("only Ctrl+G stays on when the user turned shortcuts off", () => {
  assert.deepEqual(shortcutsFor(false).map((s) => s.name), ["glance"]);
  assert.equal(shortcutsFor(true).length, PAGE_SHORTCUTS.length + WINDOW_SHORTCUTS.length);
});

test("registers the session's shortcuts and forwards presses by name", () => {
  const keys = fakeGlobalShortcut();
  const pressed = [];
  const session = registerShortcuts(keys, { extended: true, onShortcut: (name) => pressed.push(name) });
  assert.equal(session.registered.length, PAGE_SHORTCUTS.length + WINDOW_SHORTCUTS.length);
  assert.deepEqual(session.unavailable, []);
  keys.handlers.get("CommandOrControl+Alt+A")();
  keys.handlers.get("CommandOrControl+Alt+M")();
  assert.deepEqual(pressed, ["analyze", "click-through"]);
});

test("reports shortcuts another app owns instead of failing", () => {
  const keys = fakeGlobalShortcut(["CommandOrControl+Alt+A"]);
  const session = registerShortcuts(keys, { extended: true, onShortcut: () => {} });
  assert.deepEqual(session.unavailable, ["analyze"]);
  assert.ok(!session.registered.includes("analyze"));
});

test("treats a throwing register (malformed accelerator on some platforms) as unavailable", () => {
  const keys = { ...fakeGlobalShortcut(), register() { throw new Error("bad accelerator"); } };
  const session = registerShortcuts(keys, { extended: false, onShortcut: () => {} });
  assert.deepEqual(session.registered, []);
  assert.deepEqual(session.unavailable, ["glance"]);
});

test("release frees only the accelerators this session took, once", () => {
  const keys = fakeGlobalShortcut();
  keys.register("CommandOrControl+Shift+X", () => {}); // someone else's
  const session = registerShortcuts(keys, { extended: true, onShortcut: () => {} });
  session.release();
  session.release();
  assert.deepEqual([...keys.handlers.keys()], ["CommandOrControl+Shift+X"]);
});

test("window shortcuts are handled by the main process", () => {
  assert.ok(isWindowShortcut("click-through"));
  assert.ok(isWindowShortcut("toggle-window"));
  assert.ok(!isWindowShortcut("answer"));
});

test("live options default to shortcuts on and only an explicit false turns them off", () => {
  assert.deepEqual(sanitizeLiveOptions(undefined), { shortcuts: true });
  assert.deepEqual(sanitizeLiveOptions({ shortcuts: "no" }), { shortcuts: true });
  assert.deepEqual(sanitizeLiveOptions({ shortcuts: false }), { shortcuts: false });
});
