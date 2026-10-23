import { test, expect } from "@playwright/test";

const pages = [
  ["features", "Less friction. More presence."],
  ["how-it-works", "Bring your work. Find your words."],
  ["plans", "A plan for your next interview."],
  ["about", "Good work deserves clear words."],
  ["help", "A little help, right here."],
  ["contact", "Let’s find the next step."],
  ["privacy", "Privacy policy"],
  ["terms", "Terms of use"],
] as const;

test("public pages render, have unique metadata and fit mobile and desktop", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const titles = new Set<string>();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [slug, heading] of pages) {
      const response = await page.goto(`/${slug}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1440) titles.add(await page.title());
      if (width !== 768) await page.screenshot({ path: `../artifacts/ui/${slug}-${width}.png`, fullPage: true, animations: "disabled" });
    }
  }
  expect(titles.size).toBe(pages.length);
  expect(errors).toEqual([]);
});

test("mobile navigation works by keyboard and closes after navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  const menu = page.getByLabel("Site navigation", { exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Features" }).click();
  await expect(page).toHaveURL(/\/features$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Less friction. More presence.");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
});

test("help search, topic filters, empty state, and recovery are usable", async ({ page }) => {
  await page.goto("/help");
  await page.getByRole("button", { name: "Audio & devices", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("3 answers");
  await page.getByRole("button", { name: "All topics", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search help articles" }).fill("passwordzzzz");
  await expect(page.getByRole("heading", { name: "No matching articles yet." })).toBeVisible();
  await page.getByRole("button", { name: "Show all topics" }).click();
  await expect(page.getByRole("status")).toContainText("10 answers");
  await page.getByRole("searchbox", { name: "Search help articles" }).fill("microphone access");
  await page.getByText("Why can’t the website hear me?", { exact: true }).click();
  await expect(page.locator("details[open]")).toContainText("site settings");
});

test("contact offers the supplied email and validates input before composing", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.locator('.contact-direct a')).toHaveAttribute("href", "mailto:vcontenthelper@gmail.com");
  await expect(page.getByRole("button", { name: "Prepare support email" })).toBeVisible();
  await expect(page.getByText("Opens your email app. Review and send the message there.")).toBeVisible();
  await page.getByLabel("Your name", { exact: true }).fill("Alex");
  await page.getByLabel("Email address", { exact: true }).fill("invalid-email");
  await page.getByLabel("Your message", { exact: true }).fill("I need help with my microphone.");
  expect(await page.getByLabel("Email address", { exact: true }).evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  await page.getByLabel("Email address", { exact: true }).fill("alex@example.com");
  expect(await page.locator("form").evaluate((element: HTMLFormElement) => element.checkValidity())).toBe(true);
});

test("reduced motion removes animations and public content works without JavaScript", async ({ page, browser }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length)).toBe(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto(`${new URL(page.url()).origin}/features`);
    await expect(staticPage.getByRole("heading", { name: "Less friction. More presence." })).toBeVisible();
    await expect(staticPage.getByRole("heading", { name: "Permission comes first" })).toBeVisible();
  } finally { await context.close(); }
});

test("unknown pages return a useful 404", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("back on track.");
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/$/);
});
