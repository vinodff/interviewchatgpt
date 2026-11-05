import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionExchange, oauthReturnUrl } from "../lib/auth-flow";

afterEach(() => vi.useRealTimers());

describe("authentication destinations", () => {
  it.each(["starter", "pro", "value"])("preserves the selected %s plan through Google login", plan => {
    expect(oauthReturnUrl({ origin: "https://interview.example", search: `?view=billing&plan=${plan}&signup=1` })).toBe(`https://interview.example/interview?view=billing&plan=${plan}&signup=1`);
  });
  it("keeps live interviews and legacy billing destinations", () => {
    expect(oauthReturnUrl({ origin: "https://interview.example", search: "?view=live" })).toBe("https://interview.example/interview?view=live");
    expect(oauthReturnUrl({ origin: "https://interview.example", search: "?billing=success&plan=starter" })).toBe("https://interview.example/interview?view=billing&plan=starter");
  });
  it("never forwards reset tokens or arbitrary return URLs", () => {
    expect(oauthReturnUrl({ origin: "https://interview.example", search: "?view=https://attacker.test&plan=admin&reset=sensitive-token&next=https://attacker.test&access_token=secret" })).toBe("https://interview.example/interview");
  });
});

describe("Google session exchange lifecycle", () => {
  it("returns outside the provider callback before exchanging and coalesces initial-session events", async () => {
    vi.useFakeTimers();
    const exchange = vi.fn().mockResolvedValue({ id: "candidate" });
    const handlers = { busy: vi.fn(), authenticated: vi.fn(), failed: vi.fn() };
    const sync = createSessionExchange(exchange, handlers);
    sync.queue("same-token"); sync.queue("same-token");
    expect(exchange).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    sync.queue("same-token");
    await vi.runAllTimersAsync();
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(handlers.authenticated).toHaveBeenCalledExactlyOnceWith({ id: "candidate" });
    expect(handlers.busy.mock.calls).toEqual([[true], [false]]);
  });
  it("cancels a stale exchange and never applies its late response", async () => {
    vi.useFakeTimers();
    let finishOld: (value: string) => void = () => {};
    const old = new Promise<string>(resolve => { finishOld = resolve; });
    const exchange = vi.fn((token: string, signal: AbortSignal) => { void signal; return token === "old" ? old : Promise.resolve("new-user"); });
    const handlers = { busy: vi.fn(), authenticated: vi.fn(), failed: vi.fn() };
    const sync = createSessionExchange(exchange, handlers);
    sync.queue("old"); await vi.advanceTimersByTimeAsync(0);
    const oldSignal = exchange.mock.calls[0][1];
    sync.queue("new"); await vi.advanceTimersByTimeAsync(0);
    expect(oldSignal.aborted).toBe(true);
    finishOld("old-user"); await Promise.resolve();
    expect(handlers.authenticated.mock.calls).toEqual([["new-user"]]);
  });
  it("aborts active work on unmount and permits retry after a failed exchange", async () => {
    vi.useFakeTimers();
    const exchange = vi.fn().mockRejectedValueOnce(new Error("Unavailable")).mockImplementation(() => new Promise(() => {}));
    const handlers = { busy: vi.fn(), authenticated: vi.fn(), failed: vi.fn() };
    const sync = createSessionExchange(exchange, handlers);
    sync.queue("token"); await vi.runAllTimersAsync();
    expect(handlers.failed).toHaveBeenCalledTimes(1);
    sync.queue("token"); await vi.advanceTimersByTimeAsync(0);
    expect(exchange).toHaveBeenCalledTimes(2);
    const signal = exchange.mock.calls[1][1] as AbortSignal;
    sync.dispose();
    expect(signal.aborted).toBe(true);
    sync.queue("another-token"); await vi.runAllTimersAsync();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(handlers.authenticated).not.toHaveBeenCalled();
  });
});
