import { describe, expect, it } from "vitest";
import { AnsweredQuestions, hasExplicitRequest, requestTopicKey } from "@/lib/repeat-gate";

describe("requestTopicKey", () => {
  it("gives the same key to a question and the bare topic echoed back", () => {
    expect(requestTopicKey("what is Python")).toBe("python");
    expect(requestTopicKey("Python")).toBe("python");
    expect(requestTopicKey("What is Python?")).toBe("python");
    expect(requestTopicKey("okay so what is python")).toBe("python");
  });
  it("keeps genuinely different questions apart", () => {
    expect(requestTopicKey("what is Python used for")).not.toBe(requestTopicKey("what is Python"));
    expect(requestTopicKey("what is Java")).toBe("java");
  });
  it("returns null when nothing in the speech asks for anything", () => {
    expect(requestTopicKey("I built a payments service last year")).toBeNull();
    expect(requestTopicKey("")).toBeNull();
  });
});

describe("AnsweredQuestions", () => {
  it("treats a repeat of an answered or in-flight question as a repeat", () => {
    const answered = new AnsweredQuestions();
    answered.start(1, "what is Python");
    expect(answered.isRepeat("what is python")).toBe(true);
    answered.finish(1, "What is Python?", "Python is a language.");
    expect(answered.isRepeat("Python")).toBe(true);
    expect(answered.isRepeat("What is Python?")).toBe(true);
    expect(answered.cached("python")?.answer).toBe("Python is a language.");
  });
  it("lets new questions and follow-ups through", () => {
    const answered = new AnsweredQuestions();
    answered.start(1, "what is Python"); answered.finish(1, "What is Python?", "Python is a language.");
    expect(answered.isRepeat("what is Java")).toBe(false);
    expect(answered.isRepeat("what about its GIL")).toBe(false);
    expect(answered.isRepeat("I think Python is great")).toBe(false);
  });
  it("forgets a request that ended without an answer so it can be asked again", () => {
    const answered = new AnsweredQuestions();
    answered.start(1, "what is Python");
    answered.drop(1);
    expect(answered.isRepeat("what is Python")).toBe(false);
  });
  it("lists recent answered questions for the model and stays bounded", () => {
    const answered = new AnsweredQuestions();
    for (let i = 0; i < 30; i++) { answered.start(i, `what is topic${i}`); answered.finish(i, `What is topic${i}?`, `answer ${i}`); }
    expect(answered.recent()).toHaveLength(8);
    expect(answered.recent().at(-1)).toBe("What is topic29?");
    expect(answered.isRepeat("what is topic0")).toBe(false);
    expect(answered.isRepeat("what is topic29")).toBe(true);
  });
  it("clears everything on reset", () => {
    const answered = new AnsweredQuestions();
    answered.start(1, "what is Python"); answered.finish(1, "What is Python?", "x");
    answered.reset();
    expect(answered.isRepeat("Python")).toBe(false);
  });
});

describe("hasExplicitRequest", () => {
  it("finds requests even in first-person speech", () => {
    expect(hasExplicitRequest("I'd like you to explain polymorphism")).toBe(true);
    expect(hasExplicitRequest("Python")).toBe(true);
  });
  it("is false for plain narration", () => {
    expect(hasExplicitRequest("I built a REST API with my team")).toBe(false);
    expect(hasExplicitRequest("Python is a high level language that is easy to read")).toBe(false);
  });
});
