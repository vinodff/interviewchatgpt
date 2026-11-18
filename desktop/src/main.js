"use strict";

// InterviewWin desktop: one frameless, transparent, always-on-top window that loads the site's
// /desktop page. The page draws the setup card and the live overlay; this process sizes the window
// around it, supplies system audio (Windows loopback), screenshots for Analyze, global shortcuts and
// click-through while live, a remembered window position, and Google sign-in through the system
// browser. The window is excluded from screenshots, screen recording and
// screen sharing (OS content protection) and has no taskbar or Alt+Tab entry; IW_ALLOW_CAPTURE=1
// makes it an ordinary window again, e.g. to record a demo.

const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, net, screen, session, shell, systemPreferences } = require("electron");
if (!app) {
  // Some tools (for example editor extension hosts) set ELECTRON_RUN_AS_NODE, which turns Electron into plain Node.
  console.error("InterviewWin must run inside Electron. Unset ELECTRON_RUN_AS_NODE and start it again.");
  process.exit(1);
}
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { APP_URL, DESKTOP_URL, SUPABASE_URL, SUPABASE_ANON_KEY } = require("./config");
const { createUrlPolicy, hostOf, safeExternalUrl } = require("./url-policy");
const { fitBounds, sanitizeLayout } = require("./window-layout");
const { captureScreen } = require("./screen-capture");
const { startExternalGoogleLogin } = require("./auth");
const { isWindowShortcut, registerShortcuts, sanitizeLiveOptions } = require("./shortcuts");
const { loadWindowState, restorePosition, saveWindowState, withPosition } = require("./window-state");

// In-window sign-in (the fallback when Google can't open in the browser) may only pass through
// this project's Supabase host and Google's account pages — not every *.google.com or *.supabase.co site.
const policy = createUrlPolicy(APP_URL, { authHosts: [hostOf(SUPABASE_URL), "accounts.google.com"] });
const ERROR_PAGE = path.join(__dirname, "error.html");
const ERROR_PAGE_PATH = pathToFileURL(ERROR_PAGE).pathname;
const isErrorPage = (url) => { try { const parsed = new URL(url); return parsed.protocol === "file:" && parsed.pathname === ERROR_PAGE_PATH; } catch { return false; } };
const CARD_SIZE = { mode: "card", width: 484, height: 340 };
const MAX_LOAD_RETRIES = 3;
const RETRY_DELAY_MS = 1500;
const PROBE_MS = { offline: 8000, outdated: 60000, crashed: 30000, incomplete: 30000 };
// The page reports its size as soon as its JavaScript starts. Without that, its scripts or styles failed
// to load: show a clear error card instead of unstyled text on a see-through window.
// The report often comes BEFORE the load event (which waits for third-party scripts such as analytics),
// so a report seen since the navigation committed counts; otherwise the card appeared on healthy loads.
const STARTUP_TIMEOUT_MS = 15000;
const RENDERER_RESTARTS_PER_MINUTE = 3;
const PENDING_AUTH_MS = 60000;
const LOGIN_DEBOUNCE_MS = 1500;
const SAVE_POSITION_DELAY_MS = 400;
const HIDE_FROM_CAPTURE = process.env.IW_ALLOW_CAPTURE !== "1";
const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "clipboard-sanitized-write", "fullscreen"]);
const debug = (...args) => { if (process.env.IW_DEBUG) console.log("[iw]", ...args); };

let win = null;
let layoutMode = null;
let retries = 0;
let probeTimer = null;
let pendingAuth = null; // { event, expires }
let lastLoginStart = 0;
let rendererRestarts = [];
let live = false;
let liveShortcuts = null; // { registered, unavailable, release } while a session is live
let clickThrough = false;
let windowState = {}; // where the user last put the card and the overlay
let windowStateFile = "";
let saveTimer = null;
let startupWatchdog = null;
let pageReported = false; // the page now in the window has reported its size at least once

