import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_REAL_ROADS_PREVIEW !== 'true', 'Real-road preview only');

const configured = Boolean(process.env.VITE_DELHI_STANDARD_STYLE_URL || process.env.VITE_DELHI_HYBRID_STYLE_URL);
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

test.beforeEach(async ({ page }) => {
  // Tests never call Amazon Location or request map tiles.
  await page.route('https://maps.geo.ap-south-1.amazonaws.com/**', async (route) => {
    const match = route.request().url().match(/\/v2\/styles\/(Standard|Hybrid)\/descriptor/);
    if (!match) return route.abort();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, name: match[1], sources: {}, layers: [] }),
    });
  });
});

test('resident and responder show limited real-road coverage without pilot claims', async ({ page }) => {
  const pilotCalls: string[] = [];
  page.on('request', (request) => { if (/\/v1\//.test(request.url())) pilotCalls.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Real roads, unknown conditions.' })).toBeVisible();
  await expect(page.getByText(/OSM road overlay limited to a DTU-area extract/)).toBeVisible();
  await expect(page.getByText(/Roads elsewhere are unassessed/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit a real-road photo (unavailable)' })).toBeDisabled();
  await expect(page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first()).toContainText('Unknown');
  await page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first().click();
  await expect(page.getByText('Unknown flood condition')).toBeVisible();
  await expect(page.getByText(/Map geometry:/)).toContainText('osm:way/');
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ })).toBeVisible();
  await page.getByRole('link', { name: 'Responder', exact: true }).click();
  await expect(page.getByText('Real-road review unavailable')).toBeVisible();
  await expect(page.getByText(/existing private pilot queue remains protected/)).toBeVisible();
  await page.getByRole('link', { name: 'Resident', exact: true }).click();
  await expect(page.getByText('Resident road view')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/Scenario rainfall|H-\d+|Compare routes|drain intervention/i);
  expect(pilotCalls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('configured Standard and Hybrid styles retain selection, camera and attribution', async ({ page }) => {
  test.skip(!configured, 'Needs a test-only descriptor URL');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const styles: string[] = [];
  page.on('request', (request) => {
    const match = request.url().match(/\/v2\/styles\/(Standard|Hybrid)\/descriptor/);
    if (match) styles.push(match[1]);
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Pannable Delhi street basemap' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Standard streets' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await page.getByRole('button', { name: 'Zoom to mapped roads' }).click();
  await page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first().click();
  const selected = page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  const camera = await page.locator('.real-preview__camera').innerText();
  await page.getByRole('button', { name: 'Hybrid satellite' }).click();
  await expect(page.getByRole('region', { name: 'Pannable Delhi satellite basemap' })).toBeVisible();
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.real-preview__camera')).toHaveText(camera);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
  await page.getByRole('button', { name: 'Standard streets' }).click();
  await expect(page.locator('.real-preview__camera')).toHaveText(camera);
  expect(styles).toContain('Standard');
  expect(styles).toContain('Hybrid');
});

test('no map key is explicit and road list remains keyboard accessible', async ({ page }) => {
  test.skip(configured, 'No-key test');
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Delhi basemap unavailable');
  await expect(page.getByRole('alert')).toContainText('Roads here remain Unknown');
  await page.getByRole('searchbox', { name: 'Find a mapped road' }).fill('osm:way/');
  const first = page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
});

test('failed Standard descriptor does not imply a clear road', async ({ page }) => {
  test.skip(!configured, 'Needs a test-only descriptor URL');
  await page.route('https://maps.geo.ap-south-1.amazonaws.com/v2/styles/Standard/descriptor*', (route) => route.fulfill({ status: 403, body: 'Forbidden' }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Delhi basemap unavailable');
  await expect(page.getByRole('alert')).toContainText('Roads here remain Unknown');
  await expect(page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').first()).toContainText('Unknown');
});

test('preview has no serious accessibility violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string; impact: string | null }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
    return result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  });
  expect(violations).toEqual([]);
});

test('pending, confirmed, cleared, rejected and expired reports stay distinct in responsive status cards', async ({ page }) => {
  await page.goto('/e2e/road-status.html');
  const pending = page.getByRole('region', { name: 'pending evidence' });
  await expect(pending).toContainText('Unknown flood condition');
  await expect(pending).toContainText('unreviewed report');
  await expect(pending).toContainText('source: resident photo');
  await expect(pending).toContainText('Observation time:');
  const confirmed = page.getByRole('region', { name: 'confirmed evidence' });
  await expect(confirmed).toContainText('Responder-confirmed blockage');
  await expect(confirmed).toContainText('Source: responder field check; observed');
  const cleared = page.getByRole('region', { name: 'cleared evidence' });
  await expect(cleared).toContainText('Unknown flood condition');
  await expect(cleared).toContainText('responder-cleared report observed');
  await expect(cleared).toContainText('does not establish current safety');
  await expect(page.getByRole('region', { name: 'rejected evidence' })).toContainText('Unknown flood condition');
  await expect(page.getByRole('region', { name: 'expired evidence' })).toContainText('Unknown flood condition');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
