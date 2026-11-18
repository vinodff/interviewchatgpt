"use strict";

// One screenshot of the display the InterviewWin window is on, for the toolbar's Analyze button.
// The window is made invisible for a moment so the answer card does not cover the question.
const { desktopCapturer, screen, systemPreferences } = require("electron");

const MAX_WIDTH = 1600;
// Stay under the server's limit for base64 screenshots (4,000,000 characters).
const MAX_BASE64 = 3_800_000;
const HIDE_MS = 140;
const QUALITIES = [78, 62, 48];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<{ image: string, mime: "image/jpeg" } | null>} null when capture is unavailable or denied */
async function captureScreen(win) {
  if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") === "denied") return null;
  const display = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const physicalWidth = Math.round(display.size.width * display.scaleFactor);
  const physicalHeight = Math.round(display.size.height * display.scaleFactor);
  const ratio = Math.min(1, MAX_WIDTH / physicalWidth);
  const thumbnailSize = { width: Math.round(physicalWidth * ratio), height: Math.round(physicalHeight * ratio) };
  const hide = win && !win.isDestroyed() && win.isVisible();
  const opacity = hide ? win.getOpacity() : 1;
  // Hide our window for a beat so Analyze reads the coding problem / error behind it, not the answer card.
  // Content protection already keeps InterviewWin out of screen shares; opacity covers capture from this process.
  if (hide) { win.setOpacity(0); await delay(HIDE_MS); }
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    for (const quality of QUALITIES) {
      const image = source.thumbnail.toJPEG(quality).toString("base64");
      if (image.length <= MAX_BASE64) return { image, mime: "image/jpeg" };
    }
    const smaller = source.thumbnail.resize({ width: Math.round(thumbnailSize.width / 2) }).toJPEG(60).toString("base64");
    return smaller.length <= MAX_BASE64 ? { image: smaller, mime: "image/jpeg" } : null;
  } finally {
    if (hide && !win.isDestroyed()) {
      win.setOpacity(opacity);
      // Re-assert after the opacity dance so a focus change cannot leave the window capturable.
      if (process.env.IW_ALLOW_CAPTURE !== "1") win.setContentProtection(true);
    }
  }
}

module.exports = { captureScreen };
