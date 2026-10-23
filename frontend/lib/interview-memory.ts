import { formatAnswer } from "./answer-format";
import { isContextFollowUp } from "./speech-timing";

type Speaker = "interviewer" | "user" | "unknown";
type TaskKind = "implementation" | "explanation" | "comparison" | "general";
type SpokenTurn = { id: string; text: string; role: Speaker; final: boolean };
type Exchange = { id: string; question: string; answer: string };
type CodeArtifact = { id: string; language: string; code: string; complete: boolean; source_question: string };
export type InterviewContext = {
  version: 1;
  active_task: { question: string; kind: TaskKind; language: string; constraints: string[]; code_reference: string | null } | null;
  code_artifacts: CodeArtifact[];
  recent_exchanges: Exchange[];
  earlier_topics: Array<{ question: string; answer_summary: string }>;
  reported_candidate_speech: Array<{ id: string; text: string; attribution: "estimated" }>;
  recent_speech: SpokenTurn[];
  answered_count: number;
};

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const records = (value: unknown, max: number) => Array.isArray(value) ? value.slice(-max).map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
const role = (value: unknown): Speaker => value === "user" || value === "interviewer" ? value : "unknown";
const empty = (): InterviewContext => ({ version: 1, active_task: null, code_artifacts: [], recent_exchanges: [], earlier_topics: [], reported_candidate_speech: [], recent_speech: [], answered_count: 0 });

/** Whitelist and bound client context before adding it to a provider prompt. */
export function sanitizeInterviewContext(value: unknown): InterviewContext | null {
  const source = record(value);
  if (!source || source.version !== 1) return null;
  const task = record(source.active_task);
  const context: InterviewContext = {
    version: 1,
    active_task: task ? {
      question: text(task.question, 2000), kind: ["implementation", "explanation", "comparison"].includes(String(task.kind)) ? task.kind as TaskKind : "general",
      language: text(task.language, 40), constraints: Array.isArray(task.constraints) ? task.constraints.filter((item): item is string => typeof item === "string").slice(-8).map(item => item.slice(0, 160)) : [],
      code_reference: typeof task.code_reference === "string" ? task.code_reference.slice(0, 100) : null,
    } : null,
    code_artifacts: [],
    recent_exchanges: records(source.recent_exchanges, 4).map(item => ({ id: text(item.id, 100), question: text(item.question, 1000), answer: text(item.answer, 1500) })),
    earlier_topics: records(source.earlier_topics, 12).map(item => ({ question: text(item.question, 300), answer_summary: text(item.answer_summary, 300) })),
    reported_candidate_speech: records(source.reported_candidate_speech, 8).map(item => ({ id: text(item.id, 100), text: text(item.text, 400), attribution: "estimated" })),
    recent_speech: records(source.recent_speech, 8).map(item => ({ id: text(item.id, 100), text: text(item.text, 800), role: role(item.role), final: item.final === true })),
    answered_count: typeof source.answered_count === "number" && Number.isFinite(source.answered_count) ? Math.max(0, Math.floor(source.answered_count)) : 0,
  };
  let codeBudget = 10000;
  for (const item of records(source.code_artifacts, 2)) {
    const code = text(item.code, codeBudget);
    context.code_artifacts.push({ id: text(item.id, 100), language: text(item.language, 40), code, complete: item.complete === true && typeof item.code === "string" && code.length === item.code.length, source_question: text(item.source_question, 600) });
    codeBudget -= code.length;
  }
  // Retain the active task and exact code first; old prose is expendable.
  for (const key of ["earlier_topics", "recent_exchanges", "recent_speech", "reported_candidate_speech"] as const) {
    while (JSON.stringify(context).length > 32000 && context[key].length) context[key].shift();
  }
  return context;
}

