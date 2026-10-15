import { describe, expect, it } from "vitest";
import { answerHeightFromDrag, answerHeightFromKey, answerHeightFromPointer, clampAnswerHeight, displayedAnswerHeight, readAnswerHeight } from "@/lib/mobile-live-layout";

describe("mobile live answer split", () => {
  it("starts at thirty percent and tolerates unavailable or corrupted device preferences", () => {
    for (const value of [null, "", "garbage", "Infinity"]) expect(readAnswerHeight(value)).toBe(30);
    expect(readAnswerHeight("46")).toBe(46);
  });
  it("clamps persisted and dragged heights so both panes remain reachable", () => {
    expect(readAnswerHeight("2")).toBe(15);
    expect(readAnswerHeight("95")).toBe(70);
    expect(clampAnswerHeight(30.7)).toBe(31);
    expect(answerHeightFromPointer(243.6, 0, 812)).toBe(30);
    expect(answerHeightFromPointer(863, 0, 863)).toBe(70);
    expect(answerHeightFromPointer(-10, 0, 812)).toBe(15);
    expect(answerHeightFromPointer(250, 100, 500)).toBe(30);
    expect(answerHeightFromPointer(250, 0, 0)).toBe(30);
  });
  it("offers arrow, page, and boundary keyboard controls without consuming other keys", () => {
    expect(answerHeightFromKey(30, "ArrowDown")).toBe(35);
    expect(answerHeightFromKey(30, "ArrowUp")).toBe(25);
    expect(answerHeightFromKey(67, "ArrowRight")).toBe(70);
    expect(answerHeightFromKey(17, "ArrowLeft")).toBe(15);
    expect(answerHeightFromKey(30, "PageDown")).toBe(40);
    expect(answerHeightFromKey(30, "PageUp")).toBe(20);
    expect(answerHeightFromKey(30, "Home")).toBe(15);
    expect(answerHeightFromKey(30, "End")).toBe(70);
    expect(answerHeightFromKey(30, "Tab")).toBeNull();
  });
  it("preserves the grab offset and leaves the split unchanged on a tap", () => {
    expect(answerHeightFromDrag(30, 266, 266, 812)).toBe(30);
    expect(answerHeightFromDrag(30, 266, 347.2, 812)).toBe(40);
    expect(answerHeightFromDrag(30, 266, 184.8, 812)).toBe(20);
    expect(answerHeightFromDrag(30, 266, 1000, 812)).toBe(70);
    expect(answerHeightFromDrag(45, 200, 300, 0)).toBe(45);
  });
  it("preserves full-size preferences while keeping controls visible above a mobile keyboard", () => {
    expect(displayedAnswerHeight(70, 812)).toBe(70);
    expect(displayedAnswerHeight(70, 863)).toBe(70);
    expect(displayedAnswerHeight(70, 340)).toBe(32);
    expect(displayedAnswerHeight(30, 340)).toBe(30);
    expect(340 * (1 - displayedAnswerHeight(70, 340) / 100)).toBeGreaterThanOrEqual(228);
    expect(displayedAnswerHeight(70, null)).toBe(70);
  });
});
