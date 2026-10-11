import { expect, test } from '@playwright/test';

test.skip(process.env.VITE_REAL_ROADS_PREVIEW !== 'true' || process.env.VITE_USE_MOCKS !== 'false', 'Local real-road API preview only');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://maps.geo.ap-south-1.amazonaws.com/**', async (route) => {
    const match = route.request().url().match(/\/v2\/styles\/(Standard|Hybrid)\/descriptor/);
    if (!match) return route.abort();
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, name: match[1], sources: {}, layers: [] }) });
  });
});

test('anonymous resident submission stays Unknown; operator review remains separate', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/v1/') || path.startsWith('/v2/')) calls.push(path);
  });
  await page.goto('/#/resident');
  await expect(page.getByText(/Versioned real-road reporting available/)).toBeVisible();
  const baselineFeed = await page.request.get('http://127.0.0.1:8000/v2/real-road-evidence');
  expect(baselineFeed.ok()).toBe(true);
  const baselineEvidence = (await baselineFeed.json()).evidence;
  await page.getByRole('searchbox', { name: 'Find a mapped road' }).fill('osm:way/171708731');
  await page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').click();
  await expect(page.locator('body')).not.toContainText(/sign in|sign out|create account/i);
  await page.getByLabel('Longitude (WGS84)').fill('77.11163165');
  await page.getByLabel('Latitude (WGS84)').fill('28.75816435');
  await page.getByLabel(/Photo \(JPEG/).setInputFiles({ name: 'road.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Submit photo for review' }).click();
  const firstReceipt = page.getByText(/Receipt RR-.*Pending Review/);
  await expect(firstReceipt).toBeVisible();
  const firstReportId = (await firstReceipt.innerText()).match(/RR-[a-f0-9]{32}/)?.[0];
  expect(firstReportId).toBeTruthy();
  await expect(page.getByText(/photograph remains private for responders/)).toBeVisible();
  await expect(page.getByText('Unknown flood condition')).toBeVisible();
  await expect(page.getByText(/unreviewed report/)).toHaveCount(0);
  const pendingFeed = await page.request.get('http://127.0.0.1:8000/v2/real-road-evidence');
  expect(pendingFeed.ok()).toBe(true);
  expect((await pendingFeed.json()).evidence).toEqual(baselineEvidence);
  expect((await page.request.get('http://127.0.0.1:8000/v2/real-road-reports')).status()).toBe(403);
  if (process.env.VITE_OPERATOR_CONSOLE_ENABLED !== 'true') {
    await expect(page.getByRole('link', { name: 'Responder', exact: true })).toHaveCount(0);
    await page.goto('/#/responder');
    await expect(page.getByRole('heading', { name: 'Operator console unavailable' })).toBeVisible();
    expect(calls).toContain('/v2/public/real-road-reports');
    return;
  }
  await page.getByRole('link', { name: 'Responder', exact: true }).click();
  await expect(page.getByText(/Only varuna-responder members/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Mapped roads' })).not.toContainText('H-');
  await page.getByLabel('Demo account').fill('responder');
  await page.getByLabel('Password').fill('throwaway-responder-test');
  await page.getByRole('button', { name: 'Sign in to local demo' }).click();
  await expect(page.getByText(/Responder review access/)).toBeVisible();
  await page.locator('.real-preview__queue button').filter({ hasText: firstReportId! }).click();
  await expect(page.locator('.real-preview__review-detail h3')).toContainText(`${firstReportId} · Pending Review`);
  await expect(page.getByRole('link', { name: /Open private photo/ })).toHaveAttribute('href', /\/v2\/private-photo\//);
  await expect(page.locator('.real-preview__review-detail')).toContainText('Source: resident photo. Observed');
  await expect(page.locator('.real-preview__review-detail')).toContainText('Evidence expires');
  await page.getByRole('button', { name: 'Confirm blockage' }).click();
  await expect(page.getByText('Responder-confirmed blockage').first()).toBeVisible();
  await expect(page.getByText(/Review decision: confirmed blockage/)).toBeVisible();
  const reviewedFeed = await page.request.get('http://127.0.0.1:8000/v2/real-road-evidence');
  const reviewed = (await reviewedFeed.json()).evidence;
  expect(reviewed).toHaveLength(baselineEvidence.length + 1);
  expect(Object.keys(reviewed[0]).sort()).toEqual(['expiresAt', 'observedAt', 'point', 'reviewDecision', 'reviewState', 'reviewedAt', 'roadId', 'source']);
  await page.getByRole('button', { name: 'Hybrid satellite' }).click();
  await expect(page.getByText(/Review decision: confirmed blockage/)).toBeVisible();
  await page.getByRole('button', { name: 'Standard streets' }).click();
  await expect(page.getByText(/Review decision: confirmed blockage/)).toBeVisible();
  await page.getByLabel('Longitude (WGS84)').fill('77.11163165');
  await page.getByLabel('Latitude (WGS84)').fill('28.75816435');
  await page.getByLabel(/Photo \(JPEG/).setInputFiles({ name: 'cleared.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Submit photo for review' }).click();
  const secondReceipt = page.getByText(/submitted as Pending Review/);
  await expect(secondReceipt).toBeVisible();
  const secondReportId = (await secondReceipt.innerText()).match(/RR-[a-f0-9]{32}/)?.[0];
  expect(secondReportId).toBeTruthy();
  await page.locator('.real-preview__queue button').filter({ hasText: secondReportId! }).click();
  await expect(page.locator('.real-preview__review-detail h3')).toContainText(`${secondReportId} · Pending Review`);
  await page.getByRole('button', { name: 'Mark cleared report' }).click();
  await expect(page.getByText('Unknown flood condition')).toBeVisible();
  await expect(page.getByText(/responder-cleared report observed/)).toBeVisible();
  expect(calls.filter((path) => path.startsWith('/v1/') && path !== '/v1/auth/local-session')).toEqual([]);
  expect(calls).toContain('/v2/real-road-reports');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('public submission error keeps the photo and note for retry', async ({ page }) => {
  await page.goto('/#/resident');
  await expect(page.getByText(/Versioned real-road reporting available/)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Find a mapped road' }).fill('osm:way/171708731');
  await page.getByRole('list', { name: 'Mapped roads' }).getByRole('button').click();
  await page.getByLabel('Longitude (WGS84)').fill('77.11163165');
  await page.getByLabel('Latitude (WGS84)').fill('28.75816435');
  await page.getByLabel(/Photo \(JPEG/).setInputFiles({ name: 'road.png', mimeType: 'image/png', buffer: PNG });
  await page.getByLabel('Optional observation note').fill('Retry note');
  await page.route('http://127.0.0.1:8000/v2/public/real-road-reports/upload-url', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Temporarily unavailable' } }) }));
  await page.getByRole('button', { name: 'Submit photo for review' }).click();
  await expect(page.getByRole('region', { name: 'Anonymous real-road photo submission' }).getByRole('alert')).toContainText('Temporarily unavailable');
  await expect(page.getByLabel('Optional observation note')).toHaveValue('Retry note');
  await expect(page.getByLabel(/Photo \(JPEG/)).toHaveJSProperty('files.length', 1);
  await page.unroute('http://127.0.0.1:8000/v2/public/real-road-reports/upload-url');
  await page.getByRole('button', { name: 'Submit photo for review' }).click();
  await expect(page.getByText(/Receipt RR-.*Pending Review/)).toBeVisible();
});
