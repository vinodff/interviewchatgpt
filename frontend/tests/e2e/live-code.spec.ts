import { expect, test } from "@playwright/test";

test.beforeEach(() => { test.skip(process.env.E2E_TEST_MODE === "1", "Normal account journeys require LOCAL_TEST_MODE=false."); });

test.use({ launchOptions: process.env.E2E_CODE_AUDIO_FILE ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.E2E_CODE_AUDIO_FILE}%noloop`] } : {} });

test("spoken implementation request shows Python and a spoken follow-up gets an explanation", async ({ page }) => {
  test.skip(!process.env.E2E_CODE_AUDIO_FILE, "Set E2E_CODE_AUDIO_FILE to a coding question followed by an explanation request with a 20-second pause.");
  test.setTimeout(100000);
  page.setDefaultTimeout(15000);
  const headers = { "X-InterviewPilot": "1", Origin: "http://localhost:3001" };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name").fill("Code Fixture");
  await page.getByLabel("Email address").fill(`browser-code-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Browser-code-fixture-2026!");
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Code." })).toBeVisible();
  try {
    await page.getByRole("button", { name: "Live workspace", exact: true }).click();
    const form = page.locator(".live-preference-form");
    await form.getByLabel("Answer format").selectOption("talking_points");
    await form.locator(".preference-advanced > summary").click();
    await form.getByLabel("Personalization").selectOption("grounded");
    await form.getByLabel("English level").selectOption("simple");
    await form.getByLabel("Hands-free scrolling").selectOption("off");
    await form.getByRole("button", { name: "Save answer preferences" }).click();
    await expect(form.getByText("Saved. Answers update", { exact: false })).toBeVisible();
    await page.getByText("Microphone only", { exact: true }).click();
    await page.getByLabel("Keep session text").uncheck();
    await page.getByLabel("All participants know about", { exact: false }).check();
    // No further clicks are used to request code or request its explanation.
    await page.getByRole("button", { name: "Start live session" }).click();
    const code = page.locator('.answer-code-block[data-language="python"] > code');
    await expect(code).toContainText("def ", { timeout: 30000 });
    await expect(page.locator(".streaming-label")).toHaveCount(0, { timeout: 15000 });
    expect(await code.innerText()).toMatch(/\n {4}\S/);
    const questionBox = (await page.locator(".live-question-panel").boundingBox())!;
    const answerBox = (await page.locator("#live-answer-pane").boundingBox())!;
    expect(answerBox.y - questionBox.y - questionBox.height).toBeLessThanOrEqual(2);
    await page.screenshot({ path: "test-results/live-python.png", fullPage: true });
    await expect(page.locator(".question-block h2")).toContainText(/explain|complexity/i, { timeout: 45000 });
    await expect(page.locator(".answer-text")).toContainText(/complexity|linear|O\(n\)|O\(N\)/i, { timeout: 30000 });
    await expect(page.locator(".streaming-label")).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator(".live-metrics")).toContainText("2 questions");
    await page.screenshot({ path: "test-results/live-code-explanation.png", fullPage: true });
    await page.getByRole("button", { name: "Stop session", exact: true }).click();
    await expect(page.getByText("Session stopped", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete("/api/auth/account", { headers });
  }
});
