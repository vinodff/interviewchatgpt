import { expect, test } from "@playwright/test";

test.beforeEach(() => { test.skip(process.env.E2E_TEST_MODE === "1", "Normal account journeys require LOCAL_TEST_MODE=false."); });

test("browser microphone capture automatically produces a grounded Gemini answer", async ({ page }) => {
  test.skip(!process.env.E2E_AUDIO_FILE, "Set E2E_AUDIO_FILE to a labeled synthesized question WAV to exercise actual browser capture.");
  test.setTimeout(120000);
  const headers = { "X-InterviewPilot": "1", Origin: "http://localhost:3001" };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name").fill("Audio Fixture");
  await page.getByLabel("Email address").fill(`browser-audio-${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Browser-audio-fixture-2026!");
  await page.getByRole("button", { name: "Create account and continue" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Audio." })).toBeVisible();
  try {
    const projectResponse = await page.request.post("/api/projects", { headers, data: { name: "EventStream", description: "Temporary labeled browser audio integration fixture" } });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const upload = await page.request.post("/api/sources/upload", { headers, multipart: {
      project_id: project.id,
      file: { name: "eventstream-fixture.md", mimeType: "text/markdown", buffer: Buffer.from("# EventStream — temporary test fixture\nEventStream receives messages through FastAPI POST /events. It buffers events in a Redis stream; a consumer group persists events to PostgreSQL and acknowledges after commit. Redis decouples ingestion from storage and supports at-least-once delivery with idempotent IDs. No real person's contributions are asserted by this fixture.") },
    } });
    expect(upload.ok()).toBe(true);
    const source = await upload.json();
    await expect.poll(async () => {
      const response = await page.request.get("/api/sources");
      const sources = await response.json();
      return sources.find((entry: { id: string; status: string }) => entry.id === source.id)?.status;
    }, { timeout: 60000 }).toBe("ready");
    await page.getByRole("button", { name: "Refresh interview" }).click();
    await page.getByRole("button", { name: "Live interview", exact: true }).click();
    const preferencesForm = page.locator(".live-preference-form");
    await page.locator(".live-options-panel > summary").click();
    await preferencesForm.locator(".preference-advanced > summary").click();
    await preferencesForm.getByLabel("English level").selectOption("simple");
    await preferencesForm.getByLabel("Hands-free scrolling").selectOption("auto");
    await preferencesForm.getByLabel("Reading speed").fill("240");
    await expect(preferencesForm.getByRole("status")).toContainText("Saved.");
    await page.locator(".live-options-panel > summary").click();
    await page.getByText("Microphone only", { exact: true }).click();
    await page.getByLabel("Save interview text").uncheck();
    await page.getByLabel("All participants agree to AI assistance", { exact: false }).check();
    // This is the sole live-workflow action. The browser source is a test WAV; the app's
    // actual AudioWorklet, WebSocket, Gemini transcription, retrieval, and streaming run.
    await page.getByRole("button", { name: "Start live interview" }).click();
    await expect(page.locator(".answer-text")).toContainText(/Redis/i, { timeout: 80000 });
    await expect(page.locator(".answer-evidence .evidence")).not.toHaveCount(0, { timeout: 15000 });
    await expect(page.locator(".transcript-turn").first()).toBeVisible();
    const answerText = page.locator(".answer-text");
    await expect(answerText).toHaveAttribute("data-reader-mode", "auto");
    await expect.poll(async () => Number(await answerText.getAttribute("data-reader-position")), { timeout: 15000 }).toBeGreaterThan(3);
    await expect(answerText.locator('[data-reader-current="true"]')).toHaveCount(1);
    await page.screenshot({ path: "test-results/live-desktop.png", fullPage: true });

    // Recompose the same active capture into the answer-first phone layout.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator(".workspace.mobile-live")).toBeVisible();
    const answerPane = page.locator("#live-answer-pane");
    const controlsPane = page.locator("#live-controls-pane");
    await expect.poll(async () => Math.round((await answerPane.boundingBox())!.height)).toBe(244);
    expect((await answerPane.boundingBox())!.y).toBe(0);
    expect((await controlsPane.boundingBox())!.y).toBeCloseTo(243.6, 0);
    await expect(answerPane.locator(".answer-text")).toContainText(/Redis/i);
    await expect(answerPane.locator("button,h1,.live-clock,.question-block")).toHaveCount(0);
    await expect(page.locator(".mobile-live-toolbar")).toContainText("InterviewWin Live");
    const divider = page.getByRole("separator", { name: "Resize answer area" });
    await expect(divider).toHaveAttribute("aria-valuenow", "30");
    await divider.click();
    await expect(divider).toHaveAttribute("aria-valuenow", "30");
    await divider.press("ArrowDown");
    await expect(divider).toHaveAttribute("aria-valuenow", "35");
    await divider.press("Home");
    await expect(divider).toHaveAttribute("aria-valuenow", "15");
    const grab = (await divider.boundingBox())!;
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
    await page.mouse.down();
    await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2 + 203, { steps: 10 });
    await page.mouse.up();
    await expect(divider).toHaveAttribute("aria-valuenow", "40");
    await divider.press("End");
    await expect(divider).toHaveAttribute("aria-valuenow", "70");
    await expect(page.locator(".mobile-capture-bar").getByRole("button", { name: "End interview", exact: true })).toBeInViewport();
    await page.setViewportSize({ width: 375, height: 400 });
    await expect(page.locator(".mobile-capture-bar").getByRole("button", { name: "End interview", exact: true })).toBeInViewport();
    expect(Number(await divider.getAttribute("aria-valuenow"))).toBeLessThan(70);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(divider).toHaveAttribute("aria-valuenow", "70");
    await divider.press("Home");
    for (let step = 0; step < 3; step++) await divider.press("ArrowDown");
    await expect(divider).toHaveAttribute("aria-valuenow", "30");

    // No manual answer scrolling: the reading guide reveals later text by itself.
    await divider.press("Home");
    const lowerScroll = page.locator(".live-lower-scroll");
    await lowerScroll.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => answerPane.evaluate(element => element.scrollTop), { timeout: 20000 }).toBeGreaterThan(0);
    expect(await lowerScroll.evaluate(element => element.scrollTop)).toBe(0);
    await expect(answerText.locator('[data-reader-current="true"]')).toBeInViewport();
    for (let step = 0; step < 3; step++) await divider.press("ArrowDown");

    await page.locator(".live-options-panel > summary").click();
    await page.getByLabel("Answer tone").selectOption("friendly");
    await page.getByLabel("Answer sources").selectOption("strict");
    await preferencesForm.getByLabel("English level").selectOption("advanced");
    await expect(preferencesForm.getByRole("status")).toContainText("Saved.");
    const profile = await (await page.request.get("/api/auth/me")).json();
    expect(profile.preferences.answer_tone).toBe("friendly");
    expect(profile.preferences.grounding).toBe("strict");
    expect(profile.preferences.english_level).toBe("advanced");
    expect(profile.preferences.reading_mode).toBe("auto");
    await expect(page.getByRole("button", { name: "Start live interview" })).toHaveCount(0);
    await page.locator(".live-options-panel > summary").click();
    await page.locator(".live-lower-scroll").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: "test-results/live-mobile.png", fullPage: true });
    await page.getByRole("button", { name: "End interview", exact: true }).click();
    await expect(page.locator(".mobile-capture-bar")).toContainText("Session stopped");
    await expect(answerText.locator('[data-reader-current="true"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.request.delete("/api/auth/account", { headers });
  }
});
