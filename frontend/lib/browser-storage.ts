import type { Evidence, Health, Preferences, Project, Session, Source, Turn, User } from "./types";

const KEY_USER = "interviewpilot_user_v1";
const KEY_PROJECTS = "interviewpilot_projects_v1";
const KEY_SOURCES = "interviewpilot_sources_v1";
const KEY_CHUNKS = "interviewpilot_chunks_v1";
const KEY_SESSIONS = "interviewpilot_sessions_v1";

interface StoredChunk {
  id: string;
  source_id: string;
  project_id: string | null;
  source_name: string;
  text: string;
  locator: string;
  score: number;
  verified_contribution: boolean;
}

function getItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === "undefined") throw new Error("Browser storage is unavailable. Open the workspace in a browser.");
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("Could not save to browser storage. Free device space or enable site storage, then try again.");
  }
}

/** Roll back a multi-key document save if the browser runs out of space. */
function commitItems(entries: Array<[string, unknown]>): void {
  const storage = window.localStorage;
  const previous = entries.map(([key]) => [key, storage.getItem(key)] as const);
  try { for (const [key, value] of entries) setItem(key, value); }
  catch (error) {
    for (const [key, value] of previous) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Preserve the original storage error. */ }
    }
    throw error;
  }
}

function defaultUser(): User {
  return {
    id: "browser-user",
    email: "candidate@workspace.local",
    name: "Candidate",
    plan: "free",
    github_username: "",
    github_verified: false,
    profile: {
      "Target Focus": "Software Engineering & Technical Leadership",
      "Storage Mode": "This browser only",
      "Notice": "Documents and retained sessions are saved on this device. Relevant excerpts are sent to the AI provider for answers."
    },
    preferences: {
      role: "Senior Software Engineer",
      company: "",
      language: "English",
      answer_style: "concise",
      answer_tone: "professional",
      grounding: "balanced",
      english_level: "everyday",
      reading_mode: "auto",
      reading_wpm: 155,
      response_delivery: "natural",
      personalization: "grounded",
      include_simple_example: true,
      answer_text_size: 17,
      answer_font: "system",
      answer_theme: "default"
    },
    minutes_used: 0,
    minute_limit: null, // Unlimited testing minutes
    testing_mode: true
  };
}

function defaultProjects(): Project[] {
  return [
    {
      id: "project-core",
      name: "Core Experience & Portfolio",
      description: "My primary work history, key technical projects, system design, and interview preparation notes.",
      analysis: { status: "ready" },
      source_count: 0,
      created_at: new Date().toISOString()
    }
  ];
}

export function sanitizePreferences(preferences: Preferences = {}): Preferences {
  const validDelivery = ["natural", "talking_points", "structured"].includes(preferences.response_delivery || "")
    ? preferences.response_delivery
    : "natural";
  const validLength = ["concise", "balanced", "detailed"].includes(preferences.answer_style || "")
    ? preferences.answer_style
    : "concise";
  const validLevel = ["simple", "everyday", "advanced"].includes(preferences.english_level || "")
    ? preferences.english_level
    : "everyday";
  const validTone = ["professional", "friendly", "casual"].includes(preferences.answer_tone || "")
    ? preferences.answer_tone
    : "professional";
  const size = Number(preferences.answer_text_size);
  const company = typeof preferences.company === "string" ? preferences.company.trim().slice(0, 80) : "";
  const role = typeof preferences.role === "string" ? preferences.role.trim().slice(0, 160) : preferences.role;
  return {
    ...preferences,
    role,
    company,
    response_delivery: validDelivery as Preferences["response_delivery"],
    answer_style: validLength,
    english_level: validLevel as Preferences["english_level"],
    answer_tone: validTone as Preferences["answer_tone"],
    include_simple_example: preferences.include_simple_example !== false,
    answer_text_size: Number.isFinite(size) ? Math.min(24, Math.max(14, Math.round(size))) : 17,
    answer_font: ["system", "serif", "readable"].includes(preferences.answer_font || "") ? preferences.answer_font : "system",
    answer_theme: ["default", "easy", "contrast"].includes(preferences.answer_theme || "") ? preferences.answer_theme : "default",
  };
}

