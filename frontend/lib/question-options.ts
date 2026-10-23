import { briefTopicRequest } from "./speech-request";
export type QuestionOption = { id: string; question: string; confirmed: boolean; source_id: string | null };
export function questionOptionKey(text: string): string {
  const topic = text.toLowerCase().replace(/^(?:what (?:is|are)\s+(?:(?:a|an|the)\s+)?|explain\s+)/, "");
  return (briefTopicRequest(topic) || topic).toLowerCase().replace(/^explain\s+/, "").replace(/[^a-z0-9+# ]/g, "").replace(/\s+/g, " ").trim();
}

export function questionMentionsTopic(question: string, topic: string): boolean {
  const words = (text: string) => questionOptionKey(text).split(" ").filter(word => word && !["a", "an", "the", "in", "using"].includes(word)).map(word => /ies$/.test(word) ? word.slice(0, -3) + "y" : /sses$/.test(word) ? word.slice(0, -2) : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  const questionWords = new Set(words(question));
  const topicWords = words(topic);
  return topicWords.length > 0 && topicWords.every(word => questionWords.has(word));
}

/** Correct provisional options in place while retaining confirmed recent questions. */
export function rememberQuestionOptions(current: QuestionOption[], questions: string[], sourceId: string | null, confirmed = false): QuestionOption[] {
  const provisional = current.filter(item => !item.confirmed && item.source_id === sourceId);
  const next = current.filter(item => confirmed || item.confirmed || item.source_id !== sourceId);
  for (const [position, raw] of questions.entries()) {
    const question = raw.trim().slice(0, 300); if (!question) continue;
    const key = questionOptionKey(question);
    const index = next.findIndex(item => questionOptionKey(item.question) === key);
    if (index >= 0) {
      if (confirmed) { const [previous] = next.splice(index, 1); next.push({ ...previous, question, confirmed: true }); }
    } else {
      const preferredId = sourceId === null ? `confirmed:${key}` : provisional[position]?.id || `${sourceId}:${position}`;
      let id = preferredId; let suffix = 1;
      while (next.some(item => item.id === id)) id = `${preferredId}:${suffix++}`;
      next.push({ id, question, confirmed, source_id: sourceId });
    }
  }
  return next.slice(-8);
}
