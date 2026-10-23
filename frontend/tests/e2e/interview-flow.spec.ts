import { expect, test, type Page } from "@playwright/test";
import { previewPlans } from "../../lib/plans";
import type { User } from "../../lib/types";

async function mockAccount(page: Page, { signedIn = true, ready = true, delayHealth = false, paid = false, catalogFailure = false } = {}) {
  let authenticated = signedIn;
  let healthGate: (() => void) | undefined;
  const healthReady = delayHealth ? new Promise<void>(resolve => { healthGate = resolve; }) : Promise.resolve();
  let user: User = { id: "ui-test-user", name: "Alex", email: "alex@example.com", plan: "free", github_username: "", profile: {}, preferences: { role: "", company: "", reading_wpm: 130, answer_style: "concise", response_delivery: "natural", reading_mode: "auto", answer_text_size: 17 }, minutes_used: 0, minute_limit: 30, testing_mode: false };
  if (paid) user = { ...user, plan: "starter", minute_limit: 180, billing_account: true };
  const patches: Record<string, unknown>[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/auth/me") return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? user : { detail: "Sign in required" } });
    if (path === "/api/auth/register" || path === "/api/auth/login") { authenticated = true; return route.fulfill({ json: user }); }
    if (path === "/api/health") { await healthReady; return route.fulfill({ json: { status: "ok", database: "ok", redis: "ok", ai_configured: ready, billing_configured: false } }); }
    if (path === "/api/plans") return catalogFailure ? route.fulfill({ status: 503, json: { detail: "Unavailable" } }) : route.fulfill({ json: previewPlans() });
    if (["/api/projects", "/api/sources", "/api/sessions"].includes(path)) return route.fulfill({ json: [] });
    if (path === "/api/profile" && method === "PATCH") {
      const body = route.request().postDataJSON(); patches.push(body);
      user = { ...user, ...(body.name ? { name: body.name } : {}), preferences: { ...user.preferences, ...body.preferences } };
      return route.fulfill({ json: user });
    }
    return route.fulfill({ status: 404, json: { detail: "Not part of this UI test" } });
  });
  return { patches, releaseHealth: () => healthGate?.() };
}

test("start interview leads through sign-in to consent without opening the microphone", async ({ page }) => {
  await mockAccount(page, { signedIn: false });
  await page.addInitScript(() => {
    Object.assign(window, { microphoneRequests: 0 });
    navigator.mediaDevices.getUserMedia = async () => { Object.assign(window, { microphoneRequests: (window as unknown as { microphoneRequests: number }).microphoneRequests + 1 }); throw new Error("No audio requested in UI test"); };
  });
  await page.goto("/");
  await page.locator(".landing-actions").getByRole("link", { name: "Start live interview" }).click();
  await expect(page).toHaveURL(/\/interview\?view=live$/);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Alex");
  await page.getByLabel("Email address", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long-test-password-123");
  await page.getByRole("button", { name: "Create account and continue" }).click();
  await expect(page.getByRole("heading", { name: "Live interview", exact: true })).toBeVisible();
  const start = page.getByRole("button", { name: "Start live interview", exact: true });
  await expect(start).toBeDisabled();
  await page.getByLabel("All participants agree to AI assistance", { exact: false }).check();
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { microphoneRequests: number }).microphoneRequests)).toBe(0);
  await expect(page.locator("body")).not.toContainText(/workspace/i);
});

test("unknown or unavailable service never enables the microphone start action", async ({ page }) => {
  const account = await mockAccount(page, { ready: false, delayHealth: true });
  await page.goto("/interview?view=live");
  await page.getByLabel("All participants agree to AI assistance", { exact: false }).check();
  await expect(page.getByRole("button", { name: "Start live interview", exact: true })).toBeDisabled();
  account.releaseHealth();
  await expect(page.getByText("Live answers are unavailable right now.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start live interview", exact: true })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("Gemini API key");
});