function clearStartupWatchdog() { if (startupWatchdog) { clearTimeout(startupWatchdog); startupWatchdog = null; } }
function watchStartup() {
  clearStartupWatchdog();
  startupWatchdog = setTimeout(() => { startupWatchdog = null; showError("incomplete", "startup"); }, STARTUP_TIMEOUT_MS);
}

// A plain desktop Chrome user agent, so sign-in pages that load in-window (fallback mode) work.
function chromeUserAgent() {
  const chrome = process.versions.chrome || "140.0.0.0";
  const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : process.platform === "linux" ? "X11; Linux x86_64" : "Windows NT 10.0; Win64; x64";
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function systemAudioSupport() {
  if (process.platform === "win32") return "loopback";
  if (process.platform === "darwin") return Number(String(process.getSystemVersion()).split(".")[0]) >= 15 ? "picker" : "none";
  return "none";
}

const isDesktopPage = (url) => { try { return policy.isAppUrl(url) && new URL(url).pathname === "/desktop"; } catch { return false; } };

// ---------- Window ----------

function applyLayout(layout) {
  if (!win) return;
  // Switching views: go back to where the user last put this view, if that spot is still on a display.
  const restored = layout.mode !== layoutMode ? restorePosition(windowState[layout.mode], layout, screen.getAllDisplays().map((display) => display.workArea)) : null;
  const workArea = restored ? restored.workArea : screen.getDisplayMatching(win.getBounds()).workArea;
  const bounds = fitBounds(layout, win.getBounds(), workArea, layoutMode, restored);
  layoutMode = layout.mode;
  win.setBounds(bounds);
}

/** Remember where the user dragged the window (debounced; only the final spot of a drag is written). */
function rememberPosition() {
  if (!win || !layoutMode || !windowStateFile) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!win || win.isDestroyed()) return;
    const { x, y } = win.getBounds();
    windowState = withPosition(windowState, layoutMode, { x, y });
    saveWindowState(windowStateFile, windowState);
  }, SAVE_POSITION_DELAY_MS);
}

function stopProbe() { if (probeTimer) { clearInterval(probeTimer); probeTimer = null; } }

function loadApp() {
  if (!win) return;
  retries = 0;
  stopProbe();
  win.loadURL(DESKTOP_URL).catch(() => { /* did-fail-load handles recovery */ });
}

/** Show the offline/outdated card, then quietly check the site and come back on its own. */
function showError(kind, code) {
  if (!win) return;
  debug("error card", kind, code);
  clearStartupWatchdog();
  setLive(false);
  applyLayout(CARD_SIZE);
  win.loadFile(ERROR_PAGE, { query: { kind, code: String(code || "") } }).catch(() => {});
  if (!win.isVisible()) win.show();
  if (probeTimer) return;
  probeTimer = setInterval(() => {
    // Probe first, so the error card does not flicker while the site is still unreachable.
    net.fetch(DESKTOP_URL, { method: "GET", cache: "no-store" }).then((response) => { if (response.ok) loadApp(); }).catch(() => {});
  }, PROBE_MS[kind] || PROBE_MS.offline);
}

function openExternal(url) {
  const safe = safeExternalUrl(url);
  if (safe) shell.openExternal(safe).catch(() => {});
}

function wireNavigation(contents) {
  // No pop-up windows: links that open new windows go to the system browser.
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: "deny" }; });
  contents.on("will-navigate", (event) => {
    const url = event.url;
    if (SUPABASE_ANON_KEY && policy.isGoogleOAuthStart(url)) {
      event.preventDefault();
      void beginGoogleLogin().then((result) => { if (!result.ok) sendAuth({ type: "error", message: result.message }); });
      return;
    }
    if (policy.canNavigateInWindow(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  // Server redirects don't fire will-navigate: an open redirect must not carry the window to another site.
  contents.on("will-redirect", (event) => {
    if (!event.isMainFrame || policy.canNavigateInWindow(event.url)) return;
    event.preventDefault();
    openExternal(event.url);
  });
  // Embedded frames may only show our own or sign-in pages.
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame || policy.canNavigateInWindow(event.url) || /^about:(blank|srcdoc)$/.test(event.url)) return;
    event.preventDefault();
  });
}

