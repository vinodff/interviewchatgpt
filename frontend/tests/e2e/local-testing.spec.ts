import { expect, test } from "@playwright/test";
import type { User } from "../../lib/types";

test.use({ launchOptions: process.env.E2E_CODE_AUDIO_FILE ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.E2E_CODE_AUDIO_FILE}%noloop`] } : {} });

test("local testing opens without login, simple settings persist, mobile code and explanation run automatically", async ({ page }) => {
  test.skip(process.env.E2E_TEST_MODE !== "1", "Enable local testing mode for this journey.");
  test.skip(!process.env.E2E_CODE_AUDIO_FILE, "Set E2E_CODE_AUDIO_FILE to the labeled two-question WAV fixture.");
  test.setTimeout(120000);
  const headers = { "X-InterviewPilot": "1", Origin: new URL(process.env.E2E_BASE_URL || "http://localhost:3001").origin };
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const sessions: string[] = [];
  page.on("response", response => {
    if (response.request().method() === "POST" && /\/api\/sessions$/.test(response.url()) && response.ok()) {
      void response.json().then((item: { id: string }) => { sessions.push(item.id); });
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toBeVisible();
  const initial = await (await page.request.get("/api/auth/me")).json() as User;
  expect(initial.testing_mode).toBe(true); expect(initial.minute_limit).toBeNull();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan & billing", exact: true })).toHaveCount(0);
  await expect(page.getByText("Testing · unlimited minutes", { exact: true })).toBeVisible();
  try {
    await page.getByRole("button", { name: "Live workspace", exact: true }).click();
    const form = page.locator(".live-preference-form");
    await expect(form.locator(".preference-primary select")).toHaveCount(4);
    const advanced = form.locator(".preference-advanced");
    await expect(advanced).not.toHaveAttribute("open");
    await expect(form.getByLabel("Answer tone")).not.toBeVisible();
    await form.getByLabel("Answer format").selectOption("talking_points");
    await form.getByLabel("English level").selectOption("simple");
    await form.getByLabel("Hands-free scrolling").selectOption("auto");
    await advanced.locator("summary").click();
    await form.getByLabel("Answer tone").selectOption("friendly");
    await form.getByLabel("Answer sources").selectOption("balanced");
    await form.getByLabel("Reading speed", { exact: true }).fill("");
    await advanced.locator("summary").click();
    await form.getByRole("button", { name: "Save answer preferences" }).click();
    await expect(advanced).toHaveAttribute("open");
    await expect(form.getByLabel("Reading speed", { exact: true })).toBeFocused();
    await form.getByLabel("Reading speed", { exact: true }).fill("180");
    await advanced.locator("summary").click();
    await form.getByRole("button", { name: "Save answer preferences" }).click();
    await expect(form.getByText("Saved. Answers update", { exact: false })).toBeVisible();
    const saved = await (await page.request.get("/api/auth/me")).json() as User;
    expect(saved.preferences).toMatchObject({ english_level: "simple", response_delivery: "talking_points", answer_tone: "friendly", reading_wpm: 180 });
    await expect(page.locator('input[name="audio-mode"][value="microphone"]')).toBeChecked();
    await page.setViewportSize({ width: 375, height: 812 });
    expect((await page.locator("#live-answer-pane").boundingBox())!.y).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel("Keep session text").uncheck();
    await page.getByLabel("All participants know about", { exact: false }).check();
    await page.getByRole("button", { name: "Start live session" }).click();
    await expect(page.locator('.answer-code-block[data-language="python"] > code')).toContainText("def ", { timeout: 45000 });
    await expect(page.locator(".streaming-label")).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator(".question-block h2")).toContainText(/explain|complexity/i, { timeout: 45000 });
    await expect(page.locator(".answer-text")).toContainText(/complexity|linear|O\(n\)|O\(N\)/i, { timeout: 30000 });
    await expect(page.locator(".streaming-label")).toHaveCount(0);
    await expect(page.locator(".live-metrics")).toContainText("2 questions");
    // Exercise the same event used by the Android host before leaving the app.
    await page.evaluate(() => window.dispatchEvent(new Event("interviewpilot:app-background")));
    await expect(page.getByRole("button", { name: "Stop session", exact: true })).toHaveCount(0);
    await expect(page.locator(".mobile-capture-state")).toContainText("Session stopped");
    await page.screenshot({ path: "test-results/testing-mode-mobile.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event("interviewpilot:app-background")));
    for (const id of sessions) {
      await page.request.post(`/api/sessions/${id}/stop`, { headers });
      await page.request.delete(`/api/sessions/${id}`, { headers });
    }
    if (initial.preferences) await page.request.patch("/api/profile", { headers, data: { preferences: initial.preferences } });
  }
});
