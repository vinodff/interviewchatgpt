import { test, expect } from "@playwright/test";

test.beforeEach(() => { test.skip(process.env.E2E_BROWSER_MODE !== "1", "Standalone browser workspace journey."); });

test("browser project, evidence and profile persist across reload and delete correctly", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/workspace");
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(page.locator(".profile-form").getByLabel("Job role", { exact: true })).toHaveCount(1);
  await page.getByLabel("Your name", { exact: true }).fill("Alex Browser");
  await page.locator(".profile-form").getByLabel("Job role", { exact: true }).fill("Platform engineer");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Alex." })).toBeVisible();
  await page.getByRole("button", { name: "Resume & projects", exact: false }).first().click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name").fill("Persistence test");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Persistence test", exact: true })).toBeVisible();
  await page.getByLabel("Upload knowledge files").setInputFiles({ name: "experience.txt", mimeType: "text/plain", buffer: Buffer.from("Alex built a Python payments API with Redis caching and idempotent transaction requests.") });
  await expect(page.locator(".source-info").getByText("experience.txt", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Resume & projects", exact: false }).first().click();
  await expect(page.locator(".source-info").getByText("experience.txt", { exact: true })).toBeVisible();
  await page.getByLabel("Search knowledge").fill("Redis caching");
  await page.getByRole("button", { name: "Search sources", exact: true }).click();
  await expect(page.locator(".evidence")).toHaveCount(1);
  await page.getByRole("button", { name: "Delete source experience.txt", exact: true }).click();
  await page.getByRole("button", { name: "Delete source", exact: true }).click();
  await expect(page.locator(".source-info").getByText("experience.txt", { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Resume & projects", exact: false }).first().click();
  await expect(page.locator(".source-info").getByText("experience.txt", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("real AI resolves corrected mixed speech and follow-ups, without retaining opted-out text", async ({ page }) => {
  test.setTimeout(180000);
  // Replace speech hardware only. The application API, storage and Gemini call are real.
  await page.addInitScript(() => {
    class Recognition {
      continuous = true; interimResults = true; lang = "en-US";
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      results: Array<{ 0: { transcript: string }; isFinal: boolean; length: number }> = [];
      start() { Object.assign(window, { testRecognition: this }); }
      stop() {}
      emit(text: string, final = true) {
        const last = this.results.at(-1);
        const index = last && !last.isFinal ? this.results.length - 1 : this.results.length;
        this.results[index] = { 0: { transcript: text }, isFinal: final, length: 1 };
        this.onresult?.({ resultIndex: index, results: this.results });
      }
    }
    Object.assign(window, { SpeechRecognition: Recognition, webkitSpeechRecognition: Recognition });
  });
  const emit = (text: string, final = true) => page.evaluate(({ text, final }) => {
    (window as unknown as { testRecognition: { emit: (text: string, final: boolean) => void } }).testRecognition.emit(text, final);
  }, { text, final });
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Resume & projects", exact: false }).first().click();
  await page.getByLabel("Upload knowledge files").setInputFiles({ name: "synthetic-resume.txt", mimeType: "text/plain", buffer: Buffer.from("Alex built a Python payments API. Skills: Python, Redis, DBMS. Alex described work with transaction requests and idempotency.") });
  await expect(page.locator(".source-info").getByText("synthetic-resume.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Live interview", exact: true }).click();
  await page.locator(".capture-advanced > summary").click();
  await page.getByLabel("Speech recognition", { exact: false }).selectOption("standard");
  await expect(page.getByText("AI configured", { exact: true })).toBeVisible();
  await page.getByLabel("Save interview text", { exact: false }).uncheck();
  await page.getByLabel("All participants agree to AI assistance", { exact: false }).check();
  await page.getByRole("button", { name: "Start live interview", exact: false }).click();
  await expect(page.getByRole("button", { name: "End interview", exact: true })).toBeVisible();
  await emit("black what is your dad structure", false);
  await emit("black what is data structure", false);
  await emit("black what is data structure", true);
  await expect(page.locator(".answer-body")).toContainText(/data structure/i, { timeout: 35000 });
  await expect(page.locator(".transcript-turn")).toHaveCount(1);
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  const previous = await page.locator(".answer-body").textContent() || "";
  await emit("I used arrays and hash maps in my last project.");
  await page.waitForTimeout(6500);
  await expect(page.locator(".answer-body")).toHaveText(previous);
  await emit("Can you compare those two?");
  await expect(page.locator(".question-block h2")).toContainText(/compar|differ|array|hash/i, { timeout: 35000 });
  await expect(page.locator(".answer-body")).not.toHaveText(previous);
  await expect(page.locator(".answer-body")).toContainText(/array|hash/i, { timeout: 35000 });
  await expect(page.locator(".transcript-turn")).toHaveCount(3);
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  const embedded = "The time complexity measures how execution grows with input size and avoids bottlenecks before production what is list";
  await emit(embedded, false);
  await expect(page.locator(".question-block h2")).toContainText(/what is a? ?list/i, { timeout: 35000 });
  await expect(page.locator(".answer-body")).toContainText(/list|ordered collection/i, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  await emit(embedded, true);
  await expect(page.locator(".transcript-turn")).toHaveCount(4);
  await expect(page.locator(".transcript-turn.partial")).toHaveCount(0);
  await emit("Write a Python function to reverse a list without recursion");
  await expect(page.locator('.answer-code-block[data-language="python"] > code')).toContainText(/def\s+/, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  await emit("Now do the same in JavaScript", false);
  await expect(page.locator('.answer-code-block[data-language="javascript"] > code')).toContainText(/reverse|function|=>/, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  await emit("Now do the same in JavaScript", true);
  await expect(page.locator(".transcript-turn")).toHaveCount(6);
  await expect(page.locator(".transcript-turn.partial")).toHaveCount(0);
  await emit("Abstract", false);
  await expect(page.getByRole("group", { name: "Recent questions", exact: true }).getByRole("button", { name: /Answer:.*abstract/i })).toBeVisible();
  await expect(page.locator(".question-block h2")).toContainText(/abstract/i, { timeout: 35000 });
  await expect(page.locator(".answer-body")).toContainText(/abstract|subclass/i, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  await emit("Abstract", true);
  await emit("What is DBMS? What is DB? what is DBMS abstract class", false);
  const recent = page.getByRole("group", { name: "Recent questions", exact: true });
  await expect(recent.getByRole("button", { name: /Answer:.*DBMS/i })).toBeVisible();
  await emit("What is DBMS? What is DB? what is DBMS abstract class", true);
  await page.getByRole("button", { name: "🔓 Keep answer", exact: true }).click();
  await recent.getByRole("button", { name: /Answer:.*DBMS/i }).click();
  await expect(page.getByRole("button", { name: "🔓 Keep answer", exact: true })).toBeVisible();
  await expect(page.locator(".question-block h2")).toContainText(/DBMS|database management/i, { timeout: 35000 });
  await expect(page.locator(".answer-body")).toContainText(/database management|manag.*data|software.*data/i, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  await expect(page.locator(".answer-evidence .evidence")).toHaveCount(0); // A resume skill is not a source for a technical definition.
  await page.locator(".live-options-panel > summary").click();
  await page.locator(".live-preference-form .preference-advanced > summary").click();
  await expect(page.getByRole("combobox", { name: "Simple example", exact: true })).toHaveValue("true");
  for (const [speech, topic, example] of [["Database means", /database/i, /example|students?|customers?|names|records/i], ["SQL means", /SQL|structured query/i, /SELECT|example|students?|customers?/i], ["Python means", /Python/i, /print|example|hello|such as/i]] as const) {
    await emit(speech, false);
    await expect(page.locator(".question-block h2")).toContainText(topic, { timeout: 35000 });
    await expect(page.locator(".answer-body")).toContainText(example, { timeout: 35000 });
    await expect(page.locator(".streaming-label")).toHaveCount(0);
    await emit(speech, true);
  }
  await emit("What is dad structure", false);
  const correctedOption = recent.getByRole("button", { name: /Answer:.*dad structure/i }); await expect(correctedOption).toBeVisible(); await correctedOption.focus();
  await emit("What is data structure", false);
  await expect(recent.getByRole("button", { name: /Answer:.*data structure/i })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(recent).toBeVisible();
  await page.screenshot({ path: "test-results/browser-live-questions-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "End interview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start live interview", exact: false })).toBeVisible();
  const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("interviewpilot_sessions_v1") || "[]"));
  expect(retained[0].retention).toBe(false);
  expect(retained[0].turns).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/browser-live-mobile.png", fullPage: true });
});
