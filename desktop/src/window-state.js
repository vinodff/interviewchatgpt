"use strict";

// Remembers where the user put the setup card and the live overlay, so the next session (and the
// next launch) opens there instead of the top centre. Positions only: sizes come from the page.
// The pure parts are unit-tested in test/window-state.test.js.
const fs = require("node:fs");
const path = require("node:path");

const MODES = ["card", "overlay"];
const COORDINATE_LIMIT = 100000;
// The window's top strip (where it is dragged from) must land on a display, or the saved spot is stale.
const GRAB_STRIP = 24;

const isCoordinate = (value) => Number.isInteger(value) && Math.abs(value) <= COORDINATE_LIMIT;

function parsePoint(value) {
  if (!value || typeof value !== "object") return null;
  const x = Math.round(Number(value.x));
  const y = Math.round(Number(value.y));
  return isCoordinate(x) && isCoordinate(y) ? { x, y } : null;
}

/** Keep only well-formed positions from a stored state. */
function parseWindowState(text) {
  let raw = null;
  try { raw = JSON.parse(text); } catch { return {}; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const state = {};
  for (const mode of MODES) {
    const point = parsePoint(raw[mode]);
    if (point) state[mode] = point;
  }
  return state;
}

/** A copy of the state with one mode's position replaced. */
function withPosition(state, mode, point) {
  const parsed = MODES.includes(mode) ? parsePoint(point) : null;
  return parsed ? { ...state, [mode]: parsed } : state;
}

const contains = (area, x, y) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;

/**
 * Where to put a window of this size, given its saved top-left corner and today's displays.
 * Returns null when the saved spot is off every display (a monitor was unplugged): callers then centre it.
 * @returns {{ x: number, y: number, workArea: object } | null}
 */
function restorePosition(saved, size, workAreas) {
  const point = parsePoint(saved);
  if (!point || !size || !Array.isArray(workAreas)) return null;
  const grabX = point.x + Math.round(Math.min(size.width, 200) / 2);
  const grabY = point.y + Math.round(GRAB_STRIP / 2);
  const workArea = workAreas.find((area) => area && contains(area, grabX, grabY));
  return workArea ? { x: point.x, y: point.y, workArea } : null;
}

function loadWindowState(file) {
  try { return parseWindowState(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function saveWindowState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch { /* A convenience only: the window still opens at the top centre. */ }
}

module.exports = { parseWindowState, withPosition, restorePosition, loadWindowState, saveWindowState };
