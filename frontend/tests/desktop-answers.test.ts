import { describe, expect, it } from "vitest";
import { MAX_ANSWER_ENTRIES, reduceAnswerEntries, refinePrompt, sessionEndNotice, stepEntry, visibleEntryIndex, type AnswerEntry } from "@/lib/desktop-answers";
import type { LiveMessage } from "@/lib/protocol";

const run = (events: LiveMessage[], start: AnswerEntry[] = []) => events.reduce(reduceAnswerEntries, start);
const question = (id: string, text = `Question ${id}?`): LiveMessage => ({ type: "question", generation_id: id, question: text, keywords: [] });

describe("reduceAnswerEntries", () => {
  it("builds an entry from a question, streamed deltas and the final answer", () => {
    const entries = run([question("g1", "What is Python?"), { type: "answer_delta", generation_id: "g1", text: "Python is " }, { type: "answer_delta", generation_id: "g1", text: "a language." }]);
    expect(entries).toEqual([{ id: "g1", question: "What is Python?", answer: "Python is a language.", done: false }]);
    const final = run([{ type: "answer_complete", generation_id: "g1", answer: "Python is a high-level language.", evidence: [], keywords: [], latency_ms: 10 }], entries);
    expect(final[0]).toMatchObject({ answer: "Python is a high-level language.", done: true });
  });

  it("ignores deltas for unknown or finished answers", () => {
    const done = run([question("g1"), { type: "answer_complete", generation_id: "g1", answer: "Done.", evidence: [], keywords: [], latency_ms: 1 }]);
    expect(run([{ type: "answer_delta", generation_id: "g1", text: " extra" }, { type: "answer_delta", generation_id: "nope", text: "x" }], done)).toBe(done);
  });

  it("removes a cancelled answer and keeps the earlier ones", () => {
    const entries = run([question("g1"), { type: "answer_complete", generation_id: "g1", answer: "One.", evidence: [], keywords: [], latency_ms: 1 }, question("g2"), { type: "answer_delta", generation_id: "g2", text: "Half" }, { type: "answer_cancelled", generation_id: "g2" }]);
    expect(entries.map(entry => entry.id)).toEqual(["g1"]);
  });

  it("caps the history so a long interview cannot grow without bound", () => {
    const entries = run(Array.from({ length: MAX_ANSWER_ENTRIES + 5 }, (_, index) => question(`g${index}`)));
    expect(entries).toHaveLength(MAX_ANSWER_ENTRIES);
    expect(entries[0].id).toBe("g5");
  });
});

describe("visibleEntryIndex", () => {
  it("follows the latest answer until the user pages back", () => {
    expect(visibleEntryIndex(0, null)).toBe(-1);
    expect(visibleEntryIndex(3, null)).toBe(2);
    expect(visibleEntryIndex(3, 0)).toBe(0);
    expect(visibleEntryIndex(3, 9)).toBe(2);
  });
});

describe("stepEntry", () => {
  it("pages back from the latest, and returns to following at the newest", () => {
    expect(stepEntry(3, null, -1)).toBe(1);
    expect(stepEntry(3, 1, -1)).toBe(0);
    expect(stepEntry(3, 0, -1)).toBe(0);
    expect(stepEntry(3, 0, 1)).toBe(1);
    expect(stepEntry(3, 1, 1)).toBeNull();
    expect(stepEntry(3, null, 1)).toBeNull();
    expect(stepEntry(0, null, -1)).toBeNull();
  });
});

describe("refinePrompt", () => {
  it("names the question so the follow-up stands on its own", () => {
    expect(refinePrompt("shorter", "What is  Python?\n")).toContain('"What is Python?"');
    expect(refinePrompt("example", "")).toContain("the last question");
    expect(refinePrompt("detail", "q".repeat(5000)).length).toBeLessThan(800);
    expect(new Set(["shorter", "detail", "example"].map(kind => refinePrompt(kind as "shorter", "Q")))).toHaveProperty("size", 3);
  });
});

describe("sessionEndNotice", () => {
  it("summarises the session, or explains why it ended", () => {
    expect(sessionEndNotice("", { answers: 6, seconds: 18 * 60 + 20 })).toBe("Session ended · 18 min · 6 answers. Your answers are saved in Past Sessions.");
    expect(sessionEndNotice("", { answers: 1, seconds: 12 })).toBe("Session ended · under a minute · 1 answer. Your answers are saved in Past Sessions.");
    expect(sessionEndNotice("You have used all your live minutes.", { answers: 3, seconds: 600 })).toBe("Session ended: You have used all your live minutes.");
  });
});
