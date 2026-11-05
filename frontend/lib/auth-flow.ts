import { interviewViews } from "./interview-navigation";

/** Keep the user's destination without forwarding tokens or arbitrary redirects. */
export function oauthReturnUrl(location: { origin: string; search: string }): string {
  const current = new URLSearchParams(location.search);
  const destination = new URL("/interview", location.origin);
  const view = current.get("view");
  if (interviewViews.includes(view as typeof interviewViews[number])) destination.searchParams.set("view", view!);
  else if (current.has("billing")) destination.searchParams.set("view", "billing");
  const plan = current.get("plan");
  if (plan === "starter" || plan === "pro" || plan === "value") destination.searchParams.set("plan", plan);
  if (current.get("signup") === "1") destination.searchParams.set("signup", "1");
  return destination.toString();
}

/** Defer auth events outside the provider's lock and coalesce duplicate callbacks. */
export function createSessionExchange<T>(
  exchange: (token: string, signal: AbortSignal) => Promise<T>,
  handlers: { busy: (value: boolean) => void; authenticated: (value: T) => void; failed: (error: unknown) => void },
) {
  let disposed = false;
  let lastToken: string | null = null;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    queue(token: string | null | undefined) {
      if (disposed || !token || token === lastToken) return;
      lastToken = token;
      if (timer) clearTimeout(timer);
      request?.abort();
      const current = new AbortController(); request = current;
      timer = setTimeout(() => {
        timer = null;
        if (disposed || current.signal.aborted) return;
        handlers.busy(true);
        void exchange(token, current.signal).then(value => {
          if (!disposed && !current.signal.aborted) handlers.authenticated(value);
        }).catch(error => {
          if (!disposed && !current.signal.aborted) { lastToken = null; handlers.failed(error); }
        }).finally(() => {
          if (!disposed && request === current) handlers.busy(false);
        });
      }, 0);
    },
    dispose() { disposed = true; if (timer) clearTimeout(timer); request?.abort(); },
  };
}
