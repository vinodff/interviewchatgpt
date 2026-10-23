import { test, expect } from '@playwright/test';

test('feature examples animate on entry, settle, and replay with the keyboard', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.showcase-ready')).toHaveAttribute('data-motion', 'full');

  for (const feature of ['coding', 'speech', 'context', 'mobile']) {
    const card = page.locator(`[data-showcase="${feature}"]`);
    await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(card).toHaveAttribute('data-animation-state', feature === 'coding' ? 'playing' : /playing|complete/);
    await expect(card).toHaveAttribute('data-animation-state', 'complete');
    const replay = card.getByRole('button', { name: `Replay ${feature} animation`, exact: true });
    await replay.focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveAttribute('data-animation-state', 'playing');
    await expect(replay).toBeFocused();
    await expect(card).toHaveAttribute('data-animation-state', 'complete');
    expect(await card.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('reduced motion stops an active example and leaves the content visible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const card = page.locator('[data-showcase="coding"]');
  await card.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(card).toHaveAttribute('data-animation-state', 'playing');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.showcase-ready')).toHaveAttribute('data-motion', 'reduced');
  await expect(card).toHaveAttribute('data-animation-state', 'reduced');
  await expect(card.getByRole('button', { name: 'Replay coding animation', exact: true })).toBeHidden();
  expect(await card.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  await expect(card.locator('pre')).toBeVisible();
  await expect(card.locator('pre')).toContainText('seen');
});

test('showcase examples stay readable without JavaScript on mobile', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    for (const feature of ['coding', 'speech', 'context', 'mobile']) {
      const card = page.locator(`[data-showcase="${feature}"]`);
      await expect(card.getByRole('heading', { level: 3 })).toBeVisible();
      await expect(card.locator('[data-showcase-replay]')).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test('mobile animation waits for the phone illustration to enter the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const card = page.locator('[data-showcase="mobile"]');
  const illustration = card.locator('[data-showcase-trigger]');
  await illustration.evaluate(element => window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - innerHeight - 20, behavior: 'instant' }));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await illustration.evaluate(element => element.getBoundingClientRect().top >= innerHeight)).toBe(true);
  await expect(card).toHaveAttribute('data-animation-state', 'ready');
  await illustration.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(card).toHaveAttribute('data-animation-state', 'playing');
  await expect(card).toHaveAttribute('data-animation-state', 'complete');
});
