"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { keyProblem, releaseConfig } = require("../scripts/release-config");

const jwt = (payload) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");

test("accepts only public Supabase keys for the installer", () => {
  assert.equal(keyProblem(jwt({ role: "anon" })), "");
  assert.equal(keyProblem("sb_publishable_abc123"), "");
  assert.match(keyProblem(jwt({ role: "service_role" })), /"service_role" role/);
  assert.match(keyProblem("sb_secret_abc123"), /secret key/);
  assert.match(keyProblem(""), /empty/);
  assert.match(keyProblem("not-a-key"), /not a Supabase API key/);
});

test("writes the project URL only when one is given", () => {
  const key = jwt({ role: "anon" });
  assert.deepEqual(releaseConfig({ DESKTOP_SUPABASE_ANON_KEY: ` ${key} ` }), { supabaseAnonKey: key });
  assert.deepEqual(releaseConfig({ DESKTOP_SUPABASE_ANON_KEY: key, DESKTOP_SUPABASE_URL: "https://abc.supabase.co/" }), { supabaseUrl: "https://abc.supabase.co", supabaseAnonKey: key });
  assert.throws(() => releaseConfig({ DESKTOP_SUPABASE_ANON_KEY: key, DESKTOP_SUPABASE_URL: "http://abc.supabase.co" }), /must look like/);
  assert.throws(() => releaseConfig({ DESKTOP_SUPABASE_ANON_KEY: jwt({ role: "service_role" }) }), /service_role/);
});