function languageOf(question: string): string {
  const match = /\b(?:in|using|use|to)\s+(python|javascript|typescript|java|c\+\+|c#|golang|go|rust|ruby|swift|kotlin|sql)(?=\s|[?!.;,]|$)/i.exec(question);
  return match?.[1].toLowerCase().replace("golang", "go") || "";
}
function constraintsOf(question: string): string[] {
  const clauses = question.match(/\b(?:without|must|using|return|handle|at most|at least|do not|don't|in-place)\b[^.!?;\n]{0,150}|\bO\([^)]{1,30}\)/gi) || [];
  return [...new Set(clauses.flatMap(item => item.split(/\s+and\s+(?=(?:without|must|using|return|handle|at most|at least|do not|don't|in-place)\b)/i)).map(item => item.trim()))].slice(-8);
}

function mergeConstraints(previous: string[], current: string[]): string[] {
  const topic = (clause: string) => /\b(?:recurs\w*|iterative\w*)\b/i.test(clause) ? "recursion"
    : /\b(?:in.place|mutat\w*|original (?:array|list))\b/i.test(clause) ? "mutation"
      : /\bspace\b/i.test(clause) ? "space" : /\btime\b/i.test(clause) ? "time" : null;
  const updatedTopics = new Set(current.map(topic).filter(Boolean));
  return [...new Set([...previous.filter(clause => !updatedTopics.has(topic(clause))), ...current])].slice(-8);
}

// The prompt stores excerpts; stale callback checks must cover the full utterance.
function speechFingerprint(value: string): string {
  let first = 2166136261; let second = 5381;
  for (let i = 0; i < value.length; i++) { const char = value.charCodeAt(i); first = Math.imul(first ^ char, 16777619); second = Math.imul(second, 33) ^ char; }
  return `${value.length}:${first >>> 0}:${second >>> 0}`;
}

/** Ephemeral session memory: generated suggestions never become candidate facts. */
export class InterviewMemory {
  private state = empty();
  private speechSnapshots = new Map<string, string>();
  get hasContext(): boolean { return this.state.active_task !== null; }
  reset(): void { this.state = empty(); this.speechSnapshots.clear(); }
  context(): InterviewContext { return sanitizeInterviewContext(this.state)!; }

  recordSpeech(turn: SpokenTurn): void {
    const id = turn.id.slice(0, 100);
    const existing = this.state.recent_speech.find(item => item.id === id);
    const fingerprint = speechFingerprint(turn.text);
    const sameText = this.speechSnapshots.get(id) === fingerprint;
    if (existing?.final && !turn.final) return;
    const next = { id, text: turn.text.slice(0, 800), role: turn.role === "unknown" && sameText && existing ? existing.role : turn.role, final: turn.final };
    this.state.recent_speech = [...this.state.recent_speech.filter(item => item.id !== next.id), next].slice(-8);
    this.speechSnapshots.set(id, fingerprint);
    for (const key of this.speechSnapshots.keys()) if (!this.state.recent_speech.some(item => item.id === key)) this.speechSnapshots.delete(key);
    if (!sameText) this.state.reported_candidate_speech = this.state.reported_candidate_speech.filter(item => item.id !== next.id);
    if (next.role === "user") this.rememberCandidate(next);
  }

  classifySpeech(id: string, originalText: string, speaker: Speaker): boolean {
    const spoken = this.state.recent_speech.find(item => item.id === id);
    if (!spoken || this.speechSnapshots.get(id) !== speechFingerprint(originalText)) return false;
    spoken.role = speaker;
    if (speaker === "user") this.rememberCandidate(spoken);
    else this.state.reported_candidate_speech = this.state.reported_candidate_speech.filter(item => item.id !== id);
    return true;
  }

  private rememberCandidate(turn: SpokenTurn): void {
    this.state.reported_candidate_speech = [...this.state.reported_candidate_speech.filter(item => item.id !== turn.id), { id: turn.id, text: turn.text.slice(0, 400), attribution: "estimated" as const }].slice(-8);
  }

  recordAnswer(id: string, question: string, answer: string, originalSpeech = question): void {
    const prior = this.state.active_task;
    const followUp = prior !== null && isContextFollowUp(originalSpeech);
    const segments = formatAnswer(answer);
    const artifacts = segments.flatMap((segment, index) => segment.kind === "code" ? [{
      id: `${id}:code:${index}`, language: segment.language || "", code: answer.slice(segment.start, segment.end),
      complete: segments[index + 1]?.kind === "fence", source_question: question,
    }] : []);
    if (artifacts.length) this.state.code_artifacts = artifacts.slice(0, 2);
    const kind: TaskKind = /\bexplain\b/i.test(question) ? "explanation" : artifacts.length || /\b(?:implement|write|rewrite|convert)\b/i.test(question) ? "implementation" : /\b(?:compare|difference|versus)\b/i.test(question) ? "comparison" : "general";
    this.state.active_task = {
      question: followUp && kind !== "implementation" ? prior.question : question.slice(0, 2000), kind,
      language: languageOf(originalSpeech) || languageOf(question) || artifacts[0]?.language || (followUp ? prior.language : ""),
      constraints: mergeConstraints(followUp ? prior.constraints : [], [...constraintsOf(question), ...constraintsOf(originalSpeech)]),
      code_reference: artifacts[0]?.id || (followUp ? prior.code_reference : null),
    };
    const answerText = segments.map((segment, index) => segment.kind === "code" ? `[Code artifact: ${id}:code:${index}]` : segment.kind === "text" ? answer.slice(segment.start, segment.end) : "").join("").trim();
    const exchange = { id, question: question.slice(0, 1000), answer: answerText.slice(0, 1500) };
    const repeated = this.state.recent_exchanges.some(item => item.id === id);
    this.state.recent_exchanges = [...this.state.recent_exchanges.filter(item => item.id !== id), exchange];
    if (!repeated) this.state.answered_count++;
    while (this.state.recent_exchanges.length > 4) {
      const old = this.state.recent_exchanges.shift()!;
      this.state.earlier_topics.push({ question: old.question.slice(0, 300), answer_summary: old.answer.slice(0, 300) });
    }
    this.state.earlier_topics = this.state.earlier_topics.slice(-12);
    this.state = this.context();
  }
}
