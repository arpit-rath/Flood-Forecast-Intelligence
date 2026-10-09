import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.VITE_USE_MOCKS === 'false', 'Mock-only fixture flow');

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

/** WCAG 2.x A/AA scan with axe-core; serious and critical findings fail the test. */
async function scan(page: Page) {
  await page.addScriptTag({ path: axePath });
  const violations: AxeViolation[] = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return result.violations;
  });
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('landing has no serious accessibility violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: 'Preview steps' })).toBeVisible();
  await scan(page);
});

test('resident view has no serious accessibility violations', async ({ page }) => {
  await page.goto('/#/resident');
  await expect(page.getByRole('heading', { name: 'Fastest route shown as default' })).toBeVisible();
  await scan(page);
});

test('responder console has no serious accessibility violations', async ({ page }) => {
  await page.goto('/#/responder');
  await expect(page.getByText('Demo operator (mock session)')).toBeVisible();
  await scan(page);
});
