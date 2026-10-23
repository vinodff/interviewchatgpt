"use client";

import { useEffect, useState } from "react";
import { AudioLines, Check, Code2, FileText, MessageSquare, Play, RotateCcw, Sparkles } from "lucide-react";

const examples = [
  { label: "Behavioral", icon: MessageSquare, question: "Tell me about a project you’re proud of.", title: "Make your contribution the story.", points: ["We needed a clearer way to track customer requests.", "I built a shared dashboard and worked with support to refine the workflow.", "The key lesson: start with the people using the tool, then choose the technology."], source: "Customer dashboard · Project notes", followup: "What would you do differently?" },
  { label: "Technical", icon: Sparkles, question: "How would you make an API more reliable?", title: "Explain the decisions behind the system.", points: ["Start by finding the failure: latency, errors, or a downstream dependency.", "Use timeouts, bounded retries, and idempotency where requests may repeat.", "Measure error rates and tail latency to check that the change actually helps."], source: "API reliability · Sample project notes", followup: "How would you handle a failing dependency?" },
  { label: "Coding", icon: Code2, question: "How can you find duplicates in a list?", title: "Talk through the approach, then the code.", points: ["Use a set to remember the values you’ve already seen.", "If a value is already in the set, add it to the duplicates.", "Discuss the trade-off: linear time, with extra memory for the sets."], source: "Example explanation · Check against your requirements", followup: "What if extra memory is limited?" },
];

export function HomeDemo() {
  const [selected, setSelected] = useState(0);
  const [visible, setVisible] = useState(3);
  const [playing, setPlaying] = useState(false);
  const example = examples[selected];
  useEffect(() => {
    if (!playing) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => { setVisible(3); setPlaying(false); };
    if (preference.matches) { finish(); return; }
    const timer = window.setInterval(() => setVisible(value => {
      if (value >= 2) { window.clearInterval(timer); return 3; }
      return value + 1;
    }), 650);
    const end = window.setTimeout(finish, 2100);
    preference.addEventListener("change", finish);
    return () => { window.clearInterval(timer); window.clearTimeout(end); preference.removeEventListener("change", finish); };
  }, [playing]);
  return <div className="home-console" id="product-preview">
    <h2 className="sr-only">Explore a sample live interview</h2>
    <div className="home-console-bar"><span><AudioLines size={18} /> InterviewWin <span className="demo-divider">/</span> Live interview</span><span className="demo-label">INTERACTIVE PREVIEW</span></div>
    <div className="home-demo-tabs" role="group" aria-label="Choose a sample question">{examples.map(({ label, icon: Icon }, index) => <button key={label} aria-pressed={selected === index} onClick={() => { setPlaying(false); setVisible(3); setSelected(index); }}><Icon size={15} />{label}</button>)}</div>
    <div className="home-console-body">
      <aside className="demo-question"><span className="demo-overline">THE QUESTION</span><div className="demo-avatar"><MessageSquare size={21} /></div><h3>“{example.question}”</h3><div className="demo-wave" aria-hidden="true">{Array.from({ length: 25 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 17) % 31)}px` }} />)}</div><span className="demo-context"><FileText size={15} /> Example context attached</span><p>Follow-up to explore</p><div className="demo-followup">{example.followup}</div></aside>
      <div className="demo-response"><div className="demo-response-top"><span><Sparkles size={16} /> SUGGESTED TALKING POINTS</span><span><span className="home-dot" /> {playing ? "Playing example" : "Sample answer"}</span></div><h3>{example.title}</h3><ol>{example.points.map((point, index) => <li key={point} className={index < visible ? "demo-point" : "demo-point demo-pending"}><span>0{index + 1}</span><p>{index < visible ? point : "…"}</p></li>)}</ol><div className="demo-source"><FileText size={15} /><span>{example.source}</span><Check size={15} /></div></div>
    </div>
    <div className="home-console-bottom"><span>Sample content. No microphone or recording.</span><button onClick={() => { if (playing) { setPlaying(false); setVisible(3); } else { setVisible(0); setPlaying(true); } }}>{playing ? <Check size={15} /> : visible === 3 ? <RotateCcw size={15} /> : <Play size={15} />}{playing ? "Show full answer" : "Play example"}</button></div>
  </div>;
}