function wireLoadRecovery(contents) {
  // A failed load still "finishes" (Chromium's own error page) and reports the failed app URL, so only a
  // navigation that got a real HTTP response counts as success. Otherwise retries never run out.
  let lastLoadFailed = false;
  contents.on("did-navigate", (_event, url, httpResponseCode) => {
    pageReported = false; // a new document has committed; none of its scripts has run yet
    // The page that was live is gone (reload, deploy-skew refresh) and can't end its session: release
    // its shortcuts and click-through here, so the new page never starts unclickable. Fires only on
    // commit, so a navigation that will-navigate cancels never ends a live session.
    setLive(false);
    if (httpResponseCode > 0) lastLoadFailed = false;
    if (isDesktopPage(url) && httpResponseCode >= 400) showError(httpResponseCode === 404 ? "outdated" : "offline", httpResponseCode);
  });
  contents.on("did-finish-load", () => {
    const url = contents.getURL();
    debug(lastLoadFailed ? "load failed" : "loaded", url);
    if (!lastLoadFailed && policy.isAppUrl(url)) { retries = 0; stopProbe(); if (isDesktopPage(url) && !pageReported) watchStartup(); }
  });
  contents.on("did-fail-load", (_event, errorCode, _description, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || String(validatedURL).startsWith("file:")) return; // -3: aborted by a redirect
    lastLoadFailed = true;
    if (retries < MAX_LOAD_RETRIES) {
      retries += 1;
      setTimeout(() => { if (win) win.loadURL(DESKTOP_URL).catch(() => {}); }, RETRY_DELAY_MS);
      return;
    }
    showError("offline", errorCode);
  });
  // Bounded restarts: a page that keeps crashing shows an error instead of reloading forever.
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const now = Date.now();
    rendererRestarts = rendererRestarts.filter((time) => now - time < 60000);
    setLive(false);
    if (rendererRestarts.length >= RENDERER_RESTARTS_PER_MINUTE) { showError("crashed", details.reason); return; }
    rendererRestarts.push(now);
    loadApp();
  });
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  // Open where the user last left the card, else at the top centre of the main screen.
  const restored = restorePosition(windowState.card, CARD_SIZE, screen.getAllDisplays().map((display) => display.workArea));
  const bounds = restored ? fitBounds(CARD_SIZE, restored, restored.workArea, CARD_SIZE.mode) : fitBounds(CARD_SIZE, { x: work.x, y: work.y }, work, null);
  win = new BrowserWindow({
    ...bounds,
    frame: false, transparent: true, hasShadow: false, backgroundColor: "#00000000",
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, show: false, title: "InterviewWin",
    // No taskbar button; on Windows a tool window is also left out of Alt+Tab and Task View.
    // Minimized, it comes back when InterviewWin is launched again (see "second-instance").
    skipTaskbar: HIDE_FROM_CAPTURE, ...(HIDE_FROM_CAPTURE && process.platform === "win32" ? { type: "toolbar" } : {}),
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      // Keep listening and answering while the window is behind another app or minimized.
      backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required", spellcheck: false,
    },
  });
  layoutMode = CARD_SIZE.mode;
  win.setAlwaysOnTop(true, "floating");
  // Set before the first show, so no frame is ever composited into a capture.
  // Windows 10 2004+: removed from capture entirely; older Windows: captured as a black box.
  win.setContentProtection(HIDE_FROM_CAPTURE);
  if (process.platform === "darwin") win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setUserAgent(chromeUserAgent());
  win.once("ready-to-show", () => { if (win) win.show(); });
  win.on("moved", rememberPosition);
  win.on("closed", () => { stopProbe(); clearStartupWatchdog(); setLive(false); win = null; });
  wireNavigation(win.webContents);
  wireLoadRecovery(win.webContents);
  if (process.env.IW_SMOKE_SHOT) smokeShot(process.env.IW_SMOKE_SHOT);
  loadApp();
}

