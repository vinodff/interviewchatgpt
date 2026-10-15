import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatAnswer, formattedAnswerWords } from "@/lib/answer-format";
import { AnswerReader } from "@/components/answer-reader";

describe("safe fenced answer formatting", () => {
  function preserved(answer: string) {
    const segments = formatAnswer(answer);
    expect(segments.map(segment => answer.slice(segment.start, segment.end)).join("")).toBe(answer);
    const words = formattedAnswerWords(answer, segments);
    for (const word of words) expect(answer.slice(word.start, word.end)).toBe(word.text);
    return { segments, words };
  }
  it("keeps natural paragraphs and talking points unchanged", () => {
    const answer = "I built a queue.\n\n- Durable retries\n- Clear ownership.";
    expect(preserved(answer).segments).toEqual([{ kind: "text", start: 0, end: answer.length }]);
  });
  it("preserves Python indentation while excluding fence labels from reading positions", () => {
    const answer = "Here is the code:\n```python\ndef solve(items):\n    for item in items:\n        print(item)\n```\nIt visits each item.";
    const { segments, words } = preserved(answer);
    const code = segments.find(segment => segment.kind === "code")!;
    expect(code.language).toBe("python");
    expect(answer.slice(code.start, code.end)).toContain("\n        print(item)\n");
    expect(words.some(word => word.text === "python")).toBe(false);
    expect(words.some(word => word.text === "print")).toBe(true);
  });
  it("handles incomplete streamed fences, CRLF, tildes, and multiple languages", () => {
    const answer = "~~~js\r\nconst a = 1;\r\n~~~\r\nNext:\n```python\ndef run():\n    return a";
    const { segments } = preserved(answer);
    expect(segments.filter(segment => segment.kind === "code").map(segment => segment.language)).toEqual(["js", "python"]);
  });
  it("treats inline backticks and mismatched closing fences as source text", () => {
    const answer = "Use `value` here.\n````python\nprint('```')\n```\n~~~~\n````\nDone.";
    const { segments } = preserved(answer);
    expect(segments.filter(segment => segment.kind === "code")).toHaveLength(1);
    expect(segments.filter(segment => segment.kind === "fence")).toHaveLength(2);
  });
  it("keeps untrusted markup as code text and bounds block parsing", () => {
    const answer = "```html\n<script>alert('x')</script>\n```";
    const { segments } = preserved(answer);
    expect(answer.slice(segments[1].start, segments[1].end)).toBe("<script>alert('x')</script>\n");
    const repeated = "```py\nx = 1\n```\n".repeat(60);
    expect(preserved(repeated).segments.filter(segment => segment.kind === "code")).toHaveLength(48);
    const long = "x".repeat(200_001);
    expect(preserved(long).segments).toEqual([{ kind: "text", start: 0, end: long.length }]);
    expect(formatAnswer("")).toEqual([]);
  });
  it("renders escaped code in one answer surface without changing its original text", () => {
    const answer = "A safe example:\n```python\nif ready:\n    print(\"<script>&'unsafe'</script>\")\n```\nThen continue.";
    const markup = renderToStaticMarkup(createElement(AnswerReader, { answer, generation: "fixture", active: false, visible: false, completion: null, speech: null, containerRef: { current: null } }));
    expect(markup.match(/class="answer-text"/g)).toHaveLength(1);
    expect(markup).toContain('<pre class="answer-code-block" data-language="python"><code>');
    expect(markup).not.toContain("<script>");
    expect(markup).toContain('class="answer-code-fence" aria-hidden="true"');
    const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
    const text = markup.replace(/<[^>]*>/g, "").replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => entities[entity]);
    expect(text).toBe(answer);
  });

  it("ensures synthesizeLocalAnswer produces clean natural answers without robotic section headers or question repeats", async () => {
    const { synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    const res = synthesizeLocalAnswer("What is a list?", { response_delivery: "natural", english_level: "simple" });

    // Must not contain robotic scaffolding labels
    expect(res.answer).not.toContain("**Definition:**");
    expect(res.answer).not.toContain("**Key Points:**");
    expect(res.answer).not.toContain("**Trade-offs:**");
    expect(res.answer).not.toContain("**Best Practice:**");
    expect(res.answer).not.toContain("Related Project Experience");
    expect(res.answer).not.toContain("Direct Evidence");

    // Must not echo the question at the start
    expect(res.answer.startsWith("What is a list")).toBe(false);
    expect(res.answer.startsWith("Here is how I address")).toBe(false);
    expect(res.answer.startsWith("When approaching")).toBe(false);

    // Must start directly with the concept explanation
    expect(res.answer).toMatch(/^[A-Z]/);
    expect(res.answer).toContain("list is an ordered");
  });
});
