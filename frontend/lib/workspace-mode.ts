/** Forced to authenticated backend by next.config.ts on this deployment; browser storage is disabled here. */
export function isBrowserWorkspace(): boolean {
  return process.env.NEXT_PUBLIC_WORKSPACE_MODE === "browser";
}
