/** A request cue is independent of speaker identity and of the preceding answer. */
function requestMarkers(text: string) {
  return [...text.matchAll(/\b(?:what(?:'s|\s+(?:is|are|was|were|does|do|would|should))|how\s+(?:do|does|did|would|can|could|is|are)|why\s+(?:do|does|did|is|are|would|should)|can\s+you|could\s+you|would\s+you|tell\s+me|explain|describe|compare|implement|write\s+(?:a|an|the|code))\b/gi)];
}

export function isIncompleteSpeech(text: string): boolean {
  if (/^why[?!.]$/i.test(text.trim())) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ']/g, " ").replace(/\s+/g, " ").trim();
  return /\b(what|what's|whats|how|why|who|where|when|which|is|are|was|were|do|does|did|can|could|would|should|tell|explain|describe|about|of|in|on|for|to|with|and|or|the|a|an|using|without|between|than|most)\s*$/.test(normalized)
    || /^(tell me|tell me about|what about|how about|can you|could you|would you)$/.test(normalized);
}
export function embeddedRequest(text: string, latest = false): string | null {
  const matches = requestMarkers(text);
  if (!matches.length) return null;
  // Keep multipart questions intact when the request starts the utterance.
  const first = matches[0];
  const match = !latest && text.slice(0, first.index).trim().split(/\s+/).filter(Boolean).length <= 3 ? first : matches[matches.length - 1];
  const request = text.slice(match.index).replace(/\s+/g, " ").trim();
  const questionEnd = request.indexOf("?");
  return latest && questionEnd >= 0 ? request.slice(0, questionEnd + 1) : request;
}

const topicNames: Record<string, string> = {
  abstract: "abstract classes", "abstract class": "abstract classes", "abstract classes": "abstract classes",
  dbms: "DBMS", db: "databases", database: "databases", databases: "databases", oop: "object-oriented programming", "object oriented programming": "object-oriented programming",
  polymorphism: "polymorphism", encapsulation: "encapsulation", inheritance: "inheritance", abstraction: "abstraction",
  interface: "interfaces", interfaces: "interfaces", constructor: "constructors", constructors: "constructors",
  list: "lists", lists: "lists", dictionary: "dictionaries", dictionaries: "dictionaries", tuple: "tuples", tuples: "tuples",
  set: "sets", sets: "sets", stack: "stacks", queue: "queues", array: "arrays", arrays: "arrays", "hash map": "hash maps",
  "data structure": "data structures", "data structures": "data structures", "time complexity": "time complexity", "space complexity": "space complexity",
  sql: "SQL", deadlock: "deadlocks", normalization: "database normalization", acid: "ACID transactions", transaction: "transactions",
  index: "database indexes", "react hooks": "React hooks", recursion: "recursion",
  python: "Python", java: "Java", javascript: "JavaScript", typescript: "TypeScript", go: "Go", rust: "Rust", "c++": "C++", "c#": "C#",
  api: "APIs", "rest api": "REST APIs", html: "HTML", css: "CSS", react: "React", node: "Node.js", "node.js": "Node.js",
  class: "classes", object: "objects", function: "functions", method: "methods", variable: "variables", loop: "loops",
  join: "SQL joins", "primary key": "primary keys", "foreign key": "foreign keys", table: "database tables", schema: "database schemas",
  cache: "caching", caching: "caching", sharding: "sharding", replication: "replication", microservices: "microservices",
  thread: "threads", process: "processes", exception: "exceptions", decorator: "decorators", closure: "closures", promise: "promises",
};
const trimFiller = (text: string) => text.trim().replace(/^(?:(?:okay|ok|now|next|and|so|um|uh)[, ]+)+/i, "").replace(/(?:[, ]+(?:okay|ok|please|sir|yeah|yes))+[?.!]*$/i, "").replace(/[?.!]+$/, "").trim();
const adjacentTopicPattern = /\b(dbms|db|oop)\s+(abstract(?:\s+class(?:es)?)?)\s*[.!?]*$/i;
const speechClauses = (text: string) => text.split(/[!?;]\s*|\.(?:\s+|$)|,\s*(?=[\w.+#-]+(?:\s+[\w.+#-]+){0,2}\s+means?\b)/i);
const lastClauseOf = (text: string) => speechClauses(text).filter(part => part.trim()).at(-1) || text;

/** An offer to explain is not an instruction; any subsequent request must survive. */
export function isCapabilityNarration(text: string): boolean {
  const match = /^(?:i|we)\s+(?:can|will|could|would)\s+(?:describe|explain|implement|write|compare)\s+(.+?)[.!]?$/i.exec(trimFiller(text));
  return Boolean(match && !text.includes("?") && !/[.!?;,\n]/.test(match[1]) && !requestMarkers(match[1]).length && !/\b(?:please|you|want|need)\b/i.test(match[1]));
}
function isNarratedRequest(text: string): boolean {
  const first = requestMarkers(text)[0];
  const prefix = first ? text.slice(0, first.index) : text;
  return /\b(?:asked|asks|asking|yesterday|previous interview|last interview)\b/i.test(prefix)
    || /^\s*(?:I|we)\s+(?:can|will|could|would|often|usually|used to)\s*$/i.test(prefix.trim());
}

/** A bare technical topic is a possible request, not a reliable speaker label. */
export function briefTopicRequest(text: string): string | null {
  const clean = trimFiller(text).replace(/\s+(?:means?|meaning|definition)$/i, "").replace(/^(?:meaning|definition)\s+of\s+/i, "").trim();
  const match = /^(.*?)(?:\s+in\s+(python|javascript|typescript|java|c\+\+|c#|go|rust))?$/i.exec(clean);
  const key = (match?.[1] || "").toLowerCase();
  const topic = Object.hasOwn(topicNames, key) ? topicNames[key] : null;
  return topic ? `Explain ${topic}${match?.[2] ? ` in ${match[2]}` : ""}.` : null;
}

export function trailingTopicRequest(text: string): string | null {
  const lastClause = lastClauseOf(text);
  const brief = briefTopicRequest(lastClause);
  if (brief) return brief;
  // Adjacent topic prompts can be emitted without punctuation by mobile STT.
  // Do not split modifiers such as "Python dictionary" or "abstract class".
  const adjacent = adjacentTopicPattern.exec(lastClause);
  return adjacent ? briefTopicRequest(adjacent[2]) : null;
}

/** Keep reported past questions intact so they cannot become new commands. */
export function speechRequestFocus(text: string): string {
  if (isNarratedRequest(text)) return text;
  const clause = lastClauseOf(text);
  if (briefTopicRequest(clause)) return trimFiller(clause);
  const adjacent = adjacentTopicPattern.exec(clause);
  return adjacent?.[2] || embeddedRequest(text) || text;
}

export function heardQuestionOptions(text: string): string[] {
  const options: string[] = [];
  for (const clause of speechClauses(text.slice(-4000))) {
    if (isNarratedRequest(clause)) continue;
    const adjacent = adjacentTopicPattern.exec(clause);
    if (adjacent) {
      options.push(embeddedRequest(clause.slice(0, adjacent.index + adjacent[1].length)) || briefTopicRequest(adjacent[1])!, briefTopicRequest(adjacent[2])!); continue;
    }
    const markers = requestMarkers(clause).filter((marker, index, all) => index === 0 || !/^\s*(?:(?:you|me|to|please)\s*)*$/i.test(clause.slice(all[index - 1].index! + all[index - 1][0].length, marker.index)));
    if (markers.length > 1) {
      for (let i = 0; i < markers.length; i++) options.push(clause.slice(markers[i].index, markers[i + 1]?.index).trim().slice(0, 300));
      continue;
    }
    const request = embeddedRequest(clause);
    const brief = briefTopicRequest(clause);
    if (request) options.push(request.slice(0, 300));
    else if (brief) options.push(brief);
  }
  const trailing = !isNarratedRequest(lastClauseOf(text)) && trailingTopicRequest(text); if (trailing) options.push(trailing);
  return [...new Set(options)].filter(question => !isIncompleteSpeech(question)).slice(-8);
}
