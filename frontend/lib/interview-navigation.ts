export const interviewViews = ["overview", "live", "library", "history", "profile", "billing"] as const;
export type InterviewView = typeof interviewViews[number];

export function interviewView(value: string | null | undefined): InterviewView {
  return interviewViews.includes(value as InterviewView) ? value as InterviewView : "overview";
}

export function interviewUrl(view: InterviewView): string { return `/interview?view=${view}`; }

/** Keep incoming sign-in, password-reset, and billing links while retiring the old name. */
export function legacyInterviewUrl(values: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) value.forEach(item => query.append(key, item));
  }
  if (query.has("billing") && !query.has("view")) query.set("view", "billing");
  return `/interview${query.size ? `?${query}` : ""}`;
}
