"use client";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { formatAnswer } from "@/lib/answer-format";

/** **bold** and `code` only, rendered as React elements (never as HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

function Prose({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return <>{blocks.map((block, index) => {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    if (lines.length && lines.every(line => BULLET.test(line))) {
      const ordered = /^\s*\d/.test(lines[0]);
      const items = lines.map((line, item) => <li key={item}>{inline(line.replace(BULLET, ""))}</li>);
      return ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    return <p key={index}>{lines.map((line, item) => <Fragment key={item}>{item > 0 && <br />}{inline(line.replace(/^#{1,6}\s+/, ""))}</Fragment>)}</p>;
  })}</>;
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  }
  return <figure className="iwd-code">
    <figcaption><span>{language || "code"}</span><button type="button" onClick={() => { void copy(); }} aria-label="Copy code">{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button></figcaption>
    <pre><code>{code}</code></pre>
  </figure>;
}

export function AnswerText({ answer }: { answer: string }) {
  const segments = useMemo(() => formatAnswer(answer), [answer]);
  return <>{segments.map(segment => {
    const text = answer.slice(segment.start, segment.end);
    if (segment.kind === "fence") return null;
    if (segment.kind === "code") return <CodeBlock key={segment.start} code={text.replace(/\s+$/, "")} language={segment.language} />;
    return <Prose key={segment.start} text={text} />;
  })}</>;
}
