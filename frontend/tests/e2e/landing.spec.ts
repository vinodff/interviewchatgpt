import { test, expect } from '@playwright/test';

test('landing adapts to screen sizes and opens the workspace', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('You know your story.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('Can I use it on my phone?', { exact: true }).click();
    await expect(page.getByText('Yes. The interview screen adapts', { exact: false })).toBeVisible();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `../artifacts/ui/landing-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.locator('.landing-actions').getByRole('link', { name: 'Start live interview', exact: true }).click();
  await expect(page).toHaveURL(/\/interview\?view=live$/);
  await expect(page.locator('.workspace, .auth-page')).toBeVisible();
  expect(errors).toEqual([]);
});

test('existing password recovery links reach workspace', async ({ page }) => {
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Sign in required' }) }));
  await page.goto('/?reset=example-token');
  await expect(page.getByRole('heading', { name: 'Choose a new password.' })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  // Auth consumes the recovery token and removes it from the address bar.
  await expect(page).toHaveURL(/\/interview$/);
});


test('homepage preview switches examples and can show the complete answer', async ({ page }) => {
  await page.goto('/');
  const demo = page.locator('#product-preview');
  await demo.getByRole('button', { name: 'Technical', exact: true }).click();
  await expect(demo.getByText('“How would you make an API more reliable?”')).toBeVisible();
  await expect(demo.getByRole('button', { name: 'Technical', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await demo.getByRole('button', { name: 'Play example', exact: true }).click();
  await demo.getByRole('button', { name: 'Show full answer', exact: true }).click();
  await expect(demo.getByText('Measure error rates and tail latency to check that the change actually helps.')).toBeVisible();
  await demo.getByRole('button', { name: 'Coding', exact: true }).click();
  await expect(demo.getByText('“How can you find duplicates in a list?”')).toBeVisible();
  await expect(demo.getByText('Sample content. No microphone or recording.')).toBeVisible();
});

test('homepage preview shows complete answers with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const demo = page.locator('#product-preview');
  await demo.getByRole('button', { name: 'Play example', exact: true }).click();
  await expect(demo.getByRole('button', { name: 'Play example', exact: true })).toBeVisible();
  await expect(demo.getByText('The key lesson: start with the people using the tool, then choose the technology.')).toBeVisible();
});
