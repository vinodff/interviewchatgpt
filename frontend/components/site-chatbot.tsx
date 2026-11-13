"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────
interface Msg { role: "user" | "model"; text: string; id: number }

let msgId = 0;
const uid = () => ++msgId;

// ─── Suggested quick questions ──────────────────────────────────────────────
const SUGGESTIONS = [
  "What is InterviewWin?",
  "How much does it cost?",
  "How do I pay?",
  "Does it work on mobile?",
  "Is my data private?",
];

// ─── Markdown-lite renderer (bold, bullets, links) ──────────────────────────
function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let key = 0;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) { out.push(<br key={key++} />); continue; }

    // Bullet
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) {
      out.push(
        <div key={key++} style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          <span style={{ color: "var(--teal)", flexShrink: 0, marginTop: 1 }}>•</span>
          <span dangerouslySetInnerHTML={{ __html: inlineFormat(bullet[1]) }} />
        </div>
      );
      continue;
    }

    out.push(<p key={key++} style={{ margin: "2px 0" }} dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />);
  }
  return out;
}

function inlineFormat(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code style='background:#f0f4e9;padding:1px 4px;border-radius:3px;font-size:11px'>$1</code>");
}

// ─── Bubble ──────────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 10,
      animation: "chatFadeIn .22s ease",
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: "50%", background: "var(--teal)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, marginRight: 8, marginTop: 2,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        </div>
      )}
      <div style={{
        maxWidth: "82%",
        padding: "9px 13px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "4px 16px 16px 16px",
        background: isUser ? "var(--teal)" : "#fff",
        color: isUser ? "#fff" : "var(--ink)",
        fontSize: 13,
        lineHeight: 1.55,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        border: isUser ? "none" : "1px solid var(--line)",
        wordBreak: "break-word",
      }}>
        {isUser ? msg.text : renderMarkdown(msg.text)}
        {msg.text === "" && !isUser && (
          <span style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--muted)", animation: "chatDot 1.2s ease-in-out infinite" }} />
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--muted)", animation: "chatDot 1.2s ease-in-out .2s infinite" }} />
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--muted)", animation: "chatDot 1.2s ease-in-out .4s infinite" }} />
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main chatbot widget ──────────────────────────────────────────────────────
export function SiteChatbot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "model", text: "👋 Hi! I'm the InterviewWin assistant. Ask me anything about our plans, features, payment, or how to get started!", id: uid() },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSugg, setShowSugg] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Scroll to bottom
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [msgs, open]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setShowSugg(false);
    setInput("");

    const userMsg: Msg = { role: "user", text: q, id: uid() };
    const botMsg: Msg = { role: "model", text: "", id: uid() };

    setMsgs(prev => [...prev, userMsg, botMsg]);
    setLoading(true);

    // Build history for API (exclude the new empty bot msg)
    const history = [...msgs, userMsg].map(m => ({
      role: m.role,
      parts: [{ text: m.text }],
    }));

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Something went wrong." }));
        setMsgs(prev => prev.map(m => m.id === botMsg.id ? { ...m, text: err.error || "Something went wrong. Please try again." } : m));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setMsgs(prev => prev.map(m => m.id === botMsg.id ? { ...m, text: full } : m));
      }

      if (!full) {
        setMsgs(prev => prev.map(m => m.id === botMsg.id ? { ...m, text: "Sorry, I couldn't get a response. Please try again." } : m));
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setMsgs(prev => prev.map(m => m.id === botMsg.id ? { ...m, text: "Connection error. Please try again." } : m));
    } finally {
      setLoading(false);
    }
  }, [msgs, loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  };

  return (
    <>
      <style>{`
        @keyframes chatFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        @keyframes chatDot { 0%,80%,100%{transform:scale(0);opacity:.3} 40%{transform:scale(1);opacity:1} }
        @keyframes chatSlideUp { from { opacity:0; transform:translateY(20px) scale(.95); } to { opacity:1; transform:none; } }
        .chat-widget { position:fixed; bottom:24px; right:20px; z-index:9999; display:flex; flex-direction:column; align-items:flex-end; gap:12px; }
        @media(max-width:480px){ .chat-widget { bottom:16px; right:12px; } }
        .chat-fab { width:52px; height:52px; border-radius:50%; background:var(--teal); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 16px rgba(21,103,91,.35); transition:transform .18s,box-shadow .18s; }
        .chat-fab:hover { transform:scale(1.07); box-shadow:0 6px 20px rgba(21,103,91,.45); }
        .chat-fab:active { transform:scale(.96); }
        .chat-window { width:340px; max-width:calc(100vw - 24px); background:#fff; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,.14); display:flex; flex-direction:column; overflow:hidden; animation:chatSlideUp .22s ease; border:1px solid var(--line); }
        @media(max-width:480px){ .chat-window { width:calc(100vw - 24px); border-radius:14px; } }
        .chat-header { background:var(--teal); color:#fff; padding:14px 16px; display:flex; align-items:center; gap:10px; }
        .chat-header-info { flex:1; }
        .chat-header h3 { font-size:14px; font-weight:700; letter-spacing:-.3px; margin:0; }
        .chat-header p { font-size:11px; opacity:.8; margin:2px 0 0; }
        .chat-close { background:transparent; border:none; color:#fff; cursor:pointer; padding:4px; border-radius:6px; opacity:.8; display:flex; }
        .chat-close:hover { opacity:1; background:rgba(255,255,255,.15); }
        .chat-body { flex:1; overflow-y:auto; padding:14px 12px 8px; min-height:260px; max-height:380px; display:flex; flex-direction:column; }
        @media(max-width:480px){ .chat-body { max-height:calc(60vh - 110px); } }
        .chat-suggestions { display:flex; flex-wrap:wrap; gap:6px; padding:0 12px 10px; }
        .chat-sugg-btn { background:var(--teal-wash); border:1px solid #c5dcc8; color:var(--teal); font-size:11px; font-weight:600; padding:5px 10px; border-radius:20px; cursor:pointer; white-space:nowrap; transition:background .15s; }
        .chat-sugg-btn:hover { background:#d7ecd3; }
        .chat-footer { border-top:1px solid var(--line); padding:10px 12px; display:flex; align-items:flex-end; gap:8px; background:#fafcf8; }
        .chat-input { flex:1; border:1px solid #d8dfd4; border-radius:10px; padding:8px 12px; font-size:13px; resize:none; outline:none; min-height:38px; max-height:90px; overflow-y:auto; background:#fff; color:var(--ink); line-height:1.5; font-family:inherit; }
        .chat-input:focus { border-color:var(--teal); box-shadow:0 0 0 3px rgba(21,103,91,.12); }
        .chat-input::placeholder { color:#a0b09a; }
        .chat-send { width:36px; height:36px; border-radius:9px; background:var(--teal); border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:background .15s; }
        .chat-send:hover:not(:disabled) { background:var(--teal-dark); }
        .chat-send:disabled { opacity:.45; cursor:not-allowed; }
        .chat-badge { position:absolute; top:-4px; right:-4px; width:16px; height:16px; background:#ef4444; border-radius:50%; border:2px solid #fff; animation:chatFadeIn .3s ease; }
      `}</style>

      <div className="chat-widget">
        {open && (
          <div className="chat-window" role="dialog" aria-label="InterviewWin support chat">
            {/* Header */}
            <div className="chat-header">
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </div>
              <div className="chat-header-info">
                <h3>InterviewWin Assistant</h3>
                <p>Ask about plans, features, payment & more</p>
              </div>
              <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Messages */}
            <div className="chat-body" ref={bodyRef}>
              {msgs.map(m => <Bubble key={m.id} msg={m} />)}
            </div>

            {/* Suggestions */}
            {showSugg && (
              <div className="chat-suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} className="chat-sugg-btn" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            )}

            {/* Input */}
            <div className="chat-footer">
              <textarea
                ref={inputRef}
                className="chat-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Type a question…"
                rows={1}
                disabled={loading}
                aria-label="Chat message"
              />
              <button
                className="chat-send"
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                aria-label="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          className="chat-fab"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? "Close chat" : "Open support chat"}
          style={{ position: "relative" }}
        >
          {open ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          ) : (
            <>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {!open && msgs.length === 1 && (
                <span className="chat-badge" aria-label="New message" />
              )}
            </>
          )}
        </button>
      </div>
    </>
  );
}
