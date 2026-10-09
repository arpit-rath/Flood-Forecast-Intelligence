import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_USE_MOCKS !== 'false', 'Local API flow only');

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
  await expect(page.getByText(/Photo upload and report submission are unavailable in the local API/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send report' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('link', { name: 'Responder' }).click();
  await expect(page.getByText('Responder view (read-only reports)')).toBeVisible();
  await expect(page.getByText(/Reports could not be refreshed: Photo upload and persistent report review are unavailable/)).toBeVisible();
  await openAction(page);
  await page.getByLabel('Route to evaluate').selectOption('R1');
  await page.getByRole('button', { name: 'Compare both actions' }).click();
  await expect(page.getByText(/D-01 ranks first because it lowers estimated exposure/)).toBeVisible();
  await expect(page.getByText(/Not recalculated by the local API; only selected-route exposure is estimated/)).toBeVisible();
  await expect(page.getByText('Simulated', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(apiPaths).toEqual(expect.arrayContaining([
    '/v1/pilot', '/v1/snapshots/current', '/v1/routes/compare', '/v1/interventions/compare',
  ]));
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
