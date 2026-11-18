"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadWindowState, parseWindowState, restorePosition, saveWindowState, withPosition } = require("../src/window-state");

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };
const overlay = { width: 744, height: 480 };

test("keeps only well-formed positions from storage", () => {
  assert.deepEqual(parseWindowState("{not json"), {});
  assert.deepEqual(parseWindowState("[1,2]"), {});
  assert.deepEqual(parseWindowState(JSON.stringify({ card: { x: 10, y: 20 }, overlay: { x: "a", y: 3 }, other: { x: 1, y: 1 } })), { card: { x: 10, y: 20 } });
  assert.deepEqual(parseWindowState(JSON.stringify({ overlay: { x: 1e9, y: 0 } })), {});
});

test("withPosition returns a new state and ignores unknown modes", () => {
  const state = { card: { x: 1, y: 2 } };
  const next = withPosition(state, "overlay", { x: 300.4, y: 40 });
  assert.deepEqual(next, { card: { x: 1, y: 2 }, overlay: { x: 300, y: 40 } });
  assert.deepEqual(state, { card: { x: 1, y: 2 } });
  assert.equal(withPosition(state, "fullscreen", { x: 1, y: 1 }), state);
});

test("restores a saved spot on the display it was on", () => {
  assert.deepEqual(restorePosition({ x: 2100, y: 60 }, overlay, [primary, second]), { x: 2100, y: 60, workArea: second });
  assert.deepEqual(restorePosition({ x: 400, y: 600 }, overlay, [primary, second]), { x: 400, y: 600, workArea: primary });
});

test("drops a spot whose display is gone, so the window is centred instead", () => {
  assert.equal(restorePosition({ x: 2100, y: 60 }, overlay, [primary]), null);
  assert.equal(restorePosition(undefined, overlay, [primary]), null);
  assert.equal(restorePosition({ x: 10, y: 10 }, overlay, null), null);
});

test("saves and loads through a file, surviving a missing folder", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iw-state-")), "nested", "window-state.json");
  assert.deepEqual(loadWindowState(file), {});
  saveWindowState(file, { overlay: { x: 5, y: 6 } });
  assert.deepEqual(loadWindowState(file), { overlay: { x: 5, y: 6 } });
});
