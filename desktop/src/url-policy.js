"use strict";

// Which URLs belong to InterviewWin, which may load inside the window, and which go to the browser.
// Pure functions (no Electron) so they are unit-tested in test/url-policy.test.js.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAILTO_PARAMS = ["subject", "body"];

function parse(value) {
  try { return new URL(String(value)); } catch { return null; }
}

/** "www.interviewwin.live" and "interviewwin.live" are the same site. */
const bareHost = (host) => host.replace(/^www\./, "");

/**
 * @param {string} appUrl the site the window loads
 * @param {{ authHosts?: string[] }} options exact https hosts the sign-in fallback may pass through
 *   inside the window (your Supabase project host and accounts.google.com) — never whole domains.
 */
function createUrlPolicy(appUrl, { authHosts = [] } = {}) {
  const app = parse(appUrl);
  if (!app || !["https:", "http:"].includes(app.protocol)) throw new Error(`Invalid app URL: ${appUrl}`);
  const appHost = bareHost(app.hostname);
  const signInHosts = new Set(authHosts.filter(Boolean).map((host) => host.toLowerCase()));

  /** Our own pages: they get the microphone, screen audio and the desktop bridge. */
  function isAppUrl(value) {
    const url = parse(value);
    if (!url || url.protocol !== app.protocol || url.port !== app.port) return false;
    return bareHost(url.hostname) === appHost;
  }

  function isAuthUrl(value) {
    const url = parse(value);
    return Boolean(url && url.protocol === "https:" && signInHosts.has(url.hostname));
  }

  return {
    appOrigin: app.origin,
    isAppUrl,
    /** Permission checks receive an origin ("https://host"), not a full URL. */
    isAppOrigin: (origin) => isAppUrl(origin),
    canNavigateInWindow: (value) => isAppUrl(value) || isAuthUrl(value),
    /** The site's "Sign in with Google" goes to Supabase's authorize endpoint; we run that in the browser. */
    isGoogleOAuthStart(value) {
      const url = parse(value);
      return Boolean(url && url.protocol === "https:" && url.hostname.endsWith(".supabase.co") && url.pathname.includes("/auth/v1/authorize") && url.searchParams.get("provider") === "google");
    },
    isSafeExternal: (value) => safeExternalUrl(value) !== null,
  };
}

/**
 * The normalized URL to hand to the operating system, or null. Only web links and plain mail links:
 * a mailto keeps just its address, subject and body (no attachment-style parameters).
 */
function safeExternalUrl(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000- ]/.test(value.charAt(0))) return null;
  const url = parse(value);
  if (!url) return null;
  if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  if (url.protocol !== "mailto:") return null;
  const kept = new URLSearchParams();
  for (const key of MAILTO_PARAMS) { const part = url.searchParams.get(key); if (part) kept.set(key, part); }
  const query = kept.toString();
  return `mailto:${url.pathname}${query ? `?${query}` : ""}`;
}

/** Development servers on this machine may use http; anything else must be https. */
function isAllowedAppUrl(value) {
  const url = parse(value);
  if (!url) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const hostOf = (value) => { const url = parse(value); return url ? url.hostname : ""; };

module.exports = { createUrlPolicy, safeExternalUrl, isAllowedAppUrl, hostOf };
