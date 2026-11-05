import { expect, test, type Page } from "@playwright/test";
import { previewPlans } from "../../lib/plans";

async function billingAccount(page: Page, { testing = false, pending = false } = {}) {
  let verified = false;
  let checks = 0;
  const orders: unknown[] = [];
  const catalog = previewPlans(); catalog.preview = false;
  catalog.plans.forEach(plan => { plan.checkout_available = plan.id !== "free"; });
  await page.addInitScript(() => {
    window.Cashfree = config => ({ checkout: async options => { Object.assign(window, { checkoutRequest: { config, options } }); return {}; } });
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { id: "buyer", name: "Alex", email: "alex@example.com", plan: "free", github_username: "", profile: {}, preferences: {}, minutes_used: 0, minute_limit: verified ? 22 : 2, monthly_minute_limit: 2, credit_minutes_remaining: verified ? 20 : 0, testing_mode: testing } });
    if (path === "/api/plans") return route.fulfill({ json: catalog });
    if (path === "/api/health") return route.fulfill({ json: { status: "ok", ai_configured: false, billing_configured: true } });
    if (["/api/projects", "/api/sources", "/api/sessions"].includes(path)) return route.fulfill({ json: [] });
    if (path === "/api/billing/cashfree/create-order") { orders.push(route.request().postDataJSON()); return route.fulfill({ json: { order_id: "ipo_test", payment_session_id: "test-payment-session", amount: 100, plan: "starter", environment: "sandbox" } }); }
    if (path === "/api/billing/cashfree/verify/ipo_test") { checks++; verified = !pending; return route.fulfill({ json: { order_id: "ipo_test", status: pending ? "ACTIVE" : "PAID", minutes_granted: pending ? 0 : 20 } }); }
    return route.fulfill({ status: 404, json: { detail: "Not found" } });
  });
  return { orders, checks: () => checks };
}

test("credit purchases use a real phone and official modal checkout, then refresh verified account credit", async ({ page }) => {
  const account = await billingAccount(page);
  await page.goto("/interview?view=billing");
  await page.getByRole("button", { name: "Buy Starter", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("10-digit Indian mobile");
  expect(account.orders).toEqual([]);
  await page.getByLabel("Mobile number for payment", { exact: true }).fill("+91 9876543210");
  await page.getByRole("button", { name: "Buy Starter", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("20 interview minutes were added");
  await expect(page.locator(".billing-summary")).toContainText("20 purchased credits remaining");
  await expect(page.getByRole("button", { name: "Buy Starter", exact: true })).toBeEnabled();
  expect(account.orders).toEqual([{ plan: "starter", phone: "9876543210" }]);
  expect(await page.evaluate(() => (window as unknown as { checkoutRequest: unknown }).checkoutRequest)).toEqual({ config: { mode: "sandbox" }, options: { paymentSessionId: "test-payment-session", redirectTarget: "_modal" } });
});

test("preview accounts cannot purchase even when a catalog offers Cashfree checkout", async ({ page }) => {
  const account = await billingAccount(page, { testing: true });
  await page.goto("/interview?view=billing&cf_order_id=ipo_test");
  await expect(page.getByRole("button", { name: "Buy Starter", exact: true })).toBeDisabled();
  expect(account.checks()).toBe(0); expect(account.orders).toEqual([]);
});

test("a verified payment return refreshes once without restarting after the account update", async ({ page }) => {
  const account = await billingAccount(page);
  await page.goto("/interview?view=billing&cf_order_id=ipo_test");
  await expect(page.getByRole("status")).toContainText("20 interview minutes were added");
  await expect(page).toHaveURL(/\/interview\?view=billing$/);
  await expect(page.locator(".billing-summary")).toContainText("20 purchased credits remaining");
  expect(account.checks()).toBe(1);
});

test("verification polling is disposed when leaving billing and malformed return IDs never make a request", async ({ page }) => {
  const account = await billingAccount(page, { pending: true });
  await page.goto("/interview?view=billing&cf_order_id=ipo_test");
  await expect.poll(account.checks).toBe(1);
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
  const before = account.checks(); await page.waitForTimeout(3200);
  expect(account.checks()).toBe(before);
  await page.goto("/interview?view=billing&cf_order_id=..%2Fbad");
  await expect(page.getByRole("alert")).toContainText("payment link is invalid");
  expect(account.checks()).toBe(before);
});
