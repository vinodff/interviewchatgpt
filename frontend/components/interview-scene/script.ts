/** The scripted demo conversation shown on the laptop and phone screens. */

export const INTERVIEWER = { name: "Sarah", role: "Hiring manager" };
export const MEETING_TITLE = "Frontend Engineer · Final round";
export const QUESTION = "Tell me about a project you’re proud of. What was your role, and what was the impact?";
export const ANSWER_TITLE = "Lead with the dashboard rebuild.";
export const QUESTION_TYPE = "Behavioral · Project";
export const SOURCES = "resume.pdf · Projects";

export const ANSWER_PARTS = [
  { label: "SITUATION", text: "Our sales dashboard took six seconds to load, and 40 managers relied on it every morning." },
  { label: "ACTION", text: "I designed the reporting API, moved heavy queries to a cache, and paired with two teammates on rollout." },
  { label: "RESULT", text: "Load time dropped to about one second and weekly usage doubled." },
] as const;

export const QUESTION_WORD_COUNT = QUESTION.split(" ").length;
export const ANSWER_WORD_COUNT = ANSWER_PARTS.reduce((sum, part) => sum + part.text.split(" ").length, 0);

/** Index of the first word of each answer part within the whole answer. */
export const ANSWER_PART_STARTS = ANSWER_PARTS.reduce<number[]>((starts, part, index) => {
  const previous = index === 0 ? 0 : starts[index - 1] + ANSWER_PARTS[index - 1].text.split(" ").length;
  return [...starts, previous];
}, []);
