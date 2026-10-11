import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_USE_MOCKS !== 'false', 'Local API flow only');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function openAction(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole('tab', { name: 'Action', exact: true }).click();
  }
  await page.getByRole('tab', { name: 'Drain action' }).click();
}

test('local API: scenario, risk, routes, and two simulated interventions', async ({ page }) => {
  const apiPaths: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/v1/') && response.status() === 200) apiPaths.push(new URL(response.url()).pathname);
  });

  await page.goto('/#/resident');
  const banner = page.getByRole('region', { name: 'Data mode and timestamps' });
  await expect(banner.getByText('Scenario: 19.5 mm/h rainfall')).toBeVisible();
  await expect(banner.getByText('synthetic replay, not live')).toBeVisible();
  await expect(banner.getByText('Synthetic Scenario API')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Lower estimated exposure/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Route R2/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'Responder' }).click();
  await expect(page.getByText('Responder access required for private photos and review')).toBeVisible();
  await expect(page.getByText('Private report queue unavailable. Sign in with a varuna-responder account; new accounts have report-submission access only.')).toBeVisible();
  await openAction(page);
  await page.getByLabel('Route to evaluate').selectOption('R1');
  await page.getByRole('button', { name: 'Compare both actions' }).click();
  await expect(page.getByText(/D-01 ranks first because it lowers estimated exposure/)).toBeVisible();
  await expect(page.getByText(/Not recalculated by the fixture API; only selected-route exposure is estimated/)).toBeVisible();
  await expect(page.getByText('Simulated', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(apiPaths).toEqual(expect.arrayContaining([
    '/v1/pilot', '/v1/snapshots/current', '/v1/routes/compare', '/v1/interventions/compare',
  ]));
});

test('local API: resident upload stays Pending Review until authenticated manual acceptance', async ({ page, request }) => {
  const before = await (await request.get('http://127.0.0.1:8000/v1/snapshots/current?mode=Scenario')).json();
  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: /Lower estimated exposure/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeDisabled();
  await page.getByLabel('Demo account').fill('resident');
  await page.getByLabel('Password').fill('throwaway-resident-test');
  await page.getByRole('button', { name: 'Sign in to local demo' }).click();
  await expect(page.getByText('Signed in as resident.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeEnabled();
  await page.getByLabel('Road', { exact: true }).selectOption('H-0-0');
  await page.getByLabel('Photo', { exact: true }).setInputFiles({ name: 'street.png', mimeType: 'image/png', buffer: PNG });
  await page.getByLabel(/Note/).fill('Water on the pilot road');
  const creation = page.waitForResponse((response) => response.url().endsWith('/v1/reports') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send report' }).click();
  const created = await (await creation).json();
  expect(created.reviewStatus).toBe('Pending Review');
  expect(created.analysis.provider).toBe('none');
  const reportId = created.id as string;
  await expect(page.getByRole('region', { name: 'Your reports' }).getByText('Pending review')).toBeVisible();
  const pendingSnapshot = await (await request.get('http://127.0.0.1:8000/v1/snapshots/current?mode=Scenario')).json();
  expect(pendingSnapshot.id).toBe(before.id);

  await page.getByRole('link', { name: 'Responder' }).click();
  await expect(page.getByText(/Only a varuna-responder account can view or review private reports/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await page.getByLabel('Demo account').first().fill('responder');
  await page.getByLabel('Password').first().fill('throwaway-responder-test');
  await page.getByRole('button', { name: 'Sign in to local demo' }).first().click();
  await expect(page.getByText('Signed in as responder.').first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.getByRole('tab', { name: 'Queue', exact: true }).click();
  await expect(page.getByRole('radio', { name: /Awaiting review \([1-9]/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /fixture-report-pending/ })).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(reportId) }).click();
  if ((page.viewportSize()?.width ?? 0) < 1024) await expect(page.getByRole('tab', { name: 'Action', exact: true })).toHaveAttribute('aria-selected', 'true');
  const review = page.getByRole('article', { name: `Review ${reportId}` });
  await expect(review.getByRole('img', { name: `Photo submitted for H-0-0` })).toBeVisible({ timeout: 5000 });
  await expect(review.getByText('No automated observation', { exact: false })).toBeVisible({ timeout: 5000 });
  await review.getByLabel('Manual visible-water decision').selectOption('clear', { timeout: 5000 });
  await review.getByRole('button', { name: 'Accept as evidence' }).click({ timeout: 5000 });
  await expect(review.getByText('Accepted', { exact: true })).toBeVisible();
  await expect(review.getByText(/Manual observation replayed in the synthetic Scenario/)).toBeVisible();
  const after = await (await request.get('http://127.0.0.1:8000/v1/snapshots/current?mode=Scenario')).json();
  expect(after.id).not.toBe(before.id);
  expect(after.segments.find((item: { segmentId: string }) => item.segmentId === 'H-0-0').evidenceIds).toContain(reportId);
  await page.getByRole('tab', { name: 'New report' }).click();
  await expect(page.getByRole('button', { name: 'Send report' })).toBeVisible();
  await page.getByLabel('Road', { exact: true }).selectOption('H-0-0');
  await page.getByLabel('Photo', { exact: true }).setInputFiles({ name: 'responder.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByRole('region', { name: 'Your reports' }).getByText('Pending review')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('local API: Live remains unavailable and Scenario can be restored', async ({ page }) => {
  await page.goto('/#/resident');
  await expect(page.getByText('Scenario: 19.5 mm/h rainfall')).toBeVisible();
  await page.getByRole('radio', { name: 'Live weather' }).check();
  await expect(page.getByText('Live weather unavailable.')).toBeVisible();
  await expect(page.getByText('Scenario: 19.5 mm/h rainfall')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to Scenario' }).click();
  await expect(page.getByText('Scenario: 19.5 mm/h rainfall')).toBeVisible();
});

test('local API: unsigned submission and oversized multipart upload are rejected', async ({ request }) => {
  const root = 'http://127.0.0.1:8000';
  const submission = { idempotencyKey: `oversize-${crypto.randomUUID()}`, contentType: 'image/jpeg', sizeBytes: PNG.length };
  expect((await request.post(`${root}/v1/reports/upload-url`, { data: submission })).status()).toBe(403);
  expect((await request.post(`${root}/v1/reports`, { data: { idempotencyKey: submission.idempotencyKey } })).status()).toBe(403);
  const signIn = await request.post(`${root}/v1/auth/local-session`, { data: { username: 'resident', password: 'throwaway-resident-test' } });
  expect(signIn.status()).toBe(200);
  const { accessToken } = await signIn.json() as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  expect((await request.get(`${root}/v1/reports`, { headers })).status()).toBe(403);
  const issued = await request.post(`${root}/v1/reports/upload-url`, { headers, data: submission });
  expect(issued.status()).toBe(200);
  const upload = await issued.json() as { uploadUrl: string; uploadFields: Record<string, string> };
  const oversized = await request.post(upload.uploadUrl, { multipart: {
    ...upload.uploadFields,
    file: { name: 'oversized.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
  } });
  expect(oversized.status()).toBe(413);
});
