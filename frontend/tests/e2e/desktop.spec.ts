import { expect, test, type Page } from "@playwright/test";

// The desktop window's page in browser-preview mode: account data and the speech service are mocked,
// so this walks the whole flow — home, past sessions, setup, live overlay, an answered question, Glance, End.
const SHOTS = process.env.E2E_DESKTOP_SHOTS || "";
const RESUME_ID = "11111111-1111-4111-8111-111111111111";
const user = { id: "u-desktop", email: "desktop-e2e@example.com", name: "Asha Test", plan: "free", github_username: "", profile: {}, preferences: {}, minutes_used: 2, minute_limit: 10 };
const answer = "Python is a high-level, interpreted programming language known for readable syntax. It is used for web development, data science and automation. Its large standard library means you rarely start from scratch. For example, print(\"Hello\") is already a complete program.";

test.use({ viewport: { width: 1100, height: 900 }, permissions: ["microphone", "clipboard-read", "clipboard-write"], launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] } });

async function mockAccount(page: Page) {
  const json = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/auth/me", route => route.fulfill(json(user)));
  await page.route("**/api/sources", route => route.fulfill(json([{ id: RESUME_ID, project_id: null, name: "Asha_Resume.pdf", kind: "pdf", status: "ready", error: null, chunk_count: 4, created_at: "2026-11-01T10:00:00Z" }])));
  await page.route("**/api/sessions", route => route.request().method() === "POST"
    ? route.fulfill(json({ id: "s-new", title: "Interview", status: "created", audio_mode: "microphone", retention: true, created_at: new Date().toISOString(), ended_at: null, summary: "", metrics: {} }, 201))
    : route.fulfill(json([
      { id: "s-old", title: "Interview · Google · SWE", status: "ended", audio_mode: "microphone", retention: true, created_at: "2026-11-10T09:00:00Z", ended_at: "2026-11-10T09:30:00Z", summary: "", metrics: {} },
      { id: "s-older", title: "Meeting · Acme", status: "ended", audio_mode: "microphone", retention: true, created_at: "2026-11-02T09:00:00Z", ended_at: "2026-11-02T09:20:00Z", summary: "", metrics: {} },
    ])));
  await page.route("**/api/sessions/s-old", route => route.fulfill(json({ id: "s-old", title: "Interview · Google · SWE", status: "ended", created_at: "2026-11-10T09:00:00Z", turns: [{ id: "t1", role: "interviewer", text: "What is a hash map?", question: "What is a hash map?", answer: "A hash map stores key-value pairs with near constant-time lookups.", created_at: "2026-11-10T09:05:00Z" }] })));
  await page.route(/\/api\/sessions\/s-new\/(usage|turn|stop)$/, route => route.fulfill(json(route.request().url().endsWith("/usage") ? { user: { ...user, minutes_used: 2.2 } } : { id: "s-new", status: "ended", ok: true })));
  await page.route("**/api/profile", route => route.fulfill(json(user)));
  await page.route("**/api/knowledge/search**", route => route.fulfill(json([])));
  await page.route("**/api/live/speech-ticket", route => route.fulfill(json({ token: "auth_tokens/e2e-desktop", expires_at: Date.now() + 600000 })));
  await page.route("**/api/live/answer", route => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: [
    { type: "preview", question: "What is Python?", answer: answer.slice(0, 60), speaker_role: "interviewer" },
    { type: "complete", requests_answer: true, speaker_role: "interviewer", question: "What is Python?", answer, evidence: [], keywords: ["python"], latency_ms: 420 },
  ].map(event => JSON.stringify(event)).join("\n") + "\n" }));
  // The streaming speech socket: accept the setup, then "hear" one interviewer question.
  await page.routeWebSocket(/generativelanguage\.googleapis\.com/, ws => {
    ws.onMessage(message => {
      const data = JSON.parse(String(message));
      if (!data.setup) return;
      ws.send(JSON.stringify({ setupComplete: {} }));
      setTimeout(() => ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: "Yeah, hello. Um, what is Python?" } } })), 1200);
    });
  });
}

const shot = async (page: Page, name: string) => { if (SHOTS) await page.locator(".iwd-frame").screenshot({ path: `${SHOTS}/${name}.png` }); };

