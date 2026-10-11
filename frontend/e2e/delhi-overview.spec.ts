import { expect, test, type Page } from '@playwright/test';

const configured = Boolean(process.env.VITE_DELHI_HYBRID_STYLE_URL);
const coverage = 'Delhi basemap · flood risk not assessed outside the pilot';
const pilot = 'Synthetic DTU-area scenario · illustrative geometry · not live';

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test('resident and responder keep Delhi separate from the pilot and switch by keyboard', async ({ page }) => {
  // The configured run uses an in-memory style: automated checks never call real map tiles.
  const mapRequests: string[] = [];
  await page.route('**/maps.geo.**', (route) => {
    mapRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] }),
    });
  });
  await page.goto('/#/resident');
  await expect(page.getByText(pilot)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare routes' })).toBeVisible();
  expect(mapRequests).toEqual([]);
  const switcher = page.getByRole('group', { name: 'Map view' });
  const delhi = switcher.getByRole('button', { name: 'Delhi satellite overview' });
  await delhi.focus();
  await page.keyboard.press('Enter');
  await expect(delhi).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(coverage).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare routes' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Data mode and timestamps' })).toHaveCount(0);
  await expect(page.locator('.map-legend, .map-drain-marker, .map-road-label, .map-peek')).toHaveCount(0);
  await noHorizontalScroll(page);

  await page.getByRole('link', { name: 'Responder' }).click();
  await expect(delhi).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(coverage).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Drain action' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare both actions' })).toHaveCount(0);
  await noHorizontalScroll(page);

  const pilotButton = switcher.getByRole('button', { name: 'Pilot scenario' });
  await pilotButton.focus();
  await page.keyboard.press('Space');
  await expect(pilotButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(pilot)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Data mode and timestamps' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('tab', { name: 'Action', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Drain action' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('without a configured key, Delhi explicitly reports unavailable and pilot remains usable', async ({ page }, testInfo) => {
  test.skip(configured, 'No-key fallback only');
  const mapRequests: string[] = [];
  await page.route('**/maps.geo.**', async (route) => { mapRequests.push(route.request().url()); await route.abort(); });
  await page.goto('/#/resident');
  await page.getByRole('button', { name: 'Delhi satellite overview' }).click();
  await expect(page.getByRole('heading', { name: 'Delhi basemap unavailable' })).toBeVisible();
  await expect(page.getByText(/no low-risk status is implied/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pannable and zoomable Delhi Hybrid basemap' })).toBeHidden();
  expect(mapRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('delhi-unavailable.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open pilot scenario' }).click();
  await expect(page.getByRole('heading', { name: 'Compare routes' })).toBeVisible();
});

test('configured Hybrid style loads with attribution and map controls, without real tile requests', async ({ page }, testInfo) => {
  test.skip(!configured, 'Configured style only');
  const requests: string[] = [];
  await page.route('**/maps.geo.**', async (route) => {
    requests.push(route.request().url());
    if (new URL(route.request().url()).pathname === '/v2/styles/Hybrid/descriptor') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#d9e2e3' } }],
      }) });
    } else await route.abort();
  });
  await page.goto('/#/resident');
  await page.getByRole('button', { name: 'Delhi satellite overview' }).click();
  await expect(page.getByRole('region', { name: 'Pannable and zoomable Delhi Hybrid basemap' })).toBeVisible();
  await expect(page.getByText('Loading Delhi Hybrid basemap…')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Delhi basemap unavailable' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('Amazon Location Service');
  await expect(page.locator('.maplibregl-ctrl-attrib')).toBeVisible();
  expect(requests.some((url) => new URL(url).pathname === '/v2/styles/Hybrid/descriptor')).toBe(true);
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('delhi-configured.png'), fullPage: true });
});

test('failed Hybrid descriptor never appears as a low-risk or pilot map', async ({ page }) => {
  test.skip(!configured, 'Configured style only');
  await page.route('**/maps.geo.**', (route) => route.abort());
  await page.goto('/#/responder');
  await page.getByRole('button', { name: 'Delhi satellite overview' }).click();
  await expect(page.getByRole('heading', { name: 'Delhi basemap unavailable' })).toBeVisible();
  await expect(page.getByText(coverage).first()).toBeVisible();
  await expect(page.locator('.map-legend, .map-drain-marker, .map-road-label')).toHaveCount(0);
  await noHorizontalScroll(page);
});
