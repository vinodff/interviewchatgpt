/**
 * Typed access to the InterviewWin desktop app's preload bridge (window.iwDesktop).
 * In a normal browser there is no bridge; every call becomes a harmless no-op so /desktop still renders.
 */
export type DesktopMode = "card" | "overlay";
export type DesktopLayout = { mode: DesktopMode; width: number; height: number };
export type SystemAudioSupport = "loopback" | "picker" | "none";
export type DesktopCapabilities = { systemAudio: SystemAudioSupport; platform: string; version: string };
export type DesktopSession = { access_token: string; refresh_token: string };
export type DesktopAuthEvent = { type: "session"; session: DesktopSession } | { type: "error"; message: string };
/** Shortcuts the page acts on. The window ones (hide, click-through) are handled by the app itself. */
export const PAGE_SHORTCUT_NAMES = ["glance", "answer", "analyze", "scroll-up", "scroll-down", "previous", "next"] as const;
export type DesktopShortcut = typeof PAGE_SHORTCUT_NAMES[number];
export type ShortcutName = DesktopShortcut | "toggle-window" | "click-through";
/** Which global shortcuts the app registered for this session (others are taken by another app). */
export type ShortcutStatus = { registered: ShortcutName[]; unavailable: ShortcutName[] };
export type DesktopWindowState = { clickThrough: boolean };
export type ScreenCapture = { image: string; mime: "image/jpeg" | "image/png" };

type RawBridge = {
  layout(layout: DesktopLayout): Promise<unknown>;
  minimize(): Promise<unknown>;
  close(): Promise<unknown>;
  setLive(on: boolean, options?: { shortcuts: boolean }): Promise<unknown>;
  captureScreen(): Promise<unknown>;
  openExternal(url: string): Promise<unknown>;
  signInWithGoogle(): Promise<unknown>;
  capabilities(): Promise<unknown>;
  onAuth(listener: (event: unknown) => void): () => void;
  onShortcut(listener: (name: unknown) => void): () => void;
  // Added in desktop 1.2. Older installs lack them, so every use is guarded.
  setClickThrough?(on: boolean): Promise<unknown>;
  onWindowState?(listener: (state: unknown) => void): () => void;
};

export type DesktopBridge = {
  layout(layout: DesktopLayout): void;
  minimize(): void;
  close(): void;
  /** Resolves to the session's shortcut status; null outside the app or once the session ends. */
  setLive(on: boolean, options?: { shortcuts: boolean }): Promise<ShortcutStatus | null>;
  /** Resolves to whether clicks now pass through the window to the app behind it. */
  setClickThrough(on: boolean): Promise<boolean>;
  captureScreen(): Promise<ScreenCapture | null>;
  openExternal(url: string): void;
  signInWithGoogle(): Promise<void>;
  capabilities(): Promise<DesktopCapabilities>;
  onAuth(listener: (event: DesktopAuthEvent) => void): () => void;
  onShortcut(listener: (name: DesktopShortcut) => void): () => void;
  onWindowState(listener: (state: DesktopWindowState) => void): () => void;
};

const FALLBACK_CAPABILITIES: DesktopCapabilities = { systemAudio: "none", platform: "web", version: "" };

function raw(): RawBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { iwDesktop?: RawBridge }).iwDesktop;
  return candidate && typeof candidate.layout === "function" ? candidate : null;
}

export function isDesktopApp(): boolean { return raw() !== null; }

function parseAuth(value: unknown): DesktopAuthEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type === "error") return { type: "error", message: typeof event.message === "string" && event.message.length <= 300 ? event.message : "Sign-in did not complete. Try again." };
  if (event.type !== "session" || !event.session || typeof event.session !== "object") return null;
  const session = event.session as Record<string, unknown>;
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string" || !session.access_token || !session.refresh_token || session.access_token.length > 8192 || session.refresh_token.length > 1024) return null;
  return { type: "session", session: { access_token: session.access_token, refresh_token: session.refresh_token } };
}

function parseCapture(value: unknown): ScreenCapture | null {
  if (!value || typeof value !== "object") return null;
  const capture = value as Record<string, unknown>;
  if (typeof capture.image !== "string" || !capture.image || (capture.mime !== "image/jpeg" && capture.mime !== "image/png")) return null;
  return { image: capture.image, mime: capture.mime };
}

function parseCapabilities(value: unknown): DesktopCapabilities {
  if (!value || typeof value !== "object") return FALLBACK_CAPABILITIES;
  const caps = value as Record<string, unknown>;
  const systemAudio = caps.systemAudio === "loopback" || caps.systemAudio === "picker" ? caps.systemAudio : "none";
  return { systemAudio, platform: typeof caps.platform === "string" ? caps.platform : "unknown", version: typeof caps.version === "string" ? caps.version : "" };
}

const SHORTCUT_NAMES: readonly string[] = [...PAGE_SHORTCUT_NAMES, "toggle-window", "click-through"];
const shortcutNames = (value: unknown): ShortcutName[] => Array.isArray(value) ? value.filter((name): name is ShortcutName => typeof name === "string" && SHORTCUT_NAMES.includes(name)) : [];

/**
 * The app's shortcut report. Desktop 1.1 answers with nothing but registers Ctrl+G, so a missing
 * report while going live means "Glance only".
 */
export function parseShortcutStatus(value: unknown, on: boolean): ShortcutStatus | null {
  if (!on) return null;
  if (!value || typeof value !== "object") return { registered: ["glance"], unavailable: [] };
  const status = value as Record<string, unknown>;
  return { registered: shortcutNames(status.registered), unavailable: shortcutNames(status.unavailable) };
}

/** Never throws: a failed bridge call must not break the interview UI. */
const quietly = (call: () => Promise<unknown>) => { void call().catch(() => undefined); };

export function desktopBridge(): DesktopBridge {
  const bridge = raw();
  return {
    layout: layout => { if (bridge) quietly(() => bridge.layout(layout)); },
    minimize: () => { if (bridge) quietly(() => bridge.minimize()); },
    close: () => { if (bridge) quietly(() => bridge.close()); },
    setLive: async (on, options) => bridge ? parseShortcutStatus(await bridge.setLive(on, options).catch(() => undefined), on) : null,
    setClickThrough: async on => bridge && typeof bridge.setClickThrough === "function" ? (await bridge.setClickThrough(on).catch(() => false)) === true : false,
    captureScreen: async () => bridge ? parseCapture(await bridge.captureScreen().catch(() => null)) : null,
    openExternal: url => {
      if (bridge) quietly(() => bridge.openExternal(url));
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    signInWithGoogle: async () => { if (bridge) await bridge.signInWithGoogle(); },
    capabilities: async () => bridge ? parseCapabilities(await bridge.capabilities().catch(() => null)) : FALLBACK_CAPABILITIES,
    onAuth: listener => bridge ? bridge.onAuth(value => { const event = parseAuth(value); if (event) listener(event); }) : () => {},
    onShortcut: listener => bridge ? bridge.onShortcut(name => { if ((PAGE_SHORTCUT_NAMES as readonly unknown[]).includes(name)) listener(name as DesktopShortcut); }) : () => {},
    onWindowState: listener => bridge && typeof bridge.onWindowState === "function"
      ? bridge.onWindowState(value => { if (value && typeof value === "object") listener({ clickThrough: (value as Record<string, unknown>).clickThrough === true }); })
      : () => {},
  };
}
