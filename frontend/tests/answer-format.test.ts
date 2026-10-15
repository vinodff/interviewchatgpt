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

    // Human spoken voice: starts capitalized, first-person, real substance
    expect(res.answer).toMatch(/^[A-Z]/);
    expect(res.answer).toContain("ordered");
    expect(res.answer).toMatch(/\bI\b/);
    // Simple English explains Big-O in plain words
    expect(res.answer).toContain("instant no matter the size");
  });

  it("lets tone audibly reshape the same answer", async () => {
    const { synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    const professional = synthesizeLocalAnswer("What is a hashmap?", { response_delivery: "natural", answer_tone: "professional" }).answer;
    const casual = synthesizeLocalAnswer("What is a hashmap?", { response_delivery: "natural", answer_tone: "casual" }).answer;
    const friendly = synthesizeLocalAnswer("What is a hashmap?", { response_delivery: "natural", answer_tone: "friendly" }).answer;
    expect(professional).not.toBe(casual);
    expect(casual).toMatch(/^Honestly,/);
    expect(friendly).toMatch(/^Yeah, so /);
    expect(professional).toMatch(/^Sure/);
  });

  it("lets length and level reshape the same answer", async () => {
    const { synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    const concise = synthesizeLocalAnswer("Explain REST.", { response_delivery: "natural", answer_style: "concise" }).answer;
    const detailed = synthesizeLocalAnswer("Explain REST.", { response_delivery: "natural", answer_style: "detailed" }).answer;
    expect(detailed.split(/\s+/).length).toBeGreaterThan(concise.split(/\s+/).length + 20);
    const simple = synthesizeLocalAnswer("What is a list?", { response_delivery: "natural", english_level: "simple" }).answer;
    const everyday = synthesizeLocalAnswer("What is a list?", { response_delivery: "natural", english_level: "everyday" }).answer;
    expect(simple).toContain("instant no matter the size");
    expect(everyday).not.toContain("instant no matter the size");
    expect(everyday).toContain("O(1)");
  });

  it("weaves candidate sources only when personalization is grounded", async () => {
    const { synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    const evidence = [{ id: "e1", source_id: "s1", project_id: null, source_name: "Payments API", text: "Built a Redis-backed queue for payment retries", score: 1, locator: "cv:1", verified_contribution: true }];
    const grounded = synthesizeLocalAnswer("How do queues work?", { response_delivery: "natural", answer_style: "balanced", personalization: "grounded" }, evidence).answer;
    const technical = synthesizeLocalAnswer("How do queues work?", { response_delivery: "natural", answer_style: "balanced", personalization: "technical" }, evidence).answer;
    expect(grounded).toContain("Payments API");
    expect(technical).not.toContain("Payments API");
  });

  it("keeps talking_points and structured distinct from natural flow", async () => {
    const { synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    const natural = synthesizeLocalAnswer("What is a stack?", { response_delivery: "natural" }).answer;
    const points = synthesizeLocalAnswer("What is a stack?", { response_delivery: "talking_points" }).answer;
    const steps = synthesizeLocalAnswer("What is a stack?", { response_delivery: "structured" }).answer;
    expect(natural).not.toContain("•");
    expect(natural).not.toMatch(/^\d+\./m);
    expect(points).toContain("•");
    expect(steps).toMatch(/^1\. /m);
  });

  it("shifts directly to displaying exact code when interviewer asks to write code", async () => {
    const { isCodeQuestion, synthesizeLocalAnswer } = await import("@/lib/answer-generator");
    expect(isCodeQuestion("Write the code for binary search")).toBe(true);
    expect(isCodeQuestion("write code for a hash map")).toBe(true);
    expect(isCodeQuestion("can you code an algorithm to reverse a linked list?")).toBe(true);
    expect(isCodeQuestion("implement a stack in python")).toBe(true);
    expect(isCodeQuestion("show me the code for debounce")).toBe(true);
    expect(isCodeQuestion("What is a hashmap?")).toBe(false);

    const bsearch = synthesizeLocalAnswer("Write the code for binary search", { answer_tone: "friendly" }).answer;
    expect(bsearch).toContain("```python");
    expect(bsearch).toContain("def binary_search");
    expect(bsearch).toContain("while left <= right:");
    expect(bsearch).toMatch(/straightforward way to implement/i);

    const hashmap = synthesizeLocalAnswer("write the code for a hash map", { answer_tone: "professional" }).answer;
    expect(hashmap).toContain("```python");
    expect(hashmap).toContain("class SimpleHashMap");
    expect(hashmap).toContain("def put(");
  });
});
