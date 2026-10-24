/**
 * Forced to authenticated backend on this deployment. This function
 * deliberately does NOT read NEXT_PUBLIC_WORKSPACE_MODE: Next.js lets
 * dashboard/.env values override next.config.ts env, so the previous
 * "force backend in next.config" change was still overridden by the
 * dashboard's browser setting, and production kept serving Candidate /
 * Local Preview with unlimited minutes (and preview plans, so plan
 * buttons linked to /contact). Returning false here is the only
 * code-level guarantee. To re-enable the browser demo, change this
 * function, not an env var.
 */
export function isBrowserWorkspace(): boolean {
  return false;
}