// Development check: save what the window shows after it settles, then quit (IW_SMOKE_SHOT=out.png).
function smokeShot(file) {
  setTimeout(async () => {
    try { if (win) fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG()); }
    finally { app.quit(); }
  }, Number(process.env.IW_SMOKE_DELAY_MS) || 6000);
}

// ---------- Live session ----------

const shortcutStatus = () => liveShortcuts ? { registered: [...liveShortcuts.registered], unavailable: [...liveShortcuts.unavailable] } : null;

/**
 * Start or end the live-session extras: global shortcuts, and (when ending) click-through and a hidden window.
 * @returns the shortcut status the page shows in its help panel, or null when not live.
 */
function setLive(on, options = { shortcuts: true }) {
  if (on === live) return shortcutStatus();
  live = on;
  if (on) {
    liveShortcuts = registerShortcuts(globalShortcut, { extended: options.shortcuts, onShortcut: handleShortcut });
    debug("shortcuts", liveShortcuts.registered.join(", ") || "none", liveShortcuts.unavailable.length ? `(taken: ${liveShortcuts.unavailable.join(", ")})` : "");
    return shortcutStatus();
  }
  if (liveShortcuts) { liveShortcuts.release(); liveShortcuts = null; }
  // Never leave the window unclickable or hidden once the session is over.
  setClickThrough(false);
  if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
  return null;
}

function handleShortcut(name) {
  if (!win || win.isDestroyed()) return;
  if (!isWindowShortcut(name)) { win.webContents.send("shortcut", name); return; }
  if (name === "click-through") setClickThrough(!clickThrough);
  // showInactive: bring the overlay back without taking keyboard focus from the interview app.
  else if (name === "toggle-window") { if (win.isVisible()) win.hide(); else win.showInactive(); }
}

/**
 * Let clicks pass through the window to the app behind it. Only while live, and only when the
 * click-through shortcut is registered: otherwise there would be no way to click the window again.
 */
function setClickThrough(on) {
  const canExit = Boolean(liveShortcuts && liveShortcuts.registered.includes("click-through"));
  const next = on === true && live && canExit;
  if (next === clickThrough) return clickThrough;
  clickThrough = next;
  if (win && !win.isDestroyed()) {
    win.setIgnoreMouseEvents(next);
    win.webContents.send("window:state", { clickThrough: next });
  }
  return clickThrough;
}

// ---------- Sign-in hand-off ----------

function sendAuth(event) {
  if (win && !win.isDestroyed()) win.webContents.send("auth:event", event);
}

/** Give the browser's session to the page. If the page isn't ready, it collects it when it loads. */
function deliverSession(supabaseSession) {
  const event = { type: "session", session: { access_token: supabaseSession.access_token, refresh_token: supabaseSession.refresh_token } };
  pendingAuth = { event, expires: Date.now() + PENDING_AUTH_MS };
  if (!win) return;
  win.show(); win.focus();
  if (isDesktopPage(win.webContents.getURL()) && !win.webContents.isLoading()) sendAuth(event);
  else loadApp();
}

async function beginGoogleLogin() {
  const now = Date.now();
  if (now - lastLoginStart < LOGIN_DEBOUNCE_MS) return { ok: true };
  lastLoginStart = now;
  try {
    await startExternalGoogleLogin({ onSession: deliverSession, onError: (error) => sendAuth({ type: "error", message: error.message }) });
    return { ok: true };
  } catch (error) {
    lastLoginStart = 0;
    return { ok: false, message: error && error.message ? error.message : "Google sign-in couldn't start. Try again." };
  }
}

// ---------- IPC: only from InterviewWin's own top-level pages ----------

