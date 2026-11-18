"use strict";

// The only surface the page gets from the desktop app: window control (including click-through),
// screen capture for Analyze, Google sign-in hand-off and shortcuts. No Node access reaches the page. The main process also
// checks that every call comes from InterviewWin's own pages before acting on it.
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("iwDesktop", {
  layout: (layout) => ipcRenderer.invoke("win:layout", layout),
  minimize: () => ipcRenderer.invoke("win:minimize"),
  close: () => ipcRenderer.invoke("win:close"),
  /** Resolves to { registered, unavailable } shortcut names while live, else null. */
  setLive: (on, options) => ipcRenderer.invoke("live:set", Boolean(on), { shortcuts: !(options && options.shortcuts === false) }),
  /** Resolves to whether clicks now pass through the window (only possible while live). */
  setClickThrough: (on) => ipcRenderer.invoke("win:click-through", Boolean(on)),
  onWindowState: (listener) => subscribe("window:state", listener),
  captureScreen: () => ipcRenderer.invoke("screen:capture"),
  openExternal: (url) => ipcRenderer.invoke("shell:open", String(url)),
  capabilities: () => ipcRenderer.invoke("app:capabilities"),
  retry: () => ipcRenderer.invoke("app:retry"),
  async signInWithGoogle() {
    const result = await ipcRenderer.invoke("auth:google");
    if (!result || !result.ok) throw new Error((result && result.message) || "Google sign-in couldn't start. Try again.");
  },
  /** Sign-in results. A session that finished before the page was listening is delivered on subscribe. */
  onAuth(listener) {
    const unsubscribe = subscribe("auth:event", (event) => {
      if (event && event.type === "session") ipcRenderer.invoke("auth:consumed").catch(() => {});
      listener(event);
    });
    ipcRenderer.invoke("auth:pending").then((event) => { if (event) listener(event); }).catch(() => {});
    return unsubscribe;
  },
  onShortcut: (listener) => subscribe("shortcut", listener),
});
