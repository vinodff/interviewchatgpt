import { test, expect, type Locator, type Page } from '@playwright/test';

class ScrollPreview {
  readonly motion: Locator;
  readonly mobileCard: Locator;
  readonly phoneScene: Locator;
  readonly phoneLayers: Locator;

  constructor(readonly page: Page) {
    this.motion = page.locator('.scroll-motion');
    this.mobileCard = page.locator('[data-showcase="mobile"]');
    this.phoneScene = this.mobileCard.locator('[data-scroll-scene]');
    this.phoneLayers = this.phoneScene.locator('[data-scroll-layer="device"], [data-scroll-layer="orbit-left"]');
  }

  async open() {
    await this.page.emulateMedia({ reducedMotion: 'no-preference' });
    await this.page.goto('/');
    await expect(this.motion).toHaveAttribute('data-scroll-state', 'settled');
  }

  async scrollTo(top: number) {
    await this.page.evaluate(async y => {
      window.scrollTo({ top: y, behavior: 'instant' });
      // Let the native scroll event and its first animation frame run before waiting for rest.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, top);
    await expect(this.motion).toHaveAttribute('data-scroll-state', 'settled');
  }

  async readyPhone() {
    await this.phoneScene.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(this.mobileCard).toHaveAttribute('data-animation-state', 'complete');
    return this.phoneScene.evaluate(element => Math.round(window.scrollY + element.getBoundingClientRect().top - innerHeight * .45));
  }

  async transforms() {
    return this.phoneLayers.evaluateAll(elements => elements.map(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: matrix.m41, y: matrix.m42, rotation: Math.atan2(matrix.m12, matrix.m11) };
    }));
  }

  async expectNoOverflow() {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
}

for (const width of [1440, 390]) {
  test(`phone and icon motion follow repeated scrolling in both directions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const preview = new ScrollPreview(page);
    await preview.open();
    const firstPosition = await preview.readyPhone();
    await preview.scrollTo(firstPosition);
    const first = await preview.transforms();
    expect(first).toHaveLength(2);

    // The entrance has finished: both later positions must still produce different transforms.
    await preview.scrollTo(firstPosition + 180);
    const later = await preview.transforms();
    for (let index = 0; index < first.length; index++) {
      expect(Math.abs(later[index].y - first[index].y)).toBeGreaterThan(4);
    }
    await preview.expectNoOverflow();

    await preview.scrollTo(firstPosition);
    const returned = await preview.transforms();
    for (let index = 0; index < first.length; index++) {
      expect(Math.abs(returned[index].y - first[index].y)).toBeLessThan(.2);
      expect(Math.abs(returned[index].x - first[index].x)).toBeLessThan(.2);
      expect(Math.abs(returned[index].rotation - first[index].rotation)).toBeLessThan(.002);
    }
    await preview.expectNoOverflow();
  });
}

test('changing reduced-motion preference removes scroll transforms and keeps the preview readable', async ({ page }) => {
  const preview = new ScrollPreview(page);
  await preview.open();
  const firstPosition = await preview.readyPhone();
  await preview.scrollTo(firstPosition);
  await expect(preview.phoneScene.locator('[data-scroll-layer="device"]')).toHaveAttribute('style', /transform:/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(preview.motion).toHaveAttribute('data-scroll-state', 'reduced');
  expect(await preview.motion.locator('[data-scroll-layer]').evaluateAll(elements => elements.every(element => !(element as HTMLElement).style.transform))).toBe(true);
  await expect(preview.mobileCard.getByRole('heading', { level: 3 })).toBeVisible();
  await expect(preview.phoneScene).toBeVisible();
  await preview.expectNoOverflow();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(preview.motion).toHaveAttribute('data-scroll-state', 'settled');
  await expect(preview.phoneScene.locator('[data-scroll-layer="device"]')).toHaveAttribute('style', /transform:/);
});

test('native PageDown and PageUp scrolling remain available', async ({ page }) => {
  const preview = new ScrollPreview(page);
  await preview.open();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await expect(preview.motion).toHaveAttribute('data-scroll-state', 'settled');
  const afterPageDown = await page.evaluate(() => window.scrollY);

  await page.keyboard.press('PageUp');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(afterPageDown - 100);
  await expect(preview.motion).toHaveAttribute('data-scroll-state', 'settled');
  await preview.expectNoOverflow();
});
