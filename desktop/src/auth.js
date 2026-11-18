"use strict";

// Google sign-in in the system browser (Google refuses embedded sign-in windows).
// Flow: PKCE OAuth URL → system browser → Google/Supabase redirect to a loopback server
// on this machine → exchange the code for a session → hand the session to the app window.

const http = require("node:http");
const { shell } = require("electron");
const { createClient } = require("@supabase/supabase-js");
const { SUPABASE_URL, SUPABASE_ANON_KEY, LOOPBACK_PORT, CALLBACK_PATH, REDIRECT_URL } = require("./config");

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

// supabase-js keeps the PKCE verifier here between building the URL and exchanging the code.
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The page the browser shows after sign-in. Every dynamic value is escaped. */
function resultPage(ok, title, body) {
  const accent = ok ? "#15675b" : "#c2412f";
  const mark = ok
    ? '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M7 7l10 10M17 7L7 17" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · InterviewWin</title>
<style>
:root{--paper:#f7f7f2;--ink:#1b2f29;--muted:#5d6d64;--line:#e0dfd3}
@media (prefers-color-scheme:dark){:root{--paper:#121a17;--ink:#edf3ef;--muted:#a8b8af;--line:#2f3d37}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper);color:var(--ink);font:15px/1.6 "Segoe UI",system-ui,-apple-system,Arial,sans-serif}
main{max-width:380px;text-align:center}.mark{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:18px;background:${accent};box-shadow:0 14px 30px -14px ${accent}}
h1{margin:0 0 8px;font:400 28px/1.2 Georgia,"Times New Roman",serif;letter-spacing:-.02em}p{margin:0;color:var(--muted)}small{display:block;margin-top:28px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
</style>
<main><div class="mark"><svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">${mark}</svg></div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><small>InterviewWin desktop</small></main></html>`;
}

let active = null; // { server, timer, onError } so a new attempt cancels the previous one

function cancel(reason) {
  if (!active) return;
  const { server, timer, onError } = active;
  active = null;
  clearTimeout(timer);
  try { server.close(); } catch { /* already closed */ }
  if (reason && onError) onError(new Error(reason));
}

/**
 * Starts Google sign-in in the system browser. A new call replaces any unfinished attempt.
 * @param {{ onSession: (session: object) => void, onError: (error: Error) => void }} handlers
 * @returns {Promise<void>} resolves once the browser has been asked to open
 */
async function startExternalGoogleLogin({ onSession, onError }) {
  if (!SUPABASE_ANON_KEY) throw new Error("Google sign-in isn't set up in this build. Use email and password, or ask support for an updated app.");
  cancel();

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { flowType: "pkce", storage: memoryStorage(), persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Any web page can send requests to this loopback address, so a missing, refused or invalid callback
  // never cancels the attempt: only a successful PKCE exchange (bound to our in-memory verifier) ends it.
  // The user can always restart from the window; an untouched attempt times out on its own.
  let exchanging = false;
  const server = http.createServer(async (req, res) => {
    const respond = (ok, title, body) => {
      if (res.headersSent) return;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end(resultPage(ok, title, body));
    };
    try {
      let url;
      try { url = new URL(req.url || "/", `http://127.0.0.1:${LOOPBACK_PORT}`); } catch { res.writeHead(400); res.end(); return; }
      if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) { res.writeHead(404); res.end(); return; }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("error")) {
        respond(false, "Sign-in didn’t finish", "You can close this tab and try again from the InterviewWin window.");
        return;
      }
      if (exchanging) { respond(false, "Already signing in", "Go back to the InterviewWin window."); return; }
      exchanging = true;
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error || !data || !data.session) {
        exchanging = false;
        respond(false, "Sign-in didn’t finish", "The sign-in link expired or was already used. Try again from the InterviewWin window.");
        return;
      }
      const meta = (data.session.user && data.session.user.user_metadata) || {};
      const name = meta.full_name || meta.name;
      respond(true, name ? `You’re all set, ${String(name).split(" ")[0]}` : "You’re all set", "Close this tab and go back to InterviewWin — it’s already signed in.");
      cancel();
      onSession(data.session);
    } catch {
      exchanging = false;
      respond(false, "Sign-in didn’t finish", "Something went wrong. Try again from the InterviewWin window.");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", (error) => reject(error && error.code === "EADDRINUSE"
      ? new Error("Another sign-in is still open on this computer. Close other InterviewWin windows and try again.")
      : new Error("Sign-in couldn't start on this computer. Try again.")));
    server.listen(LOOPBACK_PORT, "127.0.0.1", resolve);
  });
  // Without this, an abandoned browser tab used to leave sign-in stuck until the app restarted.
  const timer = setTimeout(() => cancel("Sign-in timed out. Try again."), LOGIN_TIMEOUT_MS);
  active = { server, timer, onError };

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true, queryParams: { access_type: "offline", prompt: "select_account" } },
  });
  if (error || !data || !data.url) { cancel(); throw new Error("Google sign-in couldn't start. Check your connection and try again."); }

  if (process.env.IW_DEBUG) console.log("[iw] oauth url:", data.url);
  if (process.env.IW_NO_OPEN) return; // test hook: skip actually opening the browser
  await shell.openExternal(data.url);
}

module.exports = { startExternalGoogleLogin, cancelExternalLogin: () => cancel(), resultPage };
