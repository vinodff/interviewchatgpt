"use strict";

// Where the desktop window points, and the public Supabase values for Google sign-in.
// Resolution order: env vars → desktop/config.local.json → ../frontend/.env.local (dev) → built-in defaults.
const fs = require("node:fs");
const path = require("node:path");
const { isAllowedAppUrl } = require("./url-policy");

function readEnvFile(file, key) {
  try {
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

function readJson(file, key) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"))[key];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

const originOf = (value) => { try { return new URL(value).origin; } catch { return ""; } };

const localJson = path.join(__dirname, "..", "config.local.json");
const frontendEnv = path.join(__dirname, "..", "..", "frontend", ".env.local");
const DEFAULT_APP_URL = "https://www.interviewwin.live";

// IW_START_URL is the older name; only its origin is used now.
const requestedAppUrl = originOf(process.env.IW_APP_URL || process.env.IW_START_URL || readJson(localJson, "appUrl") || DEFAULT_APP_URL);
const APP_URL = isAllowedAppUrl(requestedAppUrl) ? requestedAppUrl : DEFAULT_APP_URL;
const DESKTOP_URL = `${APP_URL}/desktop`;

const SUPABASE_URL =
  process.env.IW_SUPABASE_URL ||
  readJson(localJson, "supabaseUrl") ||
  readEnvFile(frontendEnv, "NEXT_PUBLIC_SUPABASE_URL") ||
  "https://vcpvpzxytleafevindjb.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.IW_SUPABASE_ANON_KEY ||
  readJson(localJson, "supabaseAnonKey") ||
  readEnvFile(frontendEnv, "NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
  "";

// Loopback redirect the external browser returns to. This exact URL must be added to
// Supabase → Authentication → URL Configuration → Redirect URLs.
const LOOPBACK_PORT = Number(process.env.IW_LOOPBACK_PORT) || 53782;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URL = `http://127.0.0.1:${LOOPBACK_PORT}${CALLBACK_PATH}`;

module.exports = { APP_URL, DESKTOP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, LOOPBACK_PORT, CALLBACK_PATH, REDIRECT_URL };
