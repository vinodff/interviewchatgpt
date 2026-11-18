import { describe, expect, it } from "vitest";
import { glanceOf, sentencesOf } from "@/lib/glance";

const longProse = "Python is a high-level, interpreted programming language known for readable syntax. It is used for web development, data science, automation and scripting across many industries. Its huge standard library and package ecosystem mean you rarely start from scratch. For example, print(\"Hello\") is already a complete program that runs anywhere Python is installed.";

describe("glanceOf", () => {
  it("returns null for empty or already short answers so the full answer is shown", () => {
    expect(glanceOf("")).toBeNull();
    expect(glanceOf("   ")).toBeNull();
    expect(glanceOf("A list is an ordered, mutable collection in Python.")).toBeNull();
  });

  it("condenses long prose into at most three complete points without ellipsis", () => {
    const glance = glanceOf(longProse);
    expect(glance?.kind).toBe("points");
    if (glance?.kind !== "points") return;
    expect(glance.points).toEqual([
      "Python is a high-level, interpreted programming language known for readable syntax.",
      "It is used for web development, data science, automation and scripting across many industries.",
      "Its huge standard library and package ecosystem mean you rarely start from scratch.",
    ]);
    for (const point of glance.points) expect(point).not.toMatch(/…|\.\.\.$/);
  });

  it("keeps existing bullet points instead of re-splitting sentences", () => {
    const glance = glanceOf(`Here is how indexing works in databases and why it matters for performance in production systems:\n- **B-tree** indexes keep keys sorted for range scans\n- Hash indexes give constant-time equality lookups\n- Too many indexes slow down writes\n- Composite indexes follow the leftmost prefix rule`);
    expect(glance).toEqual({ kind: "points", points: ["B-tree indexes keep keys sorted for range scans", "Hash indexes give constant-time equality lookups", "Too many indexes slow down writes"] });
  });

  it("keeps a long bullet whole instead of cutting it with dots", () => {
    const glance = glanceOf([
      "Here is the approach for a reliable API that interviewers expect you to walk through carefully:",
      "- Start by finding whether the failure is latency, errors, or a downstream dependency that keeps timing out under load",
      "- Use timeouts, bounded retries, and idempotency where the same request may be sent more than once",
      "- Measure error rates and tail latency after the change so you can prove the fix actually helped",
    ].join("\n"));
    expect(glance?.kind).toBe("points");
    if (glance?.kind !== "points") return;
    expect(glance.points[0]).toBe("Start by finding whether the failure is latency, errors, or a downstream dependency that keeps timing out under load");
    expect(glance.points[0]).not.toMatch(/…|\.\.\./);
  });

  it("shows the code itself for code answers, with the first explanatory sentence", () => {
    const glance = glanceOf("```python\ndef reverse(xs):\n    return xs[::-1]\n```\nSlicing with a negative step copies the list in reverse. It runs in O(n) time.");
    expect(glance).toEqual({ kind: "code", code: "def reverse(xs):\n    return xs[::-1]", language: "python", note: "Slicing with a negative step copies the list in reverse." });
  });

  it("returns null when a long answer is a single run-on sentence it cannot split", () => {
    expect(glanceOf(`${"word ".repeat(60)}end`)).toBeNull();
  });
});

describe("sentencesOf", () => {
  it("does not split decimals or common abbreviations", () => {
    expect(sentencesOf("Version 3.5 is fast, e.g. for loops. It is popular.")).toEqual(["Version 3.5 is fast, e.g. for loops.", "It is popular."]);
  });
});
