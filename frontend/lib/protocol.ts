import type { Evidence } from "./types";

export type Transcript = { id: string; role: "interviewer" | "user" | "unknown"; text: string; final: boolean; timestamp?: string };
export type LiveMessage =
  | { type: "status"; state: "connecting" | "listening" | "reconnecting" | "ended"; detail?: string }
  | ({ type: "transcript" } & Transcript)
  | { type: "question"; generation_id: string; question: string; project_id?: string | null; keywords: string[] }
  | { type: "answer_delta"; generation_id: string; text: string }
  | { type: "answer_complete"; generation_id: string; answer: string; evidence: Evidence[]; keywords: string[]; latency_ms: number }
  | { type: "answer_cancelled"; generation_id: string }
  | { type: "memory"; summary: string; active_project_id?: string | null }
  | { type: "metrics"; first_token_ms?: number; total_ms?: number; questions: number; reconnects: number; audio_dropped: number }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "pong" };

export type LiveState = {
  phase: "idle" | "capturing" | "connecting" | "listening" | "reconnecting" | "ended";
  detail: string; generation: string | null; question: string; answer: string;
  evidence: Evidence[]; keywords: string[]; transcripts: Transcript[]; memory: string;
  metrics: Record<string, number>; error: string; latency: number | null; answering: boolean; announcement: string;
};
export const initialLiveState: LiveState = { phase: "idle", detail: "", generation: null, question: "", answer: "", evidence: [], keywords: [], transcripts: [], memory: "", metrics: {}, error: "", latency: null, answering: false, announcement: "" };

export function reduceLiveMessage(state: LiveState, event: LiveMessage): LiveState {
  switch (event.type) {
    case "status": return {
      ...state, phase: event.state, detail: event.detail || "",
      ...(event.state === "listening" ? { error: "" } : {}),
      ...(["ended", "reconnecting"].includes(event.state) ? { answering: false, generation: null } : {}),
      ...(event.state === "reconnecting" ? { question: "", answer: "", evidence: [], keywords: [], latency: null } : {}),
    };
    case "question": return { ...state, generation: event.generation_id, question: event.question, answer: "", evidence: [], keywords: event.keywords || [], latency: null, answering: true, announcement: `Question detected: ${event.question}` };
    case "answer_delta": return state.generation === event.generation_id ? { ...state, answer: state.answer + event.text } : state;
    case "answer_complete": return state.generation === event.generation_id ? { ...state, answer: event.answer, evidence: event.evidence || [], keywords: event.keywords || [], latency: event.latency_ms, answering: false, announcement: `Suggested answer ready. ${event.answer.slice(0, 350)}. ${event.evidence?.length || 0} source references attached.` } : state;
    case "answer_cancelled": return state.generation === event.generation_id ? { ...state, generation: null, answering: false, answer: "", evidence: [], latency: null } : state;
    case "transcript": {
      const index = state.transcripts.findIndex(item => item.id === event.id);
      const transcripts = [...state.transcripts];
      if (index < 0) transcripts.push(event); else transcripts[index] = event;
      return { ...state, transcripts: transcripts.slice(-80) };
    }
    case "memory": return { ...state, memory: event.summary };
    case "metrics": { const { type: _type, ...metrics } = event; void _type; return { ...state, metrics }; }
    case "error": return { ...state, error: event.message };
    case "pong": return state;
  }
}

export function parseLiveMessage(raw: string): LiveMessage | null {
  try {
    const message: unknown = JSON.parse(raw);
    if (!message || typeof message !== "object" || !("type" in message)) return null;
    const record = message as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string") return null;
    if (type === "status") return typeof record.state === "string" && ["connecting", "listening", "reconnecting", "ended"].includes(record.state) && (record.detail === undefined || typeof record.detail === "string") ? record as LiveMessage : null;
    if (type === "transcript") return typeof record.id === "string" && typeof record.text === "string" && typeof record.role === "string" && ["interviewer", "user", "unknown"].includes(record.role) && typeof record.final === "boolean" ? record as LiveMessage : null;
    if (["question", "answer_delta", "answer_complete", "answer_cancelled"].includes(type)) {
      if (typeof record.generation_id !== "string") return null;
      if (type === "question" && (typeof record.question !== "string" || !Array.isArray(record.keywords) || !record.keywords.every(word => typeof word === "string"))) return null;
      if (type === "question" && record.project_id !== undefined && record.project_id !== null && typeof record.project_id !== "string") return null;
      if (type === "answer_delta" && typeof record.text !== "string") return null;
      if (type === "answer_complete" && (typeof record.answer !== "string" || !Array.isArray(record.evidence) || !record.evidence.every(isEvidence) || !Array.isArray(record.keywords) || !record.keywords.every(word => typeof word === "string") || typeof record.latency_ms !== "number" || !Number.isFinite(record.latency_ms))) return null;
      return record as LiveMessage;
    }
    if (type === "memory" && typeof record.summary === "string" && (record.active_project_id === undefined || record.active_project_id === null || typeof record.active_project_id === "string")) return record as LiveMessage;
    if (type === "metrics" && ["questions", "reconnects", "audio_dropped"].every(key => typeof record[key] === "number" && Number.isFinite(record[key])) && ["first_token_ms", "total_ms"].every(key => record[key] === undefined || typeof record[key] === "number" && Number.isFinite(record[key]))) return record as LiveMessage;
    if (type === "error" && typeof record.code === "string" && typeof record.message === "string" && typeof record.recoverable === "boolean") return record as LiveMessage;
    if (type === "pong") return { type: "pong" };
    return null;
  } catch { return null; }
}

function isEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return ["id", "source_id", "source_name", "text", "locator"].every(key => typeof item[key] === "string")
    && (item.project_id === null || typeof item.project_id === "string")
    && typeof item.verified_contribution === "boolean" && typeof item.score === "number" && Number.isFinite(item.score)
    && (item.retrieval_warning === undefined || typeof item.retrieval_warning === "string")
    && (item.retrieval_mode === undefined || typeof item.retrieval_mode === "string");
}

export function websocketUrl(sessionId: string, ticket: string, base: string, location: Pick<Location, "protocol" | "host">): string {
  const fallback = process.env.NODE_ENV === "development" ? "ws://localhost:8000" : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const root = base || fallback;
  const url = new URL(root.includes("{id}") ? root.replace("{id}", encodeURIComponent(sessionId)) : `${root.replace(/\/$/, "")}/api/live/${encodeURIComponent(sessionId)}/ws`);
  if (location.protocol === "https:" && url.protocol !== "wss:") throw new Error("A secure page requires a secure WebSocket URL (wss://).");
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