export function getStoredUser(): User {
  const existing = getItem<User | null>(KEY_USER, null);
  if (existing) {
    // Ensure testing mode remains enabled so no account walls ever appear
    // Sanitize legacy stored preferences (invalid answer_style strings, stale defaults).
    const preferences = sanitizePreferences(existing.preferences || {});
    const needsRepair = JSON.stringify(preferences) !== JSON.stringify(existing.preferences || {});
    const repaired = { ...existing, preferences, testing_mode: true, minute_limit: null };
    if (needsRepair) {
      try { setItem(KEY_USER, repaired); } catch { /* ignore */ }
    }
    return repaired;
  }
  const initial = defaultUser();
  setItem(KEY_USER, initial);
  return initial;
}

export function updateStoredUser(patch: Partial<User> & { preferences?: Preferences }): User {
  const current = getStoredUser();
  const updated: User = {
    ...current,
    ...patch,
    preferences: { ...(current.preferences || {}), ...(patch.preferences || {}) },
    testing_mode: true,
    minute_limit: null
  };
  setItem(KEY_USER, updated);
  return updated;
}

export function getStoredProjects(): Project[] {
  return getItem<Project[]>(KEY_PROJECTS, defaultProjects());
}

export function createStoredProject(data: { name: string; description?: string }): Project {
  const projects = getStoredProjects();
  const created: Project = {
    id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: data.name,
    description: data.description || "",
    analysis: { status: "ready" },
    source_count: 0,
    created_at: new Date().toISOString()
  };
  setItem(KEY_PROJECTS, [created, ...projects]);
  return created;
}

export function deleteStoredProject(id: string): void {
  const projects = getStoredProjects().filter(p => p.id !== id);
  setItem(KEY_PROJECTS, projects);
  const allSources = getStoredSources();
  for (const source of allSources.filter(s => s.project_id === id)) window.localStorage.removeItem(`interviewpilot_source_content_${source.id}`);
  const sources = allSources.filter(s => s.project_id !== id);
  setItem(KEY_SOURCES, sources);
  const chunks = getItem<StoredChunk[]>(KEY_CHUNKS, []).filter(c => c.project_id !== id);
  setItem(KEY_CHUNKS, chunks);
}

export function getStoredSources(): Source[] {
  return getItem<Source[]>(KEY_SOURCES, []);
}

export async function uploadStoredSource(file: File, projectId: string | null): Promise<Source> {
  let fileText = "";
  const ext = file.name.split(".").pop()?.toLowerCase() || "doc";
  const isPdf = ext === "pdf" || file.type === "application/pdf";

  if (isPdf) {
    try {
      const { extractText } = await import("unpdf");
      const buffer = await file.arrayBuffer();
      const res = await extractText(new Uint8Array(buffer));
      fileText = Array.isArray(res.text) ? res.text.join("\n\n") : (res.text || "");
    } catch (err) {
      console.warn("Failed to extract PDF text with unpdf:", err);
    }
  }

  if (!fileText && !isPdf) {
    try {
      fileText = await file.text();
    } catch {
      fileText = "";
    }
  }

  // Filter out any binary/unprintable junk (e.g. if a binary file was mistakenly read as text)
  const isBinaryGarbage = /[\x00-\x08\x0E-\x1F\x7F-\x9F]/.test(fileText.slice(0, 500)) && (fileText.match(/[\uFFFD\x00-\x1F]/g) || []).length > 10;
  if (isBinaryGarbage && isPdf) {
    fileText = "";
  }

  const cleaned = fileText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFD]/g, " ").replace(/[ \t]+/g, " ").trim();

  // Split into paragraphs / sections
  if (!["pdf", "txt", "md", "csv", "json", "py", "js", "ts", "tsx", "jsx", "java", "go", "rs", "cpp", "c", "html", "css"].includes(ext) || !cleaned || isBinaryGarbage) {
    throw new Error("No readable text was extracted. In this browser workspace, upload a text PDF, TXT, Markdown, or source file. Scanned images and DOCX need the full backend.");
  }
  const paragraphs = cleaned
    .split(/(?:\r?\n){2,}|(?=\n\s*[•\-\*\d+\.]\s+)/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .flatMap(p => p.match(/[\s\S]{1,1800}/g) || []);

  const chunksToStore: string[] = paragraphs.length > 0
    ? paragraphs.slice(0, 40)
    : [cleaned];

  const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const kind = isPdf ? "pdf" : ext === "docx" ? "docx" : ext === "md" || ext === "txt" ? "document" : "upload";

  const source: Source = {
    id: sourceId,
    project_id: projectId,
    name: file.name,
    kind,
    status: "ready",
    error: null,
    chunk_count: chunksToStore.length,
    created_at: new Date().toISOString()
  };

  // Save extracted chunks
  const existingChunks = getItem<StoredChunk[]>(KEY_CHUNKS, []);
  const newChunks: StoredChunk[] = chunksToStore.map((text, i) => ({
    id: `chk_${sourceId}_${i}`,
    source_id: sourceId,
    project_id: projectId,
    source_name: file.name,
    text,
    locator: `Section ${i + 1}`,
    score: 0.95,
    verified_contribution: false
  }));
  const user = getStoredUser();
  const currentUploads = Array.isArray(user.profile["Uploaded Sources"]) ? user.profile["Uploaded Sources"] as string[] : [];
  const entries: Array<[string, unknown]> = [
    [KEY_SOURCES, [source, ...getStoredSources()]],
    [`interviewpilot_source_content_${sourceId}`, cleaned],
    [KEY_CHUNKS, [...newChunks, ...existingChunks]],
    [KEY_USER, { ...user, profile: { ...user.profile, "Uploaded Sources": [...new Set([...currentUploads, file.name])] } }],
  ];
  if (projectId) entries.push([KEY_PROJECTS, getStoredProjects().map(p => p.id === projectId ? { ...p, source_count: p.source_count + 1 } : p)]);
  commitItems(entries);

  return source;
}

