"use strict";

// Fits the transparent window around what the page draws: the setup card or the live overlay.
// Pure functions (no Electron) so they are unit-tested in test/window-layout.test.js.

const LIMITS = { minWidth: 280, maxWidth: 1400, minHeight: 60, maxHeight: 1200 };
const TOP_MARGIN = 16;
const MODES = new Set(["card", "overlay"]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Accept only a well-formed size report from the page. */
function sanitizeLayout(input) {
  if (!input || typeof input !== "object" || !MODES.has(input.mode)) return null;
  const width = Number(input.width);
  const height = Number(input.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { mode: input.mode, width: Math.round(clamp(width, LIMITS.minWidth, LIMITS.maxWidth)), height: Math.round(clamp(height, LIMITS.minHeight, LIMITS.maxHeight)) };
}

/**
 * New window bounds for a layout report.
 * Switching between card and overlay moves the window to where the user last put that view
 * (`preferred`), else to the top centre of the screen; otherwise the window keeps its top-left
 * corner (where the user dragged it). Either way it stays on screen.
 */
function fitBounds(layout, current, workArea, previousMode, preferred = null) {
  const width = Math.min(layout.width, workArea.width);
  const height = Math.min(layout.height, workArea.height);
  const recentre = layout.mode !== previousMode;
  const restore = recentre && preferred && Number.isFinite(preferred.x) && Number.isFinite(preferred.y);
  const x = restore ? preferred.x : recentre ? workArea.x + Math.round((workArea.width - width) / 2) : current.x;
  const y = restore ? preferred.y : recentre ? workArea.y + TOP_MARGIN : current.y;
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  };
}

module.exports = { sanitizeLayout, fitBounds, LIMITS };
