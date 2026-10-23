import { describe, expect, it } from "vitest";
import { speechTiming, isContextFollowUp } from "../lib/speech-timing";

describe("adaptive speech completion", () => {
  it("responds faster to clear final questions than ambiguous narration", () => {
    const question = speechTiming({ text: "What is a Python dictionary?", final: true, hasContext: false });
    const narration = speechTiming({ text: "I used Redis in my last project", final: true, hasContext: false });
    expect(question.delay_ms).toBeLessThanOrEqual(350);
    expect(question.delay_ms).toBeLessThan(narration.delay_ms);
  });
  it("holds incomplete constraints and prefixes until the tail arrives", () => {
    for (const text of ["what is", "tell me about", "implement a stack using", "can you explain the difference between"]) {
      const plan = speechTiming({ text, final: false, hasContext: true });
      expect(plan.kind).toBe("incomplete"); expect(plan.delay_ms).toBeGreaterThanOrEqual(1500); expect(plan.allow_interim).toBe(false);
    }
  });
  it("allows stable embedded questions after candidate speech", () => {
    const plan = speechTiming({ text: "I measure runtime as the input grows before production what is list", final: false, hasContext: true });
    expect(plan.allow_interim).toBe(true); expect(plan.delay_ms).toBeLessThanOrEqual(600);
  });
  it("does not wait for mobile finalization when a short technical prompt is stable", () => {
    for (const text of ["Abstract", "abstract class", "DBMS", "What is DBMS? abstract class", "what is DBMS abstract class"]) {
      expect(speechTiming({ text, final: false, hasContext: true })).toMatchObject({ allow_interim: true, delay_ms: 450 });
    }
    expect(speechTiming({ text: "An abstract class can define methods", final: false, hasContext: true }).allow_interim).toBe(false);
  });
  it.each(["database means?", "SQL means", "Python means", "Python", "Go"])("starts keyword request %s from stable interim speech", text => {
    expect(speechTiming({ text, final: false, hasContext: false })).toMatchObject({ allow_interim: true, delay_ms: 450 });
  });
  it("recognizes short contextual follow-ups without inventing context for an empty session", () => {
    for (const text of ["Now in JavaScript", "In Go", "In C++", "In C#", "Why?", "Without recursion", "What about its memory use?", "Explain that code", "Make it iterative"]) {
      expect(isContextFollowUp(text)).toBe(true);
      expect(speechTiming({ text, final: false, hasContext: true }).allow_interim).toBe(true);
    }
    expect(speechTiming({ text: "Now in JavaScript", final: false, hasContext: false }).allow_interim).toBe(false);
  });
  it("gives recent recognition corrections more time to stabilize", () => {
    const text = "What is a data structure";
    expect(speechTiming({ text, final: false, hasContext: false, corrections: 3 }).delay_ms).toBeGreaterThan(speechTiming({ text, final: false, hasContext: false }).delay_ms);
  });
});
