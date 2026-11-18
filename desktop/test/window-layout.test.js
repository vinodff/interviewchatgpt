"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fitBounds, sanitizeLayout, LIMITS } = require("../src/window-layout");

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

test("rejects malformed size reports from the page", () => {
  assert.equal(sanitizeLayout(null), null);
  assert.equal(sanitizeLayout({ mode: "fullscreen", width: 400, height: 300 }), null);
  assert.equal(sanitizeLayout({ mode: "card", width: "wide", height: 300 }), null);
  assert.equal(sanitizeLayout({ mode: "card", width: Infinity, height: 300 }), null);
});

test("clamps sizes so the page cannot make a huge or vanishing window", () => {
  assert.deepEqual(sanitizeLayout({ mode: "overlay", width: 99999, height: 1 }), { mode: "overlay", width: LIMITS.maxWidth, height: LIMITS.minHeight });
  assert.deepEqual(sanitizeLayout({ mode: "card", width: 484.4, height: 300.6 }), { mode: "card", width: 484, height: 301 });
});

test("centres the window at the top when switching between card and overlay", () => {
  const bounds = fitBounds({ mode: "overlay", width: 744, height: 500 }, { x: 50, y: 400, width: 484, height: 300 }, workArea, "card");
  assert.deepEqual(bounds, { x: 588, y: 16, width: 744, height: 500 });
});

test("switches views to the spot the user last put that view", () => {
  const bounds = fitBounds({ mode: "overlay", width: 744, height: 500 }, { x: 50, y: 400, width: 484, height: 300 }, workArea, "card", { x: 900, y: 500 });
  assert.deepEqual(bounds, { x: 900, y: 500, width: 744, height: 500 });
});

test("a remembered spot is still kept on screen", () => {
  const bounds = fitBounds({ mode: "overlay", width: 744, height: 500 }, { x: 0, y: 0, width: 1, height: 1 }, workArea, "card", { x: 1700, y: 900 });
  assert.deepEqual(bounds, { x: 1176, y: 540, width: 744, height: 500 });
});

test("ignores the remembered spot when only the size changes", () => {
  const bounds = fitBounds({ mode: "overlay", width: 800, height: 520 }, { x: 300, y: 200, width: 744, height: 500 }, workArea, "overlay", { x: 900, y: 500 });
  assert.deepEqual(bounds, { x: 300, y: 200, width: 800, height: 520 });
});

test("keeps the user's position when only the size changes", () => {
  const bounds = fitBounds({ mode: "overlay", width: 800, height: 520 }, { x: 300, y: 200, width: 744, height: 500 }, workArea, "overlay");
  assert.deepEqual(bounds, { x: 300, y: 200, width: 800, height: 520 });
});

test("pulls a grown window back on screen", () => {
  const bounds = fitBounds({ mode: "overlay", width: 900, height: 700 }, { x: 1500, y: 600, width: 600, height: 300 }, workArea, "overlay");
  assert.deepEqual(bounds, { x: 1020, y: 340, width: 900, height: 700 });
});

test("respects a work area that is offset (second monitor or a top taskbar)", () => {
  const bounds = fitBounds({ mode: "card", width: 484, height: 320 }, { x: 0, y: 0, width: 1, height: 1 }, { x: 1920, y: 40, width: 1280, height: 984 }, undefined);
  assert.deepEqual(bounds, { x: 2318, y: 56, width: 484, height: 320 });
});
