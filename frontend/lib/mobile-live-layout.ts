export const ANSWER_HEIGHT_DEFAULT = 30;
export const ANSWER_HEIGHT_MIN = 15;
export const ANSWER_HEIGHT_MAX = 70;
export const ANSWER_HEIGHT_KEY = "interviewpilot.live.answer-height";

export function clampAnswerHeight(value: number) {
  return Number.isFinite(value) ? Math.min(ANSWER_HEIGHT_MAX, Math.max(ANSWER_HEIGHT_MIN, Math.round(value))) : ANSWER_HEIGHT_DEFAULT;
}

export function readAnswerHeight(value: string | null) {
  return value === null || value.trim() === "" ? ANSWER_HEIGHT_DEFAULT : clampAnswerHeight(Number(value));
}

export function answerHeightFromPointer(clientY: number, top: number, height: number) {
  return height > 0 ? clampAnswerHeight((clientY - top) / height * 100) : ANSWER_HEIGHT_DEFAULT;
}

export function answerHeightFromDrag(initial: number, startY: number, clientY: number, height: number) {
  return height > 0 ? clampAnswerHeight(initial + (clientY - startY) / height * 100) : clampAnswerHeight(initial);
}

export function displayedAnswerHeight(preferred: number, viewportHeight: number | null) {
  if (viewportHeight === null || viewportHeight <= 0) return clampAnswerHeight(preferred);
  // Leave room for pinned controls and a usable scrolling area above a mobile keyboard.
  const maximum = Math.floor((viewportHeight - 228) / viewportHeight * 100);
  return Math.min(clampAnswerHeight(preferred), Math.max(ANSWER_HEIGHT_MIN, maximum));
}

export function answerHeightFromKey(value: number, key: string): number | null {
  if (key === "Home") return ANSWER_HEIGHT_MIN;
  if (key === "End") return ANSWER_HEIGHT_MAX;
  if (key === "ArrowDown" || key === "ArrowRight") return clampAnswerHeight(value + 5);
  if (key === "ArrowUp" || key === "ArrowLeft") return clampAnswerHeight(value - 5);
  if (key === "PageDown") return clampAnswerHeight(value + 10);
  if (key === "PageUp") return clampAnswerHeight(value - 10);
  return null;
}
