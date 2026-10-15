export type User = {
  id: string; email: string; name: string; plan: string; github_username: string;
  profile: Record<string, unknown>; preferences?: Preferences; minutes_used: number; minute_limit: number | null; testing_mode?: boolean;
  github_verified?: boolean; github_verified_username?: string;
};
export type Preferences = { role?: string; language?: string; answer_style?: string; job_description?: string; answer_tone?: "professional" | "friendly" | "casual"; grounding?: "balanced" | "strict"; english_level?: "simple" | "everyday" | "advanced"; reading_mode?: "auto" | "speech" | "paced" | "off"; reading_wpm?: number; response_delivery?: "natural" | "talking_points" | "structured"; personalization?: "grounded" | "technical" };
export type Project = { id: string; name: string; description: string; analysis: Record<string, unknown>; source_count: number; created_at: string };
export type Source = { id: string; project_id: string | null; name: string; kind: string; status: "queued" | "processing" | "ready" | "failed"; error: string | null; chunk_count: number; created_at: string };
export type Evidence = { id: string; source_id: string; project_id: string | null; source_name: string; text: string; score: number; locator: string; verified_contribution: boolean; retrieval_mode?: string; retrieval_warning?: string };
export type Session = { id: string; title: string; status: "created" | "live" | "ended"; audio_mode: "microphone" | "tab"; retention: boolean; created_at: string; ended_at: string | null; summary: string; metrics: Record<string, number>; turns?: Turn[] };
export type Turn = { id: string; role: "interviewer" | "user" | "unknown"; text: string; question?: string; answer?: string; evidence?: Evidence[]; created_at: string };
export type Health = { status: string; database: string; redis: string; ai_configured: boolean; billing_configured: boolean };