test("profile suggestions work with keyboard and the text-size label updates before saving", async ({ page }) => {
  await mockAccount(page);
  await page.goto("/interview?view=profile");
  const form = page.locator(".profile-form");
  const role = form.getByRole("combobox", { name: "Job role", exact: true });
  await role.fill("Front");
  const option = form.getByRole("option").first();
  const selected = (await option.locator("span").first().innerText()).trim();
  await option.focus();
  await page.keyboard.press("Enter");
  await expect(role).toHaveValue(selected);
  await form.locator(".preference-display > summary").click();
  await form.getByLabel("Answer text size", { exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(form.locator(".answer-size-control output")).toHaveText("18px");
});

test("advanced options stay collapsed and invalid reading speeds do not autosave", async ({ page }) => {
  const account = await mockAccount(page);
  await page.goto("/interview?view=live");
  const panel = page.locator(".live-options-panel");
  await expect(panel).not.toHaveAttribute("open");
  await panel.locator(":scope > summary").click();
  const form = panel.locator("form");
  await expect(form.locator(".preference-primary select")).toHaveCount(3);
  await form.locator(".preference-advanced > summary").click();
  await form.getByLabel("Reading speed", { exact: true }).fill("1");
  await page.waitForTimeout(450);
  expect(account.patches).toHaveLength(0);
  await form.getByLabel("Reading speed", { exact: true }).fill("140");
  await expect.poll(() => account.patches.length).toBe(1);
  await expect(form.getByRole("status")).toContainText("Saved.");
  expect(account.patches[0]).toMatchObject({ preferences: { reading_wpm: 140 } });
});

test("browser back and reload keep the chosen interview screen", async ({ page }) => {
  await mockAccount(page);
  await page.goto("/interview?view=overview");
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByRole("button", { name: "Past interviews", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
});

test("billing returns show the confirmed free plan and unavailable upgrades stay disabled", async ({ page }) => {
  await mockAccount(page);
  await page.goto("/?billing=success");
  await expect(page).toHaveURL(/\/interview\?.*view=billing/);
  await expect(page.locator(".billing-summary").getByRole("heading", { name: "Free", exact: true })).toBeVisible();
  await expect(page.getByText("We’re waiting for payment confirmation.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose Starter", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Choose Pro", exact: true })).toBeDisabled();
});

test("existing subscribers can manage billing even if plan prices cannot load", async ({ page }) => {
  await mockAccount(page, { paid: true, catalogFailure: true });
  await page.goto("/interview?view=billing");
  await expect(page.locator('.alert[role="alert"]')).toContainText("We couldn’t load current prices");
  await expect(page.locator(".billing-summary").getByRole("button", { name: "Manage subscription", exact: true })).toBeEnabled();
});

test("the plan selected before sign-in stays selected afterwards", async ({ page }) => {
  await mockAccount(page, { signedIn: false });
  await page.goto("/interview?view=billing&plan=starter&signup=1");
  await expect(page.getByRole("heading", { name: "Create your account.", exact: true })).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Alex");
  await page.getByLabel("Email address", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long-test-password-123");
  await page.getByRole("button", { name: "Create account and continue" }).click();
  await expect(page.locator(".account-plan-selected").getByRole("heading", { name: "Starter", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByRole("button", { name: "Plans & billing", exact: true }).click();
  await page.reload();
  await expect(page.locator(".account-plan-selected").getByRole("heading", { name: "Starter", exact: true })).toBeVisible();
});

test("pricing presents three plans and carries the selected plan into support", async ({ page }) => {
  for (const path of ["/", "/plans"]) {
    await page.goto(path);
    await expect(page.locator(".pricing-card")).toHaveCount(3);
    await expect(page.locator(".pricing-amount")).toHaveText(["₹0forever", "₹299/ month", "₹799/ month"]);
    await expect(page.locator("body")).not.toContainText(/workspace/i);
  }
  await page.getByRole("link", { name: "Ask about Starter", exact: true }).click();
  await expect(page).toHaveURL(/\/contact\?plan=starter$/);
  await expect(page.getByLabel("Your message", { exact: true })).toHaveValue(/Starter/);
});

test("interview controls and plans fit the smallest supported screen", async ({ page }) => {
  await mockAccount(page);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/interview?view=live");
  await expect(page.getByRole("button", { name: "Start live interview", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Plans & billing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Plans & billing", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > innerWidth + 1 && element.getBoundingClientRect().width > 0).map(element => ({ tag: element.tagName, class: element.className, right: Math.round(element.getBoundingClientRect().right) })).slice(0, 12));
  expect(overflow).toEqual([]);
});
