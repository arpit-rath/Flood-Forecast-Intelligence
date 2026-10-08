import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_USE_MOCKS === 'false', 'Mock-only fixture flow');

// 1×1 PNG used as the uploaded photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('resident: scenario banner, route comparison, segment evidence, photo report', async ({ page }, testInfo) => {
  await page.goto('/#/resident');

  // Mode and data time are visible and labelled Scenario, never Live.
  const banner = page.getByRole('region', { name: 'Data mode and timestamps' });
  await expect(banner.getByText('Scenario: 20 mm/h rainfall')).toBeVisible();
  await expect(banner.getByText('synthetic replay, not live')).toBeVisible();
  await expect(banner.getByRole('radio', { name: 'Scenario' })).toBeChecked();

  // Default comparison: fastest route is the default before any report is accepted.
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  const central = page.getByRole('radio', { name: /Via Central Avenue/ });
  await expect(central).toBeChecked();
  await expect(page.getByRole('radio', { name: /Via Library Lane/ })).toBeDisabled();
  await expect(page.getByText(/Excluded: crosses a confirmed closure/)).toBeVisible();
  await noHorizontalScroll(page);

  // Open a flagged segment from the route card.
  await page.getByText('Flagged segments on this route').first().click();
  await page.getByRole('button', { name: 'Central Avenue · block 4' }).click();
  const card = page.getByRole('article', { name: 'Central Avenue · block 4' });
  await expect(card.getByText('Watch', { exact: true })).toBeVisible();
  await expect(card.getByText('Missing: left out, not counted as zero')).toBeVisible();

  // Report flow: validation, upload, analysis pending, then pending review.
  await card.getByRole('button', { name: 'Report a photo for this road' }).click();
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page.getByText('Add a photo of the road.')).toBeVisible();
  await page.getByLabel('Photo', { exact: true }).setInputFiles({ name: 'street.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Road', { exact: true })).toHaveValue('S-H23');
  await page.getByLabel(/Note/).fill('Water near the canal corner');
  await page.getByRole('button', { name: 'Send report' }).click();
  const mine = page.getByRole('region', { name: 'Your reports' });
  await expect(mine.getByText('Analysis pending')).toBeVisible();
  await expect(mine.getByText('Pending review')).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByText('Photo analysis suggests standing water; awaiting review.')).toBeVisible();
  await expect(mine.getByText('Mock analysis: fixture response, not a model call.')).toBeVisible();
  await noHorizontalScroll(page);

  await page.screenshot({ path: testInfo.outputPath('resident.png'), fullPage: true });
});

test('resident: live mode unavailable is never shown as current', async ({ page }) => {
  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  await page.getByRole('radio', { name: 'Live weather' }).check();
  await expect(page.getByText('Live weather unavailable.')).toBeVisible();
  await expect(page.getByText('Scenario: 20 mm/h rainfall')).toHaveCount(0);
  await expect(page.getByText('Route comparison is paused until a current risk estimate is available.')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Scenario' }).click();
  await expect(page.getByText('Scenario: 20 mm/h rainfall')).toBeVisible();
});

test('responder: review report, recalculated route advice, compare two drain actions', async ({ page }, testInfo) => {
  await page.goto('/#/responder');
  await expect(page.getByText('Demo operator (mock session)')).toBeVisible();

  if (!isDesktop(page)) {
    await expect(page.getByRole('tab', { name: 'Queue' })).toHaveAttribute('aria-selected', 'true');
  }

  // Review the pending report.
  await page.getByRole('button', { name: /RPT-0001/ }).click();
  const review = page.getByRole('article', { name: 'Review RPT-0001' });
  await expect(review.getByText('Pending review')).toBeVisible();
  await expect(review.getByText(/Photo analysis suggests standing water/)).toBeVisible();
  await expect(review.getByText(/not a calibrated probability/)).toBeVisible();
  await review.getByRole('button', { name: 'Accept as evidence' }).click();
  await expect(review.getByText('Accepted', { exact: true })).toBeVisible();
  await expect(review.getByText('Risk estimate recalculated with this evidence.')).toBeVisible();
  await expect(review.getByText(/Central Avenue · block 4:/)).toBeVisible();

  // Simulation tab.
  await page.getByRole('tab', { name: 'Drain action' }).click();
  await expect(page.getByLabel('Route to evaluate')).toHaveValue('rt-hostel');
  await page.getByLabel('Route to evaluate').selectOption('rt-central');
  await page.getByRole('button', { name: 'Compare both actions' }).click();
  await expect(page.getByText(/D-01 ranks first because it lowers estimated exposure on Via Central Avenue/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Baseline' })).toBeVisible();
  await expect(page.getByText(/route advice changes from Via Hostel Road to Via Central Avenue/)).toBeVisible();
  await page.getByRole('radio', { name: 'Clear D-02' }).check();
  await expect(page.getByRole('heading', { name: /Clear D-02/ })).toBeVisible();
  await page.getByRole('button', { name: /simulation on map/ }).click();
  await expect(page.getByRole('button', { name: 'Show baseline on map' })).toHaveAttribute('aria-pressed', 'true');
  await noHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('responder.png'), fullPage: true });

  // Resident view now recommends the lower-exposure route.
  await page.getByRole('link', { name: 'Resident' }).click();
  await expect(page.getByRole('heading', { name: 'Lower estimated exposure · +4 min' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Via Hostel Road/ })).toBeChecked();
});

test('keyboard: skip link and tabs are operable without a pointer', async ({ page }) => {
  await page.goto('/#/responder');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  const firstTab = page.getByRole('tab').first();
  await firstTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
});
