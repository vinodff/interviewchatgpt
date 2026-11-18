import { describe, expect, it } from "vitest";
import { PAGE_SHORTCUT_NAMES, parseShortcutStatus } from "@/lib/desktop-bridge";
import { SHORTCUTS, keyLabels, shortcutAvailability, shortcutFromKey, shortcutLabel } from "@/lib/desktop-shortcuts";

const press = (key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  ({ key, ctrlKey: Boolean(mods.ctrl), metaKey: Boolean(mods.meta), shiftKey: Boolean(mods.shift), altKey: Boolean(mods.alt) });

describe("shortcut catalog", () => {
  it("lists every page shortcut plus hide and click-through, once each", () => {
    const names = SHORTCUTS.map(shortcut => shortcut.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining([...PAGE_SHORTCUT_NAMES, "toggle-window", "click-through"]));
  });

  it("labels keys for Windows and macOS", () => {
    expect(shortcutLabel("analyze", "win32")).toBe("Ctrl+Alt+A");
    expect(shortcutLabel("analyze", "darwin")).toBe("⌘⌥A");
    expect(keyLabels(["Mod", "Alt", "↓"], "darwin")).toEqual(["⌘", "⌥", "↓"]);
    expect(keyLabels(["Mod", "Shift", "Enter"], "web")).toEqual(["Ctrl", "Shift", "Enter"]);
    expect(keyLabels(["Mod", "Shift", "Enter"], "darwin")).toEqual(["⌘", "⇧", "↩"]);
  });
});

describe("shortcutFromKey (browser preview)", () => {
  it("maps the same keys as the desktop app", () => {
    expect(shortcutFromKey(press("g", { ctrl: true }))).toBe("glance");
    expect(shortcutFromKey(press("Enter", { ctrl: true, alt: true }))).toBe("answer");
    expect(shortcutFromKey(press("A", { meta: true, alt: true }))).toBe("analyze");
    expect(shortcutFromKey(press("ArrowDown", { ctrl: true, alt: true }))).toBe("scroll-down");
    expect(shortcutFromKey(press("ArrowLeft", { ctrl: true, alt: true }))).toBe("previous");
  });

  it("ignores ordinary typing and near-miss combinations", () => {
    expect(shortcutFromKey(press("g"))).toBeNull();
    expect(shortcutFromKey(press("Enter", { ctrl: true }))).toBeNull();
    expect(shortcutFromKey(press("ArrowLeft", { ctrl: true, shift: true }))).toBeNull();
    expect(shortcutFromKey(press("A", { ctrl: true, shift: true }))).toBeNull();
    expect(shortcutFromKey(press("ArrowUp", { ctrl: true, alt: true, shift: true }))).toBeNull();
    expect(shortcutFromKey(press("g", { ctrl: true, alt: true }))).toBeNull();
  });
});

describe("shortcut status from the app", () => {
  it("keeps only known names", () => {
    expect(parseShortcutStatus({ registered: ["answer", "rm -rf", 3], unavailable: ["analyze"] }, true)).toEqual({ registered: ["answer"], unavailable: ["analyze"] });
  });

  it("treats a desktop 1.1 app (no report) as Glance only, and ending as no status", () => {
    expect(parseShortcutStatus(undefined, true)).toEqual({ registered: ["glance"], unavailable: [] });
    expect(parseShortcutStatus({ registered: ["answer"] }, false)).toBeNull();
  });

  it("says whether each shortcut works this session", () => {
    const status = { registered: ["answer" as const], unavailable: ["analyze" as const] };
    expect(shortcutAvailability("answer", status)).toBe("on");
    expect(shortcutAvailability("analyze", status)).toBe("taken");
    expect(shortcutAvailability("next", status)).toBe("off");
    expect(shortcutAvailability("answer", null)).toBe("off");
  });
});
