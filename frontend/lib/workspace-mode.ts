/**
 * Live-AI path stays in browser mode: live answers, transcription and
 * streaming speech run through the Vercel Gemini routes in
 * app/api/[...path]/route.ts, with no FastAPI backend.
 *
 * Identity does NOT come from here. The invented Candidate user that
 * browser mode used to return from /auth/me is bypassed: the workspace
 * now loads the real signed-in user from the Vercel
 * /api/supabase/me route (verified Supabase JWT, Supabase users +
 * usage_buckets tables), and shows the Auth screen with Google sign-in
 * when there is no Supabase session. So a signed-in user sees their own
 * name, plan and minutes — never "Candidate / Local Preview" — even
 * though isBrowserWorkspace() is still true for the live-AI path.
 *
 * This function deliberately does NOT read NEXT_PUBLIC_WORKSPACE_MODE:
 * dashboard/.env values override next.config.ts env, so env-based
 * switching proved unreliable.
 */
export function isBrowserWorkspace(): boolean {
  return true;
}
