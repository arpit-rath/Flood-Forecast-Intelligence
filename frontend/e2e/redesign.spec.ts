import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_USE_MOCKS === 'false', 'Mock-only fixture flow');

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('landing: explains Varuna and reaches both flows in one click', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /See where rain may interrupt a journey/ })).toBeVisible();
  await expect(page.getByText('synthetic replay, not live').first()).toBeVisible();
  await expect(page).toHaveTitle(/Varuna/);
  await noHorizontalScroll(page);

  // Both calls to action are visible without scrolling.
  const explore = page.getByRole('link', { name: 'Explore routes' }).first();
  const console = page.getByRole('link', { name: 'Open responder console' }).first();
  await expect(explore).toBeInViewport();
  await expect(console).toBeInViewport();

  await explore.click();
  await expect(page).toHaveURL(/#\/resident$/);
  await expect(page.getByRole('region', { name: 'Data mode and timestamps' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compare routes' })).toBeVisible();

  await page.getByRole('link', { name: 'Varuna home' }).click();
  await page.getByRole('link', { name: 'Open responder console' }).first().click();
  await expect(page).toHaveURL(/#\/responder$/);
  await expect(page.getByText('Demo operator (mock session)')).toBeVisible();
});

test('landing: preview steps are keyboard operable and show real route and drain data', async ({ page }) => {
  await page.goto('/');
  const steps = page.getByRole('tablist', { name: 'Preview steps' });
  await steps.scrollIntoViewIfNeeded();
  const observation = steps.getByRole('tab', { name: /Observation/ });
  await expect(observation).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: /Observation/ }).getByText('Central Avenue · block 4')).toBeVisible();

  await observation.focus();
  await page.keyboard.press('ArrowRight');
  const routes = page.getByRole('tabpanel', { name: /Route comparison/ });
  await expect(steps.getByRole('tab', { name: /Route comparison/ })).toBeFocused();
  await expect(routes.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  await expect(routes.getByText('Via Hostel Road')).toBeVisible();
  await expect(routes.getByText('Blocked')).toBeVisible();

  await page.keyboard.press('End');
  const respond = page.getByRole('tabpanel', { name: /Response choice/ });
  await expect(respond.getByText('Canal Street culvert inlet')).toBeVisible();
  await expect(respond.getByText('Library Lane gully line')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Pilot roads coloured by estimated risk class' })).toBeVisible();
  await noHorizontalScroll(page);
});

test('landing: content stays visible with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toBeVisible();
  expect(await title.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(page.getByRole('link', { name: 'Explore routes' }).first()).toBeVisible();
});

test('wide screens: rows, hero visual and maps use the width; text keeps its measure', async ({ page }) => {
  test.skip(!isDesktop(page), 'Desktop-only layout');
  await page.setViewportSize({ width: 1920, height: 1080 });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalScroll(page);
  const figure = (await page.locator('.hero__figure').boundingBox())!;
  const lede = (await page.locator('.hero__lede').boundingBox())!;
  const row = (await page.locator('.story .landing-section__inner').boundingBox())!;
  expect(figure.width).toBeGreaterThan(900);
  expect(lede.width).toBeLessThanOrEqual(720);
  expect(row.width).toBeGreaterThan(1800);

  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  expect((await page.locator('.resident-map').boundingBox())!.width).toBeGreaterThan(1400);
  await noHorizontalScroll(page);

  await page.goto('/#/responder');
  await expect(page.getByText('Demo operator (mock session)')).toBeVisible();
  const map = (await page.locator('.responder-col--map').boundingBox())!;
  const drawer = (await page.locator('.responder-col--drawer').boundingBox())!;
  expect(map.width).toBeGreaterThan(1000);
  expect(drawer.x + drawer.width).toBeGreaterThan(1910);
  await noHorizontalScroll(page);
});

test('hero rain falls continuously behind the content and stands still with reduced motion', async ({ page }) => {
  await page.goto('/');
  const rain = page.locator('.hero__rain');
  const layers = page.locator('.rain-layer');
  await expect(rain).toHaveAttribute('aria-hidden', 'true');
  await expect(layers).toHaveCount(3);

  const running = () =>
    layers.evaluateAll((els) => els.flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running').length);
  await expect.poll(running).toBe(3);
  expect(await layers.first().evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe('infinite');
  // Layers fall at different speeds.
  const durations = await layers.evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDuration));
  expect(new Set(durations).size).toBe(3);

  // Behind everything: it ignores the pointer and the CTA on top stays clickable.
  expect(await rain.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  const cta = (await page.getByRole('link', { name: 'Explore routes' }).first().boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.textContent?.trim() ?? '',
    [cta.x + cta.width / 2, cta.y + cta.height / 2],
  );
  expect(hit).toContain('Explore routes');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => layers.evaluateAll((els) => els.flatMap((el) => el.getAnimations()).length)).toBe(0);
  await expect(layers.first()).toBeAttached();
});

test('status strip keeps mode, times and source visible', async ({ page }) => {
  await page.goto('/#/resident');
  const strip = page.getByRole('region', { name: 'Data mode and timestamps' });
  await expect(strip.getByText('Scenario: 20 mm/h rainfall')).toBeVisible();
  for (const label of ['Rain valid', 'Risk calculated', 'Map data', 'Source']) {
    await expect(strip.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(strip.getByText('Local fixtures (no AWS calls)')).toBeVisible();
  const box = await strip.boundingBox();
  // Compact: well under the old ribbon height on a phone.
  expect(box?.height ?? 999).toBeLessThan(isDesktop(page) ? 80 : 200);
});

test('map legend is compact by default and expands', async ({ page }) => {
  await page.goto('/#/resident');
  const legend = page.locator('.map-legend');
  await expect(legend).not.toHaveAttribute('open', '');
  await legend.locator('summary').click();
  await expect(legend.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(legend.getByText('Terrain prior contours')).toBeVisible();
  await expect(legend.getByText('smoothed fixture values, not surveyed elevation')).toBeVisible();
});

test('map falls back to a static sketch and the lists still work', async ({ page }) => {
  await page.goto('/?map=static#/resident');
  await expect(page.getByText('Static sketch · interactive map unavailable')).toBeVisible();
  await expect(page.getByRole('img', { name: /Static sketch of pilot roads/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Via Central Avenue/ })).toBeChecked();
});

test('resident: section bar and map selection lead to road details on a phone', async ({ page }) => {
  test.skip(isDesktop(page), 'Phone-only navigation');
  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();

  const sections = page.getByRole('navigation', { name: 'Panel sections' });
  await sections.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Report a road condition' })).toBeFocused();

  await page.getByText('Flagged segments on this route').first().click();
  await page.getByRole('button', { name: 'Central Avenue · block 4' }).click();
  const peek = page.getByRole('group', { name: 'Selected road' });
  await expect(peek.getByText('Central Avenue · block 4')).toBeVisible();
  await peek.getByRole('button', { name: /Details/ }).click();
  await expect(page.getByRole('heading', { name: 'Central Avenue · block 4' })).toBeFocused();
  await noHorizontalScroll(page);
});

test('responder: console brief starts the review and the drain comparison', async ({ page }) => {
  await page.goto('/#/responder');
  if (!isDesktop(page)) await page.getByRole('tab', { name: 'Action', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Where to start' })).toBeVisible();
  await expect(page.getByText('2 reports waiting.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Open next report' }).click();
  await expect(page.getByRole('article', { name: 'Review RPT-0001' })).toBeVisible();

  await page.getByRole('button', { name: 'Close report review' }).click();
  await page.getByRole('button', { name: 'Go to drain action' }).click();
  await expect(page.getByRole('tab', { name: 'Drain action' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /Compare drain clearance/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Modelled drains' }).getByText('Canal Street culvert inlet')).toBeVisible();

  if (!isDesktop(page)) {
    const dock = page.getByRole('tablist', { name: 'Responder sections' });
    const box = await dock.boundingBox();
    const viewport = page.viewportSize()!;
    // Docked within thumb reach at the bottom of the screen.
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(viewport.height - 2);
  }
  await noHorizontalScroll(page);
});