test("desktop window: setup flow, live answer, Glance and ending a session", async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await mockAccount(page);
  await page.goto("/desktop");

  await expect(page.getByText("Select session type")).toBeVisible();
  await expect(page.locator(".iwd-minutes")).toHaveText("8 / 10 min");
  await shot(page, "1-home");

  await page.getByRole("radio", { name: "Past Sessions" }).click();
  await page.getByLabel("Search sessions").fill("netflix");
  await expect(page.getByText(/No sessions match/)).toBeVisible();
  await page.getByLabel("Search sessions").fill("google");
  await expect(page.getByRole("button", { name: /Meeting · Acme/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Interview · Google · SWE/ }).click();
  await expect(page.getByText("A hash map stores key-value pairs")).toBeVisible();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Copied all answers.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("## 1. What is a hash map?");
  await shot(page, "2-past-session");
  await page.getByRole("button", { name: "All sessions" }).click();
  await page.getByRole("radio", { name: "Create" }).click();

  await page.getByRole("button", { name: /Free session/ }).click();
  await page.getByLabel("Company", { exact: true }).fill("Google");
  await page.getByLabel("Position", { exact: true }).fill("Software Engineer");
  await expect(page.getByRole("button", { name: "Continue without resume" })).toBeVisible();
  await page.getByLabel("Select resume", { exact: true }).selectOption(RESUME_ID);
  await shot(page, "3-context");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByText("Start in Glance mode")).toBeVisible();
  await expect(page.getByText("Keyboard shortcuts", { exact: true })).toBeVisible();
  await page.getByLabel("Custom instructions (optional)", { exact: true }).fill("Write in points and be concise.");
  await expect(page.getByText("31 / 2000")).toBeVisible();
  await shot(page, "4-options");
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Audio setup" })).toBeVisible();
  await expect(page.getByText("8 min left on your free plan")).toBeVisible();
  await shot(page, "5-audio");
  await page.getByRole("button", { name: "Start (free)" }).click();

  const toolbar = page.getByRole("toolbar", { name: "Live session controls" });
  await expect(toolbar).toBeVisible();
  await expect(page.locator(".iwd-question")).toHaveText("What is Python?", { timeout: 15000 });
  await expect(page.locator(".iwd-answer-body")).toContainText("readable syntax");
  await expect(page.locator(".iwd-pager")).toHaveText("1 / 1");
  await shot(page, "6-live-full");

  // Answer card tools: copy, text size, one-tap follow-ups.
  await page.getByRole("button", { name: "Copy answer" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("readable syntax");
  await page.getByRole("button", { name: "Larger text" }).click();
  await expect(page.locator(".iwd-answer")).toHaveAttribute("style", /--iwd-text-scale: 1\.1/);
  await page.getByRole("button", { name: "Shorter" }).click();
  await expect(page.locator(".iwd-pager")).toHaveText("2 / 2");

  // The transcript drawer lists what was heard, and any line can be answered.
  await page.getByRole("button", { name: "Transcript" }).click();
  await expect(page.locator(".iwd-transcript")).toContainText("what is Python?");
  await shot(page, "6b-live-transcript");

  // Shortcuts: listed in the menu, and they work from the keyboard (page focus in a browser preview).
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("region", { name: "Keyboard shortcuts" })).toContainText("Analyze the question on your screen");
  await shot(page, "6c-live-shortcuts");
  await page.getByRole("button", { name: "Close shortcuts" }).click();
  await page.keyboard.press("Control+Alt+ArrowLeft");
  await expect(page.locator(".iwd-pager")).toHaveText("1 / 2");

  await page.keyboard.press("Control+g");
  await expect(page.locator(".iwd-mode-chip")).toHaveText("GLANCE");
  await expect(page.locator(".iwd-glance-points li")).toHaveCount(3);
  await shot(page, "7-live-glance");

  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: "Click again to end the session" }).click();
  await expect(page.getByText("Select session type")).toBeVisible();
  await expect(page.getByText(/Session ended · .* · \d+ answers?\./)).toBeVisible();
  expect(errors).toEqual([]);
});
