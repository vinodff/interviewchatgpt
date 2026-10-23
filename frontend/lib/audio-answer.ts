import type { InterviewContext } from "./interview-memory";
import type { Preferences } from "./types";

export type AudioReply = { requests_answer: boolean; speaker_role: "user" | "interviewer" | "unknown"; question: string; answer: string };
export type AudioAnswerContext = { preferences: Preferences; interview_context: InterviewContext; prefix: string };
export type PreparedAudioReply = {
  reply: AudioReply; started_at: number; preferences_key: string; task_key: string;
  stream?: { subscribe: (listener: (reply: AudioReply) => void) => () => void; completion: Promise<AudioReply> };
};
export const audioTaskKey = (context: InterviewContext) => JSON.stringify({ count: context.answered_count, task: context.active_task });

export function validAudioReply(value: unknown): value is AudioReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.requests_answer === "boolean" && ["user", "interviewer", "unknown"].includes(String(reply.speaker_role))
    && typeof reply.question === "string" && reply.question.length <= 4000 && typeof reply.answer === "string" && reply.answer.length <= 16000
    && (!reply.requests_answer || Boolean(reply.question.trim() && reply.answer.trim()));
}
