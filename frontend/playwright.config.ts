import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, timeout: 90000,
  expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:3001", trace: "retain-on-failure", screenshot: "only-on-failure",
    ...(process.env.E2E_AUDIO_FILE ? { launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.E2E_AUDIO_FILE}%noloop`] } } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  ...(!process.env.E2E_BASE_URL ? { webServer: { command: "npm run start -- --port 3001", url: "http://localhost:3001", reuseExistingServer: true, timeout: 60000 } } : {}),
});
