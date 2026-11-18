import { describe, expect, it } from "vitest";
import { answeredTurns, filterSessions, sessionFileName, sessionMarkdown, transcriptText } from "@/lib/desktop-export";
import type { Session } from "@/lib/types";

const session = (overrides: Partial<Session> = {}): Session => ({
  id: "s1", title: "Interview · Google · SWE", status: "ended", audio_mode: "microphone", retention: true,
  created_at: "2026-11-10T09:00:00Z", ended_at: null, summary: "", metrics: {}, ...overrides,
});

describe("sessionMarkdown", () => {
  it("writes the answered turns as numbered sections", () => {
    const markdown = sessionMarkdown(session({ turns: [
      { id: "t1", role: "interviewer", text: "what is a hash map", question: "What is a hash map?", answer: "Key-value storage.\n\n- O(1) lookups", created_at: "" },
      { id: "t2", role: "interviewer", text: "um okay", created_at: "" },
      { id: "t3", role: "interviewer", text: "Explain recursion", answer: "  A function calling itself.  ", created_at: "" },
    ] }), "10 Nov 2026");
    expect(markdown).toBe("# Interview · Google · SWE\n\n10 Nov 2026 · 2 answers\n\n## 1. What is a hash map?\n\nKey-value storage.\n\n- O(1) lookups\n\n## 2. Explain recursion\n\nA function calling itself.\n");
  });

  it("handles a session with no answers", () => {
    expect(sessionMarkdown(session({ title: " ", turns: undefined }), "today")).toBe("# InterviewWin session\n\ntoday · 0 answers\n");
    expect(answeredTurns(session({ turns: [] }))).toEqual([]);
  });
});

describe("sessionFileName", () => {
  it("is a safe, dated slug", () => {
    expect(sessionFileName(session())).toBe("interviewwin-interview-google-swe-2026-11-10.md");
    expect(sessionFileName(session({ title: "../../etc/passwd", created_at: "bad" }))).toBe("interviewwin-etc-passwd.md");
    expect(sessionFileName(session({ title: "x".repeat(200) })).length).toBeLessThan(90);
  });
});

describe("transcriptText", () => {
  it("keeps finished speech, one labelled line per turn", () => {
    expect(transcriptText([
      { id: "1", role: "interviewer", text: "Tell me about yourself.", final: true },
      { id: "2", role: "user", text: "Sure, I", final: false },
      { id: "3", role: "unknown", text: "  ", final: true },
      { id: "4", role: "user", text: "I build APIs.", final: true },
    ])).toBe("Interviewer: Tell me about yourself.\nYou: I build APIs.");
  });
});

describe("filterSessions", () => {
  const list = [session({ id: "a", title: "Interview · Google · SWE" }), session({ id: "b", title: "Meeting · Acme" }), session({ id: "c", title: "Interview · Amazon · SDE II" })];
  it("matches every word, ignoring case and order", () => {
    expect(filterSessions(list, "google").map(item => item.id)).toEqual(["a"]);
    expect(filterSessions(list, "sde interview").map(item => item.id)).toEqual(["c"]);
    expect(filterSessions(list, "  ").map(item => item.id)).toEqual(["a", "b", "c"]);
    expect(filterSessions(list, "netflix")).toEqual([]);
  });
});
