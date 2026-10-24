import { ApiError } from "./api";
import { supabase } from "./supabase";
import type { User } from "./types";

/**
 * Supabase identity for the Vercel + Supabase version. The browser holds
 * the Supabase session (Google sign-in); the server route under
 * /api/supabase/me validates that JWT itself and never trusts a
 * caller-supplied user id or email (the old backend /auth/supabase-session
 * flaw, CR-1, is not repeated here).
 *
 * This call deliberately bypasses lib/api's browser-storage interception:
 * /api/supabase/me is a real server route even though the live-AI path
 * stays in browser mode (see lib/workspace-mode.ts).
 */
export async function fetchSupabaseMe(): Promise<User> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError("Sign in is required or your credentials were not accepted.", 401);
  const response = await fetch("/api/supabase/me", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === "string") detail = body.detail; } catch { /* use status message */ }
    throw new ApiError(detail || (response.status >= 500 ? "We can’t connect to the interview service. Please try again in a moment." : "The server could not complete this request."), response.status);
  }
  return await response.json() as User;
}