export function getStoredSourceContent(sourceId: string): string | null {
  const direct = getItem<string | null>(`interviewpilot_source_content_${sourceId}`, null);
  if (direct && direct.trim()) return direct;
  const chunks = getItem<StoredChunk[]>(KEY_CHUNKS, []).filter(c => c.source_id === sourceId);
  if (chunks.length > 0) return chunks.map(c => c.text).join("\n\n");
  return null;
}

export function addStoredGithubSource(projectId: string, url: string): Source {
  void projectId; void url;
  throw new Error("Repository import requires the full backend. Upload the repository's README or source files to this browser workspace instead.");
}

export function deleteStoredSource(id: string): void {
  const sources = getStoredSources();
  const target = sources.find(s => s.id === id);
  setItem(KEY_SOURCES, sources.filter(s => s.id !== id));
  if (target?.project_id) {
    const projects = getStoredProjects().map(p => p.id === target.project_id ? { ...p, source_count: Math.max(0, p.source_count - 1) } : p);
    setItem(KEY_PROJECTS, projects);
  }
  const chunks = getItem<StoredChunk[]>(KEY_CHUNKS, []).filter(c => c.source_id !== id);
  setItem(KEY_CHUNKS, chunks);
  window.localStorage.removeItem(`interviewpilot_source_content_${id}`);
}

