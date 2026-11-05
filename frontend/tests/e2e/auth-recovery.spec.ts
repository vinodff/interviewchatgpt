import { expect, test } from "@playwright/test";

test("password recovery scrubs its token and submits the retained token with a new password", async ({ page }) => {
  let submitted: unknown;
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { detail: "Sign in required" } }));
  await page.route("**/api/auth/reset-confirm", route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { ok: true } }); });
  await page.goto("/?reset=long-enough-recovery-token-for-a-real-reset&view=live");
  await expect(page.getByRole("heading", { name: "Choose a new password." })).toBeVisible();
  await expect(page).toHaveURL(/\/interview\?view=live$/);
  await page.getByLabel("New password", { exact: true }).fill("New-password-2026!");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated.");
  expect(submitted).toEqual({ token: "long-enough-recovery-token-for-a-real-reset", password: "New-password-2026!" });
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("recovery also opens when an existing account cookie is still valid", async ({ page }) => {
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/auth/me" ? { id: "signed-in", name: "Alex", email: "alex@example.com", preferences: {}, plan: "free", minutes_used: 0, minute_limit: 2 } : [] });
  });
  await page.goto("/interview?reset=existing-cookie-reset-token-long-enough");
  await expect(page.getByRole("heading", { name: "Choose a new password." })).toBeVisible();
  await expect(page).toHaveURL(/\/interview$/);
});

test("recovery failures remain actionable and signup links open the registration form", async ({ page }) => {
  await page.route("**/api/auth/me", route => route.fulfill({ status: 401, json: { detail: "Sign in required" } }));
  await page.route("**/api/auth/reset-request", route => route.fulfill({ status: 503, json: { detail: "Recovery unavailable" } }));
  await page.goto("/interview");
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email address").fill("alex@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to sign in" })).toBeEnabled();
  await page.goto("/interview?view=billing&plan=value&signup=1");
  await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account and continue" })).toBeVisible();
});
