import { describe, expect, it } from "vitest";
import {
  CAMERA_KEYS,
  PHASE_WINDOWS,
  STEPS,
  cameraAt,
  closeUpWeight,
  easeOutBack,
  framingScale,
  phasesAt,
  stepAt,
  windowProgress,
} from "@/components/interview-scene/timeline";

describe("interview scene timeline", () => {
  it("starts with everything hidden and ends with everything shown", () => {
    const start = phasesAt(0);
    const end = phasesAt(1);
    Object.values(start).forEach(value => expect(value).toBe(0));
    Object.values(end).forEach(value => expect(value).toBe(1));
  });

  it("keeps the story order: question, transcript, detection, then answer", () => {
    expect(PHASE_WINDOWS.ask[0]).toBeLessThanOrEqual(PHASE_WINDOWS.transcript[0]);
    expect(PHASE_WINDOWS.transcript[1]).toBeLessThanOrEqual(PHASE_WINDOWS.detect[0]);
    expect(PHASE_WINDOWS.detect[1]).toBeLessThanOrEqual(PHASE_WINDOWS.answer[0]);
    expect(PHASE_WINDOWS.answer[1]).toBeLessThanOrEqual(PHASE_WINDOWS.chips[0]);
  });

  it("shows no answer before the question is detected", () => {
    const beforeDetection = phasesAt(PHASE_WINDOWS.detect[0]);
    expect(beforeDetection.answer).toBe(0);
    expect(beforeDetection.transcript).toBe(1);
  });

  it("clamps window progress outside its range and handles empty windows", () => {
    expect(windowProgress(-1, [0.2, 0.4])).toBe(0);
    expect(windowProgress(0.3, [0.2, 0.4])).toBeCloseTo(0.5);
    expect(windowProgress(2, [0.2, 0.4])).toBe(1);
    expect(windowProgress(0.5, [0.5, 0.5])).toBe(1);
    expect(windowProgress(0.4, [0.5, 0.5])).toBe(0);
  });

  it("maps progress to the matching caption step", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(STEPS[2].at)).toBe(2);
    expect(stepAt(STEPS[2].at - 0.001)).toBe(1);
    expect(stepAt(1)).toBe(STEPS.length - 1);
  });

  it("lands the camera exactly on every key frame", () => {
    CAMERA_KEYS.forEach(key => {
      const { position, target } = cameraAt(key.at);
      position.forEach((value, axis) => expect(value).toBeCloseTo(key.position[axis]));
      target.forEach((value, axis) => expect(value).toBeCloseTo(key.target[axis]));
    });
  });

  it("clamps camera progress outside 0–1", () => {
    expect(cameraAt(-0.5)).toEqual(cameraAt(0));
    expect(cameraAt(1.5).position).toEqual(cameraAt(1).position);
  });

  it("overshoots then settles when the phone lands", () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(Math.max(...[0.6, 0.7, 0.8].map(easeOutBack))).toBeGreaterThan(1);
  });

  it("pulls the camera back only on narrow screens, within a limit", () => {
    expect(framingScale(16 / 9)).toBe(1);
    expect(framingScale(0.5)).toBeGreaterThan(1.5);
    expect(framingScale(0.05)).toBeLessThanOrEqual(2.6);
  });

  it("raises the close-up weight only around the phone shots", () => {
    expect(closeUpWeight(0.3)).toBe(0);
    expect(closeUpWeight(0.65)).toBe(1);
    expect(closeUpWeight(0.95)).toBe(0);
  });
});
