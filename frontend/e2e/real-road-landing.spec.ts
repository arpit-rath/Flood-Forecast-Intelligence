import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_REAL_ROADS_PREVIEW !== 'true', 'Real-road preview only');

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

test('landing CTA, logo, direct link and browser history reach the expected views', async ({ page }) => {
  const pilotCalls: string[] = [];
  page.on('request', (request) => { if (/\/v1\//.test(request.url())) pilotCalls.push(request.url()); });
  const roadCalls: string[] = [];
  page.on('request', (request) => { if (/\/v2\//.test(request.url())) roadCalls.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Know what is reported/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open Delhi road map/ })).toHaveAttribute('href', '#/resident');
  await expect(page.locator('body')).not.toContainText(/sign in|sign up|sign out|create account|your reports|responder console|Scenario rainfall|drain simulation|route comparison/i);
  await expect(page.getByRole('link', { name: 'Responder', exact: true })).toHaveCount(0);
  expect(roadCalls).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Varuna home' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Open Delhi road map/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/resident$/);
  await expect(page.getByRole('heading', { name: 'Real roads, unknown conditions.' })).toBeVisible();
  await page.getByRole('link', { name: 'Varuna home' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { level: 1, name: /Know what is reported/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Real roads, unknown conditions.' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1, name: /Know what is reported/ })).toBeVisible();
  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: 'Real roads, unknown conditions.' })).toBeVisible();
  expect(pilotCalls).toEqual([]);
});

test('public landing is readable and accessible from phone to wide desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'Responsive matrix runs once');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/');
  for (const width of [360, 768, 1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await expect(page.getByRole('heading', { level: 1, name: /Know what is reported/ })).toBeVisible();
    await expect(page.getByText(/Only 84 OpenStreetMap ways near DTU are covered/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}px`).toBe(true);
    const cta = await page.getByRole('link', { name: /Open Delhi road map/ }).boundingBox();
    const home = await page.getByRole('link', { name: 'Varuna home' }).boundingBox();
    expect(cta!.height).toBeGreaterThanOrEqual(44);
    expect(home!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`landing-${width}.png`), fullPage: true });
  }
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact: string | null }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  });
  expect(violations).toEqual([]);
  const animationCount = await page.locator('.road-landing__hero-copy').evaluate((element) => element.getAnimations().length);
  expect(animationCount).toBe(0);
});

test('operator-only route remains gated and is not advertised on the landing page', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: 'Responder', exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/responder console|sign in|create account/i);
  await page.goto('/#/responder');
  if (process.env.VITE_OPERATOR_CONSOLE_ENABLED === 'true') {
    await expect(page.getByRole('heading', { name: 'Private real-road review' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { name: 'Operator console unavailable' })).toBeVisible();
  }
});
