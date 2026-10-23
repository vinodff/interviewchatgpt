/** Chosen at build time: browser storage on standalone Vercel, or authenticated backend. */
export function isBrowserWorkspace(): boolean {
  return process.env.NEXT_PUBLIC_WORKSPACE_MODE === "browser";
}
