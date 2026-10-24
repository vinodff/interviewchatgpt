/** Chosen at build time: browser storage only when explicitly opted in, otherwise authenticated backend. */
export function isBrowserWorkspace(): boolean {
  return process.env.NEXT_PUBLIC_WORKSPACE_MODE === "browser";
}
