/**
 * TEMPORARY REVERT to browser / local-preview mode, at the user's
 * instruction, so the site works now. The FastAPI backend is
 * unreachable from Vercel (503), so account mode cannot log in, show
 * real minutes, or open checkout. In this mode the site uses the
 * Candidate local workspace with unlimited minutes, AI via the server
 * Gemini route, and preview plans (plan buttons link to /contact).
 * This function deliberately does NOT read NEXT_PUBLIC_WORKSPACE_MODE:
 * dashboard/.env values override next.config.ts env, so env-based
 * switching proved unreliable. To restore account mode once the
 * backend is hosted, change this function to return false — do not
 * rely on an env var.
 */
export function isBrowserWorkspace(): boolean {
  return true;
}