export function searchStoredEvidence(query: string): Evidence[] {
  const allChunks = getItem<StoredChunk[]>(KEY_CHUNKS, []);
  // Filter out any unprintable binary garbage chunks
  const chunks = allChunks.filter(c => !/[\uFFFD]/.test(c.text) && /[a-zA-Z]{4,}/.test(c.text));

  const stopWords = new Set(["what", "which", "would", "could", "should", "does", "have", "your", "you", "the", "and", "tell", "about", "for", "with", "explain", "describe", "please", "okay", "how", "can", "are", "was", "were", "this", "that", "from"]);
  const tokens = (value: string) => value.toLowerCase().match(/[a-z0-9]+(?:\+\+|#)?/g) || [];
  const words = [...new Set(tokens(query).filter(word => word.length > 2 && !stopWords.has(word) || ["db", "cv", "go", "c++", "c#"].includes(word)))];
  const isPersonalOrProjectQuery = /\b(recent|projects?|work|experience|background|resume|cv|built|implemented|accomplishment|role|career)\b/i.test(query);

  const scored = chunks.map(chunk => {
    const terms = new Set(tokens(chunk.text + " " + chunk.source_name));
    let score = 0;
    for (const w of words) {
      if (terms.has(w)) score += 0.25;
    }
    // If it's a project/experience query, boost chunks from resumes or documents containing project keywords
    if (isPersonalOrProjectQuery) {
      if (/(resume|cv|project|experience|work)/i.test(chunk.source_name)) {
        score += 0.35;
      }
      if (/(project|built|developed|architected|designed|engineered|led|implemented|stack|system)/i.test(chunk.text)) {
        score += 0.30;
      }
    }
    return { ...chunk, verified_contribution: false, score: Math.min(0.99, score) };
  });

  const matching = scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  if (matching.length > 0) {
    return matching;
  }

  // If the user uploaded sources, return the most informative chunks from their uploaded sources
  return [];


}

export function getStoredSessions(): Session[] {
  return getItem<Session[]>(KEY_SESSIONS, []);
}

export function getStoredSession(id: string): Session | null {
  const sessions = getStoredSessions();
  return sessions.find(s => s.id === id) || null;
}

export function createStoredSession(data: { title?: string; audio_mode?: "microphone" | "tab"; retention?: boolean }): Session {
  const session: Session = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: data.title?.trim() || "Live conversation",
    status: "live",
    audio_mode: data.audio_mode || "microphone",
    retention: data.retention ?? true,
    created_at: new Date().toISOString(),
    ended_at: null,
    summary: "Live interview assistance session in browser.",
    metrics: { questions: 0 },
    turns: []
  };
  const sessions = getStoredSessions();
  setItem(KEY_SESSIONS, [session, ...sessions]);
  return session;
}

export function stopStoredSession(id: string): Session {
  const sessions = getStoredSessions();
  let updated: Session | null = null;
  const list = sessions.map(s => {
    if (s.id === id) {
      updated = { ...s, status: "ended", ended_at: new Date().toISOString() };
      return updated;
    }
    return s;
  });
  setItem(KEY_SESSIONS, list);
  return updated || {
    id,
    title: "Live conversation",
    status: "ended",
    audio_mode: "microphone",
    retention: true,
    created_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    summary: "Live session ended.",
    metrics: {}
  };
}

export function deleteStoredSession(id: string): void {
  setItem(KEY_SESSIONS, getStoredSessions().filter(s => s.id !== id));
}

export function addTurnToStoredSession(sessionId: string, turn: Turn): void {
  const sessions = getStoredSessions();
  const list = sessions.map(s => {
    if (s.id === sessionId) {
      if (!s.retention) return s;
      const exists = (s.turns || []).some(item => item.id === turn.id);
      const turns = exists ? (s.turns || []).map(item => item.id === turn.id ? turn : item) : [...(s.turns || []), turn];
      return {
        ...s,
        turns,
        metrics: {
          ...(s.metrics || {}),
          questions: (s.metrics?.questions || 0) + (!exists && turn.question ? 1 : 0)
        }
      };
    }
    return s;
  });
  setItem(KEY_SESSIONS, list);
}

export function getStoredHealth(): Health {
  return {
    status: "ok",
    database: "browser-storage (active)",
    redis: "browser-ephemeral (active)",
    ai_configured: true,
    billing_configured: false
  };
}

/**
 * Handles any HTTP `/api/*` call locally inside the browser.
 */
export async function handleBrowserStorageRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const cleanPath = path.split("?")[0].replace(/\/$/, "");

  // /auth/me
  if (cleanPath === "/auth/me") {
    return getStoredUser() as T;
  }

  // /auth/logout
  if (cleanPath === "/auth/logout") {
    return { ok: true } as T;
  }

  // /auth/account
  if (cleanPath === "/auth/account" && method === "DELETE") {
    setItem(KEY_PROJECTS, defaultProjects());
    setItem(KEY_SOURCES, []);
    setItem(KEY_CHUNKS, []);
    setItem(KEY_SESSIONS, []);
    setItem(KEY_USER, defaultUser());
    return { ok: true } as T;
  }

  // /health
  if (cleanPath === "/health") {
    return getStoredHealth() as T;
  }

  // /provider/check
  if (cleanPath === "/provider/check") {
    return { ok: true, detail: "Browser local mode active. Documents and profile saved securely on your device." } as T;
  }

  // /projects
  if (cleanPath === "/projects") {
    if (method === "GET") {
      return getStoredProjects() as T;
    }
    if (method === "POST") {
      const body = options.body ? JSON.parse(options.body as string) : {};
      return createStoredProject({ name: body.name || "New project", description: body.description }) as T;
    }
  }

  // /projects/:id
  const projectMatch = cleanPath.match(/^\/projects\/([^/]+)$/);
  if (projectMatch && method === "DELETE") {
    deleteStoredProject(projectMatch[1]);
    return { ok: true } as T;
  }

  // /projects/:id/github
  const ghMatch = cleanPath.match(/^\/projects\/([^/]+)\/github$/);
  if (ghMatch && method === "POST") {
    const body = options.body ? JSON.parse(options.body as string) : {};
    return addStoredGithubSource(ghMatch[1], body.url || "") as T;
  }

  // /sources
  if (cleanPath === "/sources") {
    return getStoredSources() as T;
  }

  // /sources/upload
  if (cleanPath === "/sources/upload" && method === "POST") {
    const form = options.body as FormData;
    const file = form.get("file") as File;
    const projectId = form.get("project_id") as string | null;
    return (await uploadStoredSource(file, projectId)) as T;
  }

  // /sources/:id/retry
  const retryMatch = cleanPath.match(/^\/sources\/([^/]+)\/retry$/);
  if (retryMatch && method === "POST") {
    throw new Error("Upload the document again to retry text extraction.");
  }

  // /sources/:id
  const sourceMatch = cleanPath.match(/^\/sources\/([^/]+)$/);
  if (sourceMatch && method === "DELETE") {
    deleteStoredSource(sourceMatch[1]);
    return { ok: true } as T;
  }

  // /knowledge/search?q=...
  if (cleanPath === "/knowledge/search") {
    const url = new URL(`http://localhost${path}`);
    const query = url.searchParams.get("q") || "";
    return searchStoredEvidence(query) as T;
  }

  // /profile
  if (cleanPath === "/profile" && method === "PATCH") {
    const body = options.body ? JSON.parse(options.body as string) : {};
    return updateStoredUser(body) as T;
  }

  // /profile/github/connect
  if (cleanPath === "/profile/github/connect") {
    if (method === "POST") {
      throw new Error("GitHub identity verification requires the full backend.");
    }
    if (method === "DELETE") {
      return updateStoredUser({ github_verified: false, github_verified_username: undefined }) as T;
    }
  }

  // /sessions
  if (cleanPath === "/sessions") {
    if (method === "GET") {
      return getStoredSessions() as T;
    }
    if (method === "POST") {
      const body = options.body ? JSON.parse(options.body as string) : {};
      return createStoredSession({
        title: body.title,
        audio_mode: body.audio_mode,
        retention: body.retention
      }) as T;
    }
  }

  // /sessions/:id/stop
  const stopMatch = cleanPath.match(/^\/sessions\/([^/]+)\/stop$/);
  if (stopMatch && method === "POST") {
    return stopStoredSession(stopMatch[1]) as T;
  }

  // /sessions/:id/ticket
  const ticketMatch = cleanPath.match(/^\/sessions\/([^/]+)\/ticket$/);
  if (ticketMatch && method === "POST") {
    return { ticket: `local_ticket_${Date.now()}` } as T;
  }

  // /sessions/:id
  const sessionMatch = cleanPath.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch) {
    if (method === "GET") {
      const session = getStoredSession(sessionMatch[1]);
      return (session || { id: sessionMatch[1], title: "Conversation", status: "ended", audio_mode: "microphone", retention: true, created_at: new Date().toISOString(), ended_at: null, summary: "", metrics: {}, turns: [] }) as T;
    }
    if (method === "DELETE") {
      deleteStoredSession(sessionMatch[1]);
      return { ok: true } as T;
    }
  }

  // Fallback generic response
  throw new Error(`This operation is unavailable in the browser workspace: ${method} ${cleanPath}`);
}
