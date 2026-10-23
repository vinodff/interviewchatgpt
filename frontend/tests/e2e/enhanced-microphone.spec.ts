import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

test.use({ launchOptions: process.env.E2E_QUIET_AUDIO_FILE ? { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.E2E_QUIET_AUDIO_FILE}%noloop`] } : {} });
test("quiet recorded speech reaches an answer through real PCM capture and Gemini transcription", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_BROWSER_MODE !== "1" || !process.env.E2E_QUIET_AUDIO_FILE, "Requires browser mode and a quiet PCM audio fixture.");
  test.setTimeout(90000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const requests: Array<{ path: string; started_ms: number; complete_ms?: number; audio_ms?: number }> = [];
  const trackedRequests = new Map<object, typeof requests[number]>();
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (!["/api/live/transcribe", "/api/live/answer"].includes(path)) return;
    const sample: typeof requests[number] = { path, started_ms: Date.now() };
    if (path.endsWith("transcribe")) { const audio = request.postDataJSON()?.audio; if (typeof audio === "string") sample.audio_ms = (Buffer.from(audio, "base64").length - 44) / 32; }
    requests.push(sample);
    trackedRequests.set(request, sample);
  });
  page.on("requestfinished", request => { const sample = trackedRequests.get(request); if (sample) sample.complete_ms = Date.now(); });
  // Observe hardware ownership only; do not mock capture, transcription or answer responses.
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.assign(window, { testMicTracks: [] as MediaStreamTrack[] });
    navigator.mediaDevices.getUserMedia = async constraints => {
      Object.assign(window, { testMicStarted: Date.now() });
      const stream = await original(constraints);
      (window as unknown as { testMicTracks: MediaStreamTrack[] }).testMicTracks.push(...stream.getTracks()); return stream;
    };
    const observe = () => new MutationObserver(() => {
      const answer = document.querySelector(".answer-text")?.textContent?.trim();
      if (answer && !(window as unknown as { testFirstAnswer?: number }).testFirstAnswer) Object.assign(window, { testFirstAnswer: Date.now() });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    if (document.body) observe(); else document.addEventListener("DOMContentLoaded", observe, { once: true });
  });
  await page.goto("/workspace"); await page.getByRole("button", { name: "Live interview", exact: true }).click();
  await page.locator(".capture-advanced > summary").click();
  await page.getByLabel("Speech recognition", { exact: false }).selectOption(process.env.E2E_SPEECH_ENGINE || "enhanced");
  await page.getByLabel("Save interview text", { exact: false }).uncheck();
  await page.getByLabel("All participants agree to AI assistance", { exact: false }).check();
  await page.getByRole("button", { name: "Start live interview", exact: false }).click();
  await expect(page.getByRole("meter", { name: "Microphone input" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Live conversation transcript" })).toContainText(/what is a python dictionary/i, { timeout: 45000 });
  await expect(page.locator(".answer-body")).toContainText(/key|mapping|hash/i, { timeout: 35000 });
  await expect(page.locator(".streaming-label")).toHaveCount(0);
  // A failed stream also hides the label; ensure the answer survived completion.
  await expect(page.locator(".answer-body")).toContainText(/key|mapping|hash/);
  await expect(page.getByRole("status").filter({ hasText: /^Suggested answer ready\./ })).toHaveCount(1);
  const timing = await page.evaluate(() => ({ mic_started_ms: (window as unknown as { testMicStarted: number }).testMicStarted, first_answer_ms: (window as unknown as { testFirstAnswer: number }).testFirstAnswer }));
  const voiceEndMs = Number(process.env.E2E_VOICE_END_MS || 0);
  expect(timing.first_answer_ms).toBeGreaterThan(timing.mic_started_ms);
  writeFileSync(testInfo.outputPath("voice-latency.json"), JSON.stringify({ ...timing, estimated_after_fixture_speech_end_ms: voiceEndMs ? timing.first_answer_ms - timing.mic_started_ms - voiceEndMs : null, requests: requests.map(item => ({ ...item, duration_ms: item.complete_ms === undefined ? null : item.complete_ms - item.started_ms })), scope: "Synthetic audio through real Chromium capture and Gemini; fixture-end estimate excludes microphone hardware variability." }, null, 2));
  await page.getByRole("button", { name: "End interview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start live interview", exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { testMicTracks: MediaStreamTrack[] }).testMicTracks.every(track => track.readyState === "ended"))).toBe(true);
  const retained = await page.evaluate(() => JSON.parse(localStorage.getItem("interviewpilot_sessions_v1") || "[]")); expect(retained[0].turns).toEqual([]);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/enhanced-microphone-mobile.png", fullPage: true });
});
