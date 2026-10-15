import { useCallback, useEffect, useRef } from "react";
import { api } from "./api";

// Cancel requests when an authenticated surface unmounts. In particular, a
// sequential file batch must never continue using a newly signed-in user's cookie.
export function useOwnedApi() {
  const active = useRef(true);
  const pending = useRef(new Set<AbortController>());
  useEffect(() => {
    active.current = true;
    const requests = pending.current;
    return () => { active.current = false; requests.forEach(request => request.abort()); requests.clear(); };
  }, []);
  return useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    if (!active.current) throw new DOMException("This workspace action was cancelled.", "AbortError");
    const request = new AbortController(); pending.current.add(request);
    try {
      const result = await api<T>(path, { ...options, signal: request.signal });
      if (!active.current) throw new DOMException("This workspace action was cancelled.", "AbortError");
      return result;
    } finally { pending.current.delete(request); }
  }, []);
}
