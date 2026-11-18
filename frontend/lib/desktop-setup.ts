import type { Preferences, Source } from "./types";

/** Everything chosen in the desktop setup steps before a session goes live. */
export type DesktopSetup = {
  sessionType: "interview" | "meeting";
  company: string;
  role: string;
  language: string;
  model: "fast" | "smart";
  /** null = continue without a resume. */
  resumeId: string | null;
  docIds: string[];
  humanize: boolean;
  glance: boolean;
  autoAnswer: boolean;
  /** Global keyboard shortcuts while live (Ctrl+G for Glance always works). */
  shortcuts: boolean;
  customInstructions: string;
  /** "" = the system default microphone. */
  microphoneId: string;
};

export const SETUP_STORAGE_KEY = "iw.desktop.setup.v1";
export const CUSTOM_INSTRUCTIONS_LIMIT = 2000;
const TEXT_LIMIT = 120;
const MAX_DOCS = 10;
/** Answer languages. Speech recognition itself is tuned for English. */
export const ANSWER_LANGUAGES = ["English", "Hindi", "Telugu", "Tamil", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati", "Spanish", "French", "German", "Portuguese", "Japanese"] as const;

export const DEFAULT_SETUP: DesktopSetup = {
  sessionType: "interview", company: "", role: "", language: "English", model: "fast",
  resumeId: null, docIds: [], humanize: true, glance: false, autoAnswer: true, shortcuts: true, customInstructions: "", microphoneId: "",
};

const text = (value: unknown, limit = TEXT_LIMIT) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit) : "";
const id = (value: unknown) => typeof value === "string" && /^[\w-]{1,64}$/.test(value) ? value : null;
const flag = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;

/** Parse a stored setup, keeping only valid fields. Profile preferences fill what storage lacks. */
export function readSetup(stored: string | null, preferences: Preferences = {}): DesktopSetup {
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>;
  } catch { /* A corrupt entry falls back to defaults. */ }
  const language = text(saved.language ?? preferences.language);
  return {
    sessionType: (saved.sessionType ?? preferences.session_type) === "meeting" ? "meeting" : "interview",
    company: text(saved.company ?? preferences.company),
    role: text(saved.role ?? preferences.role),
    language: (ANSWER_LANGUAGES as readonly string[]).includes(language) ? language : "English",
    model: (saved.model ?? preferences.answer_model) === "smart" ? "smart" : "fast",
    resumeId: id(saved.resumeId),
    docIds: Array.isArray(saved.docIds) ? [...new Set(saved.docIds.map(id).filter((value): value is string => value !== null))].slice(0, MAX_DOCS) : [],
    humanize: flag(saved.humanize ?? preferences.humanize, DEFAULT_SETUP.humanize),
    glance: flag(saved.glance, DEFAULT_SETUP.glance),
    autoAnswer: flag(saved.autoAnswer, DEFAULT_SETUP.autoAnswer),
    shortcuts: flag(saved.shortcuts, DEFAULT_SETUP.shortcuts),
    customInstructions: text(saved.customInstructions ?? preferences.custom_instructions, CUSTOM_INSTRUCTIONS_LIMIT),
    microphoneId: typeof saved.microphoneId === "string" && saved.microphoneId.length <= 256 ? saved.microphoneId : "",
  };
}

/** Drop selections whose sources were deleted or are not ready. */
export function withAvailableSources(setup: DesktopSetup, sources: Source[]): DesktopSetup {
  const ready = new Set(sources.filter(source => source.status === "ready").map(source => source.id));
  const resumeId = setup.resumeId && ready.has(setup.resumeId) ? setup.resumeId : null;
  const docIds = setup.docIds.filter(doc => ready.has(doc) && doc !== resumeId);
  return resumeId === setup.resumeId && docIds.length === setup.docIds.length ? setup : { ...setup, resumeId, docIds };
}

/** Sources the answers may cite. An empty list means answers use no uploaded knowledge. */
export function knowledgeSourcesOf(setup: DesktopSetup): string[] {
  return [...new Set([...(setup.resumeId ? [setup.resumeId] : []), ...setup.docIds])];
}

/** The answer-shaping preferences for this session, layered over the saved profile. */
export function setupPreferences(setup: DesktopSetup, base: Preferences = {}): Preferences {
  return {
    ...base,
    session_type: setup.sessionType,
    company: setup.company,
    role: setup.role,
    language: setup.language,
    answer_model: setup.model,
    humanize: setup.humanize,
    custom_instructions: setup.customInstructions,
    // Without any uploaded knowledge, personal claims cannot be grounded: keep answers technical.
    ...(knowledgeSourcesOf(setup).length === 0 ? { personalization: "technical" as const } : {}),
  };
}

export function sessionTitle(setup: DesktopSetup): string {
  const kind = setup.sessionType === "meeting" ? "Meeting" : "Interview";
  const detail = [setup.company, setup.role].filter(Boolean).join(" · ");
  return detail ? `${kind} · ${detail}` : `${kind} (desktop)`;
}

/**
 * Speech errors are written for the web app, which offers other microphone engines ("Select Enhanced
 * microphone"). The desktop app has one engine, so give advice that works there.
 */
export function desktopMessage(message: string): string {
  return message
    .replace(/,?\s*or select Enhanced microphone\.?/gi, ".")
    .replace(/\s*Select Enhanced microphone and restart\.?/gi, " Check your internet connection, then start the session again.")
    .trim();
}

/** A resume is any ready source whose name or type looks like one; the rest are reference docs. */
export function looksLikeResume(source: Source): boolean {
  return /\b(resume|résumé|cv|curriculum)\b/i.test(source.name);
}
