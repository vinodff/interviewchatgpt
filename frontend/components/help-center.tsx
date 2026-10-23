"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { helpItems } from "@/lib/site-content";

const categories = ["All topics", "Getting started", "Audio & devices", "Privacy & access"] as const;

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All topics");
  const results = helpItems.filter(item => (category === "All topics" || item.category === category) && `${item.question} ${item.answer}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="help-center" data-reveal>
    <label className="help-search"><Search size={21} aria-hidden="true" /><span className="sr-only">Search help articles</span><input type="search" placeholder="Try “microphone” or “my data”…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="help-filters" role="group" aria-label="Filter help topics">{categories.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <p className="help-result-count" role="status">{results.length} {results.length === 1 ? "answer" : "answers"}{query.trim() ? ` for “${query.trim()}”` : " to help you get moving"}</p>
    <div className="help-results">{results.map(item => <details key={item.id} id={item.id}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>
    {!results.length && <div className="help-empty"><h2>No matching articles yet.</h2><p>Try a shorter search, browse all topics, or send us your question.</p><button type="button" className="button button-secondary" onClick={() => { setQuery(""); setCategory("All topics"); }}>Show all topics</button></div>}
    <div className="help-contact"><div><h2>Still need a hand?</h2><p>Tell us what happened. We’ll help you find the next step.</p></div><Link href="/contact" className="button button-secondary">Contact support <ArrowRight size={16} /></Link></div>
  </div>;
}
