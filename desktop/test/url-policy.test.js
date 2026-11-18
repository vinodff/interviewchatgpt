"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createUrlPolicy, isAllowedAppUrl, safeExternalUrl, hostOf } = require("../src/url-policy");

const policy = createUrlPolicy("https://www.interviewwin.live", { authHosts: ["abc.supabase.co", "accounts.google.com"] });

test("treats the site with or without www as the app, and nothing else", () => {
  assert.equal(policy.isAppUrl("https://www.interviewwin.live/desktop"), true);
  assert.equal(policy.isAppUrl("https://interviewwin.live/interview?view=billing"), true);
  assert.equal(policy.isAppOrigin("https://www.interviewwin.live"), true);
  assert.equal(policy.isAppUrl("http://www.interviewwin.live/desktop"), false);
  assert.equal(policy.isAppUrl("https://interviewwin.live.attacker.test/"), false);
  assert.equal(policy.isAppUrl("https://evil-interviewwin.live/"), false);
  assert.equal(policy.isAppUrl("file:///C:/app/error.html"), false);
  assert.equal(policy.isAppUrl("not a url"), false);
});

test("keeps only the exact sign-in hosts in the window", () => {
  assert.equal(policy.canNavigateInWindow("https://abc.supabase.co/auth/v1/callback"), true);
  assert.equal(policy.canNavigateInWindow("https://accounts.google.com/o/oauth2"), true);
  assert.equal(policy.canNavigateInWindow("https://other-project.supabase.co/anything"), false);
  assert.equal(policy.canNavigateInWindow("https://sites.google.com/view/anyone"), false);
  assert.equal(policy.canNavigateInWindow("https://www.youtube.com/watch?v=1"), false);
  assert.equal(policy.canNavigateInWindow("http://accounts.google.com/"), false);
});

test("recognises the Google sign-in start so it can open in the system browser", () => {
  assert.equal(policy.isGoogleOAuthStart("https://abc.supabase.co/auth/v1/authorize?provider=google&redirect_to=x"), true);
  assert.equal(policy.isGoogleOAuthStart("https://abc.supabase.co/auth/v1/authorize?provider=github"), false);
  assert.equal(policy.isGoogleOAuthStart("https://abc.supabase.co.evil.test/auth/v1/authorize?provider=google"), false);
});

test("only hands normalized web and plain mail links to the operating system", () => {
  assert.equal(safeExternalUrl("https://wa.me/123"), "https://wa.me/123");
  assert.equal(safeExternalUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(safeExternalUrl(" https://example.com"), null);
  assert.equal(safeExternalUrl("\u0000https://example.com"), null);
  assert.equal(safeExternalUrl("mailto:help@example.com?subject=Hi&attach=C:\\secrets.txt"), "mailto:help@example.com?subject=Hi");
  assert.equal(safeExternalUrl("file:///C:/Windows/System32/calc.exe"), null);
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("ms-settings:privacy"), null);
  assert.equal(safeExternalUrl(42), null);
  assert.equal(policy.isSafeExternal("https://wa.me/123"), true);
});

test("allows http only for a development server on this machine", () => {
  assert.equal(isAllowedAppUrl("https://www.interviewwin.live"), true);
  assert.equal(isAllowedAppUrl("http://127.0.0.1:3001"), true);
  assert.equal(isAllowedAppUrl("http://localhost:3001"), true);
  assert.equal(isAllowedAppUrl("http://192.168.1.5:3001"), false);
  assert.equal(isAllowedAppUrl("ftp://example.com"), false);
});

test("a development server's port is part of the app's identity", () => {
  const local = createUrlPolicy("http://127.0.0.1:3001");
  assert.equal(local.isAppUrl("http://127.0.0.1:3001/desktop"), true);
  assert.equal(local.isAppUrl("http://127.0.0.1:9999/desktop"), false);
});

test("reads the host of the configured Supabase project", () => {
  assert.equal(hostOf("https://abc.supabase.co"), "abc.supabase.co");
  assert.equal(hostOf("not a url"), "");
});
