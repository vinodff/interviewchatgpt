import { questionOptionKey } from "./question-options";
import { embeddedRequest, trailingTopicRequest } from "./speech-request";

const MAX_ANSWERED = 24;
const MAX_LISTED = 8;

/** Canonical key for what the speech asks about, or null when it asks nothing. */
export function requestTopicKey(text: string): string | null {
  const request = trailingTopicRequest(text) || embeddedRequest(text, true);
  if (!request) return null;
  return questionOptionKey(request.replace(/[?.!]+\s*$/, "")) || null;
}

/** True when speech contains a request cue, even if spoken in the first person. */
export function hasExplicitRequest(text: string): boolean {
  return requestTopicKey(text) !== null;
}

type CachedAnswer = { question: string; answer: string };

/**
 * Remembers which questions were already answered (or are being answered) in this
 * interview, so a repeated or echoed question keeps the current answer instead of
 * paying for and showing a new one.
 */
export class AnsweredQuestions {
  private answered = new Map<string, CachedAnswer>();
  private inFlight = new Map<number, string>();

  reset(): void { this.answered.clear(); this.inFlight.clear(); }

  isRepeat(text: string): boolean {
    const key = requestTopicKey(text);
    if (!key) return false;
    return this.answered.has(key) || [...this.inFlight.values()].includes(key);
  }

  start(sequence: number, text: string): void {
    const key = requestTopicKey(text);
    if (key) this.inFlight.set(sequence, key);
  }

  drop(sequence: number): void { this.inFlight.delete(sequence); }

  finish(sequence: number, question: string, answer: string): void {
    const keys = new Set([this.inFlight.get(sequence), requestTopicKey(question)].filter((key): key is string => Boolean(key)));
    this.inFlight.delete(sequence);
    for (const key of keys) {
      this.answered.delete(key);
      this.answered.set(key, { question, answer });
    }
    while (this.answered.size > MAX_ANSWERED) this.answered.delete(this.answered.keys().next().value!);
  }

  cached(text: string): CachedAnswer | null {
    const key = requestTopicKey(text) ?? questionOptionKey(text);
    return (key && this.answered.get(key)) || null;
  }

  /** Most recent distinct answered questions, oldest first, for the model prompt. */
  recent(): string[] {
    return [...new Set([...this.answered.values()].map(item => item.question))].slice(-MAX_LISTED);
  }
}