function topFrameUrl(event) {
  if (!win || event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return "";
  return event.senderFrame.url || "";
}
const fromApp = (event) => policy.isAppUrl(topFrameUrl(event));
const fromAppOrErrorPage = (event) => fromApp(event) || isErrorPage(topFrameUrl(event));
// System-wide hotkeys and click-through: only the /desktop page itself, not any page on the site.
const fromDesktopPage = (event) => isDesktopPage(topFrameUrl(event));

function registerIpc() {
  ipcMain.handle("win:layout", (event, input) => {
    if (!fromAppOrErrorPage(event)) { debug("layout rejected from", topFrameUrl(event) || "(not the top frame)"); return false; }
    const layout = sanitizeLayout(input);
    if (!layout) return false;
    if (fromApp(event)) { if (!pageReported) debug("page ready", layout.mode); pageReported = true; clearStartupWatchdog(); }
    applyLayout(layout);
    if (win && !win.isVisible()) win.show();
    return true;
  });
  ipcMain.handle("win:minimize", (event) => { if (fromAppOrErrorPage(event) && win) win.minimize(); });
  ipcMain.handle("win:close", (event) => { if (fromAppOrErrorPage(event) && win) win.close(); });
  ipcMain.handle("app:retry", (event) => { if (fromAppOrErrorPage(event)) loadApp(); });
  ipcMain.handle("shell:open", (event, url) => { if (fromAppOrErrorPage(event)) openExternal(String(url)); });
  ipcMain.handle("app:capabilities", (event) => fromAppOrErrorPage(event) ? { systemAudio: systemAudioSupport(), platform: process.platform, version: app.getVersion() } : null);
  ipcMain.handle("live:set", (event, on, options) => fromDesktopPage(event) ? setLive(on === true, sanitizeLiveOptions(options)) : null);
  ipcMain.handle("win:click-through", (event, on) => fromDesktopPage(event) ? setClickThrough(on === true) : false);
  ipcMain.handle("screen:capture", async (event) => fromApp(event) ? captureScreen(win).catch(() => null) : null);
  ipcMain.handle("auth:google", (event) => fromApp(event) ? beginGoogleLogin() : { ok: false, message: "Sign-in is only available in InterviewWin." });
  ipcMain.handle("auth:pending", (event) => {
    if (!fromApp(event) || !pendingAuth) return null;
    const { event: pending, expires } = pendingAuth;
    pendingAuth = null;
    return Date.now() <= expires ? pending : null;
  });
  // The page received the session over the live channel: drop the main process's copy now.
  ipcMain.handle("auth:consumed", (event) => { if (fromApp(event)) pendingAuth = null; });
}

// ---------- Permissions: microphone, system audio and clipboard for our pages only ----------

function configureSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && policy.isAppUrl((details && details.requestingUrl) || contents.getURL()));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => ALLOWED_PERMISSIONS.has(permission) && policy.isAppOrigin(requestingOrigin));
  // getDisplayMedia from our page: the screen this window is on, plus system audio on Windows.
  // The video track is required by the API; the page never shows, records or uploads it.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    if (!policy.isAppOrigin(request.securityOrigin)) { callback(null); return; }
    desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
      const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
      const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
      if (!source) { callback(null); return; }
      callback(request.audioRequested && process.platform === "win32" ? { video: source, audio: "loopback" } : { video: source });
    }, () => callback(null));
  }, { useSystemPicker: systemAudioSupport() === "picker" });
}

// ---------- App lifecycle ----------

if (!app.requestSingleInstanceLock()) {
  // A second launch focuses the running window instead of fighting over the sign-in port.
  app.quit();
} else {
  app.setAppUserModelId("live.interviewwin.desktop");
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });
  registerIpc();
  app.whenReady().then(() => {
    windowStateFile = path.join(app.getPath("userData"), "window-state.json");
    windowState = loadWindowState(windowStateFile);
    configureSession();
    if (process.platform === "darwin") systemPreferences.askForMediaAccess("microphone").catch(() => {});
    createWindow();
    app.on("activate", () => { if (!win) createWindow(); });
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
