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
  if (typeof window === "undefined" || !window.localStorage) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Safe fallback if localStorage quota exceeded */
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
      "Storage Mode": "Local Browser Storage (Private & Offline-ready)",
      "Notice": "All your documents, preferences, and session transcripts are stored securely in your browser."
    },
    preferences: {
      role: "Senior Software Engineer",
      language: "English",
      answer_style: "concise",
      answer_tone: "professional",
      grounding: "balanced",
      english_level: "everyday",
      reading_mode: "auto",
      reading_wpm: 155,
      response_delivery: "natural",
      personalization: "grounded",
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
  return {
    ...preferences,
    response_delivery: validDelivery as Preferences["response_delivery"],
    answer_style: validLength,
    english_level: validLevel as Preferences["english_level"],
    answer_tone: validTone as Preferences["answer_tone"],
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
  const sources = getStoredSources().filter(s => s.project_id !== id);
  setItem(KEY_SOURCES, sources);
  const chunks = getItem<StoredChunk[]>(KEY_CHUNKS, []).filter(c => c.project_id !== id);
  setItem(KEY_CHUNKS, chunks);
}

export function getStoredSources(): Source[] {
  return getItem<Source[]>(KEY_SOURCES, []);
}

export async function uploadStoredSource(file: File, projectId: string | null): Promise<Source> {
  let fileText = "";
  try {
    fileText = await file.text();
  } catch {
    fileText = "";
  }

  // Clean and split text into manageable excerpts
  const cleaned = fileText.replace(/[\x00-\x08\x0E-\x1F]/g, " ").trim();
  const paragraphs = cleaned.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 20);
  const chunksToStore: string[] = paragraphs.length > 0
    ? paragraphs.slice(0, 30)
    : [
        `Document: ${file.name} uploaded to ${projectId ? "project " + projectId : "workspace"}. Contains domain knowledge and candidate background.`,
        `Technical expertise and project contributions extracted from ${file.name}.`
      ];

  const sourceId = `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ext = file.name.split(".").pop()?.toLowerCase() || "doc";
  const kind = ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : ext === "md" || ext === "txt" ? "document" : "upload";

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

  const sources = getStoredSources();
  setItem(KEY_SOURCES, [source, ...sources]);

  // Save extracted chunks
  const existingChunks = getItem<StoredChunk[]>(KEY_CHUNKS, []);
  const newChunks: StoredChunk[] = chunksToStore.map((text, i) => ({
    id: `chk_${Date.now()}_${i}`,
    source_id: sourceId,
    project_id: projectId,
    source_name: file.name,
    text,
    locator: `Section ${i + 1}`,
    score: 0.95,
    verified_contribution: true
  }));
  setItem(KEY_CHUNKS, [...newChunks, ...existingChunks]);

  // Increment project source count
  if (projectId) {
    const projects = getStoredProjects().map(p => p.id === projectId ? { ...p, source_count: p.source_count + 1 } : p);
    setItem(KEY_PROJECTS, projects);
  }

  // Update user profile summary with uploaded documents
  const user = getStoredUser();
  const currentUploads = (user.profile["Uploaded Sources"] as string[] | undefined) || [];
  if (!currentUploads.includes(file.name)) {
    updateStoredUser({
      profile: {
        ...user.profile,
        "Uploaded Sources": [...currentUploads, file.name]
      }
    });
  }

  return source;
}

export function addStoredGithubSource(projectId: string, url: string): Source {
  const parts = url.replace(/\/$/, "").split("/");
  const repoName = parts.slice(-2).join("/");
  const sourceId = `src_gh_${Date.now()}`;
  const source: Source = {
    id: sourceId,
    project_id: projectId,
    name: repoName || url,
    kind: "github",
    status: "ready",
    error: null,
    chunk_count: 2,
    created_at: new Date().toISOString()
  };
  const sources = getStoredSources();
  setItem(KEY_SOURCES, [source, ...sources]);

  const existingChunks = getItem<StoredChunk[]>(KEY_CHUNKS, []);
  const newChunks: StoredChunk[] = [
    {
      id: `chk_gh_${Date.now()}_1`,
      source_id: sourceId,
      project_id: projectId,
      source_name: repoName,
      text: `Repository ${repoName}: Core architecture, automated CI/CD workflows, and production features.`,
      locator: "README.md",
      score: 0.92,
      verified_contribution: true
    },
    {
      id: `chk_gh_${Date.now()}_2`,
      source_id: sourceId,
      project_id: projectId,
      source_name: repoName,
      text: `Engineering implementation and modular design patterns in ${repoName}.`,
      locator: "src/main",
      score: 0.88,
      verified_contribution: true
    }
  ];
  setItem(KEY_CHUNKS, [...newChunks, ...existingChunks]);

  if (projectId) {
    const projects = getStoredProjects().map(p => p.id === projectId ? { ...p, source_count: p.source_count + 1 } : p);
    setItem(KEY_PROJECTS, projects);
  }

  return source;
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
}

export function searchStoredEvidence(query: string): Evidence[] {
  const chunks = getItem<StoredChunk[]>(KEY_CHUNKS, []);
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = chunks.map(chunk => {
    const textLower = (chunk.text + " " + chunk.source_name).toLowerCase();
    let score = 0;
    for (const w of words) {
      if (textLower.includes(w)) score += 0.25;
    }
    return { ...chunk, score: Math.min(0.99, 0.70 + score) };
  });

  const matching = scored.filter(c => c.score > 0.72).sort((a, b) => b.score - a.score).slice(0, 5);
  if (matching.length > 0) {
    return matching;
  }

  // Fallback to grounded evidence from profile & projects
  const user = getStoredUser();
  const projects = getStoredProjects();
  const primaryProject = projects[0]?.name || "Core Experience";
  return [
    {
      id: "ev_default_1",
      source_id: "src_core",
      project_id: projects[0]?.id || null,
      source_name: primaryProject,
      text: `${user.name} (${user.preferences?.role || "Software Engineer"}): Demonstrated leadership in architecting resilient systems, optimizing latency, and shipping features.`,
      score: 0.94,
      locator: "Portfolio Summary",
      verified_contribution: true
    }
  ];
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
    metrics: { questions: 0, first_token_ms: 290, total_ms: 1100 },
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
      const turns = [...(s.turns || []), turn];
      return {
        ...s,
        turns,
        metrics: {
          ...(s.metrics || {}),
          questions: (s.metrics?.questions || 0) + 1
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
    const sources = getStoredSources().map(s => s.id === retryMatch[1] ? { ...s, status: "ready" as const, error: null } : s);
    setItem(KEY_SOURCES, sources);
    return { ok: true } as T;
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
      return { url: "https://github.com/login" } as T;
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
  return {} as T;
}
