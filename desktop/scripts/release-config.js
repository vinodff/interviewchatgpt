"use strict";

// Release builds: writes config.local.json, which is packaged into the installer, from the
// DESKTOP_SUPABASE_ANON_KEY and optional DESKTOP_SUPABASE_URL environment variables.
// Anyone can read a packaged key, so only a public (anon or publishable) key is accepted.
const fs = require("node:fs");
const path = require("node:path");

/** Why `key` must not ship in the app, or "" when it is a public Supabase key. */
function keyProblem(key) {
  if (!key) return "DESKTOP_SUPABASE_ANON_KEY is empty. Add the project's public anon key as a repository variable.";
  if (key.startsWith("sb_publishable_")) return "";
  if (key.startsWith("sb_secret_")) return "DESKTOP_SUPABASE_ANON_KEY is a secret key. Use the public anon (publishable) key.";
  let role = "";
  try { role = String(JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString("utf8")).role || ""); } catch { /* not a JWT */ }
  if (role === "anon") return "";
  return role ? `DESKTOP_SUPABASE_ANON_KEY has the "${role}" role. Use the public anon key.` : "DESKTOP_SUPABASE_ANON_KEY is not a Supabase API key.";
}

function releaseConfig(env) {
  const supabaseAnonKey = (env.DESKTOP_SUPABASE_ANON_KEY || "").trim();
  const problem = keyProblem(supabaseAnonKey);
  if (problem) throw new Error(problem);
  const supabaseUrl = (env.DESKTOP_SUPABASE_URL || "").trim();
  if (!supabaseUrl) return { supabaseAnonKey };
  if (!/^https:\/\/[^/]+\/?$/.test(supabaseUrl)) throw new Error("DESKTOP_SUPABASE_URL must look like https://<project>.supabase.co");
  return { supabaseUrl: supabaseUrl.replace(/\/$/, ""), supabaseAnonKey };
}

if (require.main === module) {
  try {
    fs.writeFileSync(path.join(__dirname, "..", "config.local.json"), `${JSON.stringify(releaseConfig(process.env), null, 2)}\n`);
    console.log("Wrote config.local.json");
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { keyProblem, releaseConfig };
