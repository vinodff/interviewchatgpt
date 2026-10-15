import { test, expect } from "@playwright/test";

test.beforeEach(() => { test.skip(process.env.E2E_TEST_MODE === "1", "Normal account journeys require LOCAL_TEST_MODE=false."); });

test("real account, profile, project, upload, search, history and deletion at desktop and mobile widths", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const email = `pilot-${suffix}@example.com`;
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name").fill("Taylor Pilot"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password", { exact: true }).fill("Pilot-test-password-2026!");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Taylor." })).toBeVisible();
  try {
    await page.getByRole("button", { name: "Your profile", exact: true }).click(); await page.getByLabel("Target role").fill("Platform engineer"); await page.locator(".profile-form").getByLabel("Answer length").selectOption("balanced");
    await page.getByRole("button", { name: "Save profile" }).click(); await expect(page.getByText("Profile saved.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Knowledge library", exact: false }).first().click(); await page.getByRole("button", { name: "New project" }).click();
    await page.getByLabel("Project name").fill("Evidence project"); await page.getByLabel("Description", { exact: true }).fill("I built a distributed queue with Redis and PostgreSQL."); await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Evidence project" })).toBeVisible();
    await page.getByLabel("Upload knowledge files").setInputFiles({ name: "experience.txt", mimeType: "text/plain", buffer: Buffer.from("Taylor Pilot built a distributed queue using Redis and PostgreSQL. The system uses idempotent task processing, durable retries, and a dead letter queue. Taylor authored the worker and reduced duplicate task execution.") });
    await expect(page.locator(".source-info").getByText("experience.txt", { exact: true })).toBeVisible();
    await expect(page.getByText("ready", { exact: true })).toBeVisible({ timeout: 120000 });
    await page.getByLabel("Search knowledge").fill("distributed queue Redis"); await page.getByRole("button", { name: "Search sources" }).click();
    await expect(page.locator(".evidence")).not.toHaveCount(0); await page.locator(".evidence summary").first().click(); await expect(page.locator(".evidence[open] p").first()).toContainText(/queue|Redis/i);
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Open navigation" }).click(); await page.getByRole("button", { name: "Live workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Live workspace", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Start live session" })).toBeDisabled();
    await page.getByText("Microphone only", { exact: true }).click();
    await page.getByLabel("All participants know about", { exact: false }).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Real session endpoints exercise retained/empty history without simulating questions.
    const response = await page.request.post("/api/sessions", { headers: { "X-InterviewPilot": "1", Origin: "http://localhost:3001" }, data: { consent: true, audio_mode: "microphone", title: "History verification", retention: false } });
    expect(response.ok()).toBe(true); const session = await response.json();
    await page.request.post(`/api/sessions/${session.id}/stop`, { headers: { "X-InterviewPilot": "1", Origin: "http://localhost:3001" } });
    await page.getByRole("button", { name: "Refresh workspace" }).click(); await page.getByRole("button", { name: "Open navigation" }).click(); await page.getByRole("button", { name: "Session history", exact: true }).click();
    await page.getByRole("button", { name: "History verification", exact: false }).first().click(); await expect(page.getByText("Transcript retention was disabled")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click(); await page.getByRole("button", { name: "Delete session History verification" }).click(); await page.getByRole("button", { name: "Delete conversation", exact: true }).click();
    await expect(page.getByRole("button", { name: "History verification", exact: false })).toHaveCount(0);
    await page.screenshot({ path: "test-results/workspace-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete("/api/auth/account", { headers: { "X-InterviewPilot": "1", Origin: "http://localhost:3001" } });
  }
});

test("password recovery reports actual SMTP availability and expired reset links", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Forgot your password?" }).click(); await page.getByLabel("Email address").fill("recovery-test@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.locator(".alert")).toContainText(/email|recovery/i);
  await page.goto(`/?reset=${"invalid-token".repeat(4)}`); await page.getByLabel("New password").fill("Pilot-new-password-2026!"); await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.locator(".alert[role='alert']")).toContainText(/invalid|expired/i);
  await expect(page).toHaveURL("http://localhost:3001/");
});
